"""
Optimization engine: hourly forecast/recommendation generator.

Every hour: predict → score → store plan.
Purely advisory — no device control. The frontend reads the stored plan
to render the Energy Forecast chart and Recommendations.
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

logger = logging.getLogger(__name__)

# Plan-generation defaults (formerly user-editable via auto-mode UI).
# These inform recommendations only — no device commands are issued.
DEFAULT_PW_RESERVE_PCT = 20
DEFAULT_COMFORT_MIN_F = 68
DEFAULT_COMFORT_MAX_F = 78
DEFAULT_EV_MIN_PCT = 60
DEFAULT_EV_MAX_PCT = 90


async def _get_device_state(pool: asyncpg.Pool, account_id: UUID) -> DeviceState:
    """Read current device states from latest telemetry + API status."""

    # Latest Tesla data
    row = await pool.fetchrow("""
        SELECT solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w
        FROM tesla_intervals
        WHERE account_id = $1
        ORDER BY ts DESC LIMIT 1
    """, account_id)

    state = DeviceState(
        pw_reserve_pct=DEFAULT_PW_RESERVE_PCT,
        comfort_min_f=DEFAULT_COMFORT_MIN_F,
        comfort_max_f=DEFAULT_COMFORT_MAX_F,
        ev_min_pct=DEFAULT_EV_MIN_PCT,
        ev_max_pct=DEFAULT_EV_MAX_PCT,
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


async def run_optimization(pool: asyncpg.Pool, account_id: UUID) -> dict:
    """Run a single forecast cycle for an account.

    Generates and stores a 24-hour plan. No device commands are issued.
    Returns: {status, plan_summary}
    """
    now = datetime.now(timezone.utc)
    logger.info("Running forecast for account %s at %s", account_id, now)

    # ─── 1. Get account location ───
    acct = await pool.fetchrow(
        "SELECT latitude, longitude FROM accounts WHERE id = $1", account_id
    )
    lat = acct["latitude"] if acct else None
    lon = acct["longitude"] if acct else None

    if not lat or not lon:
        logger.warning("No lat/lon for account %s — skipping weather", account_id)
        weather_forecast = []
    else:
        # ─── 2. Fetch weather ───
        weather_forecast = await fetch_weather_forecast(lat, lon)
        await store_weather_snapshot(pool, account_id, weather_forecast)

    # ─── 3. Predict ───
    solar_preds = await predict_solar(pool, account_id, weather_forecast, now)
    load_preds = await predict_base_load(pool, account_id, now)
    temp_preds = extract_temp_forecast(weather_forecast, now)

    # ─── 4. Get device state ───
    device_state = await _get_device_state(pool, account_id)

    # ─── 5. Generate plan ───
    plan = generate_plan(device_state, solar_preds, load_preds, temp_preds, now)
    timeline = plan_to_timeline(plan)

    # ─── 6. Store plan ───
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

    # Ensure row exists then update
    await pool.execute("""
        INSERT INTO optimizer_state (account_id) VALUES ($1)
        ON CONFLICT (account_id) DO NOTHING
    """, account_id)
    await pool.execute("""
        UPDATE optimizer_state
        SET current_plan = $2::jsonb, updated_at = NOW()
        WHERE account_id = $1
    """, account_id, json.dumps(plan_json))

    # ─── 7. Summary ───
    total_solar = round(plan.total_solar_kwh, 1)
    summary = f"Predicted {total_solar} kWh solar today"

    logger.info("Forecast complete for %s: %s", account_id, summary)

    return {
        "status": "ok",
        "plan_summary": summary,
        "timeline": timeline,
    }


async def run_all_accounts(pool: asyncpg.Pool):
    """Run forecast for all accounts with Tesla connected. Called by scheduler."""
    accounts = await pool.fetch("""
        SELECT id FROM accounts WHERE tesla_email IS NOT NULL
    """)

    for acct in accounts:
        try:
            await run_optimization(pool, acct["id"])
        except Exception as exc:
            logger.exception("Forecast failed for account %s: %s", acct["id"], exc)
