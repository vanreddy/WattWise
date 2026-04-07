"""
Optimization engine: the hourly loop.

Every hour: predict → score → act → log
Respects auto_mode toggle, disabled_until, and per-device overrides.
"""

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

import asyncpg

from backend.optimizer.predict import (
    fetch_weather_forecast,
    store_weather_snapshot,
    predict_solar,
    predict_base_load,
    extract_temp_forecast,
)
from backend.optimizer.score import (
    DeviceState,
    generate_plan,
    plan_to_timeline,
)
from backend.optimizer.act import execute_hour, log_action

logger = logging.getLogger(__name__)


async def _get_optimizer_state(pool: asyncpg.Pool, account_id: UUID) -> dict:
    """Load or create optimizer state for an account."""
    row = await pool.fetchrow(
        "SELECT * FROM optimizer_state WHERE account_id = $1", account_id
    )
    if row:
        return dict(row)

    # Create default state
    await pool.execute("""
        INSERT INTO optimizer_state (account_id) VALUES ($1)
        ON CONFLICT (account_id) DO NOTHING
    """, account_id)

    return {
        "account_id": account_id,
        "auto_mode": True,
        "disabled_until": None,
        "pw_reserve_pct": 20,
        "comfort_min_f": 68,
        "comfort_max_f": 78,
        "ev_min_pct": 60,
        "ev_max_pct": 90,
        "device_overrides": {},
    }


async def _get_device_state(pool: asyncpg.Pool, account_id: UUID, opt_state: dict) -> DeviceState:
    """Read current device states from latest telemetry + API status."""

    # Latest Tesla data
    row = await pool.fetchrow("""
        SELECT solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w
        FROM tesla_intervals
        WHERE account_id = $1
        ORDER BY ts DESC LIMIT 1
    """, account_id)

    state = DeviceState(
        pw_reserve_pct=opt_state.get("pw_reserve_pct", 20),
        comfort_min_f=opt_state.get("comfort_min_f", 68),
        comfort_max_f=opt_state.get("comfort_max_f", 78),
        ev_min_pct=opt_state.get("ev_min_pct", 60),
        ev_max_pct=opt_state.get("ev_max_pct", 90),
    )

    if row:
        state.pw_soc_pct = row["battery_pct"]
        state.pw_power_w = row["battery_w"]

        # If vehicle_w > 0, car is charging (and therefore plugged in)
        if row["vehicle_w"] > 100:
            state.ev_plugged_in = True
            state.ev_charging = True

    # Try to get EV SoC from Smartcar
    try:
        smartcar_token = await pool.fetchval("""
            SELECT value FROM kv_store
            WHERE key = 'smartcar_token_cache' AND account_id = $1
        """, account_id)

        if smartcar_token:
            # We have a Smartcar connection — EV is likely trackable
            state.ev_plugged_in = True  # Assume plugged if connected
    except Exception:
        pass

    # Try to get Nest status
    try:
        from backend.nest_api import _sdm_request
        result = await _sdm_request(pool, account_id, "GET", "devices")
        thermostats = [d for d in result.get("devices", [])
                       if d.get("type") == "sdm.devices.types.THERMOSTAT"]
        if thermostats:
            # Average indoor temp across thermostats
            temps = []
            for t in thermostats:
                traits = t.get("traits", {})
                temp_c = traits.get("sdm.devices.traits.Temperature", {}).get("ambientTemperatureCelsius")
                if temp_c is not None:
                    temps.append(temp_c * 9 / 5 + 32)
                mode = traits.get("sdm.devices.traits.ThermostatMode", {}).get("mode", "OFF")
                eco = traits.get("sdm.devices.traits.ThermostatEco", {}).get("mode", "OFF")
                if eco == "MANUAL_ECO":
                    state.hvac_mode = "ECO"
                elif mode:
                    state.hvac_mode = mode

            if temps:
                state.indoor_temp_f = round(sum(temps) / len(temps), 1)
    except Exception as exc:
        logger.debug("Could not read Nest status: %s", exc)

    return state


async def _get_nest_device_ids(pool: asyncpg.Pool, account_id: UUID) -> list[str]:
    """Get all Nest thermostat device IDs for an account."""
    try:
        from backend.nest_api import _sdm_request
        result = await _sdm_request(pool, account_id, "GET", "devices")
        ids = []
        for d in result.get("devices", []):
            if d.get("type") == "sdm.devices.types.THERMOSTAT":
                device_id = d["name"].split("/")[-1]
                ids.append(device_id)
        return ids
    except Exception:
        return []


async def run_optimization(pool: asyncpg.Pool, account_id: UUID) -> dict:
    """Run a single optimization cycle for an account.

    Returns: {status, plan_summary, actions_taken}
    """
    now = datetime.now(timezone.utc)
    logger.info("Running optimization for account %s at %s", account_id, now)

    # ─── 1. Check if auto mode is enabled ───
    opt_state = await _get_optimizer_state(pool, account_id)

    if not opt_state.get("auto_mode", True):
        disabled_until = opt_state.get("disabled_until")
        if disabled_until and now >= disabled_until:
            # Re-enable auto mode
            await pool.execute("""
                UPDATE optimizer_state
                SET auto_mode = TRUE, disabled_until = NULL, updated_at = NOW()
                WHERE account_id = $1
            """, account_id)
            logger.info("Auto mode re-enabled for account %s (disabled_until passed)", account_id)
        else:
            logger.info("Auto mode disabled for account %s — skipping", account_id)
            return {"status": "disabled", "plan_summary": None, "actions_taken": []}

    # ─── 2. Get account location ───
    acct = await pool.fetchrow(
        "SELECT latitude, longitude FROM accounts WHERE id = $1", account_id
    )
    lat = acct["latitude"] if acct else None
    lon = acct["longitude"] if acct else None

    if not lat or not lon:
        logger.warning("No lat/lon for account %s — skipping weather", account_id)
        weather_forecast = []
    else:
        # ─── 3. Fetch weather ───
        weather_forecast = await fetch_weather_forecast(lat, lon)
        await store_weather_snapshot(pool, account_id, weather_forecast)

    # ─── 4. Predict ───
    solar_preds = await predict_solar(pool, account_id, weather_forecast, now)
    load_preds = await predict_base_load(pool, account_id, now)
    temp_preds = extract_temp_forecast(weather_forecast, now)

    # ─── 5. Get device state ───
    device_state = await _get_device_state(pool, account_id, opt_state)

    # ─── 6. Generate plan ───
    plan = generate_plan(device_state, solar_preds, load_preds, temp_preds, now)
    timeline = plan_to_timeline(plan)

    # ─── 7. Store plan ───
    plan_json = {
        "generated_at": now.isoformat(),
        "hours": [
            {
                "hour": hp.hour,
                "is_peak": hp.is_peak,
                "pw_action": hp.pw_action,
                "ev_action": hp.ev_action,
                "hvac_action": hp.hvac_action,
                "hvac_setpoint_f": hp.hvac_setpoint_f,
                "surplus_w": hp.surplus_w,
                "solar_w": hp.solar_w,
                "base_load_w": hp.base_load_w,
                "reason": hp.reason,
            }
            for hp in plan.hours
        ],
        "timeline": timeline,
        "total_solar_kwh": round(plan.total_solar_kwh, 1),
        "total_savings_est": plan.total_savings_est,
        "predictions": {
            "solar": {str(k): v for k, v in solar_preds.items()},
            "load": {str(k): v for k, v in load_preds.items()},
            "temp": {str(k): v for k, v in temp_preds.items()},
        },
        "device_state": {
            "pw_soc_pct": device_state.pw_soc_pct,
            "ev_soc_pct": device_state.ev_soc_pct,
            "ev_plugged_in": device_state.ev_plugged_in,
            "indoor_temp_f": device_state.indoor_temp_f,
            "hvac_mode": device_state.hvac_mode,
        },
    }

    await pool.execute("""
        UPDATE optimizer_state
        SET current_plan = $2::jsonb, updated_at = NOW()
        WHERE account_id = $1
    """, account_id, json.dumps(plan_json))

    # ─── 8. Execute current hour's actions ───
    current_hour_plan = plan.hours[0] if plan.hours else None
    actions_taken = []

    if current_hour_plan:
        # Check per-device overrides
        overrides = opt_state.get("device_overrides") or {}
        if isinstance(overrides, str):
            overrides = json.loads(overrides)

        nest_ids = await _get_nest_device_ids(pool, account_id)

        # Skip devices with active overrides
        override_active = {}
        for device, until_str in overrides.items():
            if until_str:
                until = datetime.fromisoformat(until_str)
                if now < until:
                    override_active[device] = until
                    logger.info("Device %s override active until %s", device, until)

        if "nest" in override_active:
            current_hour_plan.hvac_action = "idle"
        if "powerwall" in override_active:
            current_hour_plan.pw_action = "idle"

        actions_taken = await execute_hour(
            pool, account_id, current_hour_plan, device_state, nest_ids
        )

    # ─── 9. Generate summary ───
    total_solar = round(plan.total_solar_kwh, 1)
    summary = f"Predicted {total_solar} kWh solar today"
    if plan.total_savings_est > 0:
        summary += f", ~${plan.total_savings_est:.2f} savings from automation"

    logger.info("Optimization complete for %s: %s, %d actions",
                account_id, summary, len(actions_taken))

    return {
        "status": "ok",
        "plan_summary": summary,
        "actions_taken": actions_taken,
        "timeline": timeline,
    }


async def run_all_accounts(pool: asyncpg.Pool):
    """Run optimization for all accounts with Tesla connected. Called by scheduler."""
    accounts = await pool.fetch("""
        SELECT id FROM accounts WHERE tesla_email IS NOT NULL
    """)

    for acct in accounts:
        try:
            await run_optimization(pool, acct["id"])
        except Exception as exc:
            logger.exception("Optimization failed for account %s: %s", acct["id"], exc)
