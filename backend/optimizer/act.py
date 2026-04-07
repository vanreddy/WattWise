"""
Action module: execute optimization plan by sending device commands.

Powerwall: Tesla API set_backup_reserve_percent / set_operation
Nest: SDM API thermostat commands (via nest_api helpers)
EV: Read-only for now (Phase 2: Wall Connector control)
"""

import logging
import os
from datetime import datetime, timezone
from uuid import UUID

import asyncpg
import teslapy

from backend.optimizer.score import HourPlan, DeviceState

logger = logging.getLogger(__name__)


# ─── Powerwall Control ───

def _get_tesla_site(email: str, account_id: UUID):
    """Get TeslaPy site object for Powerwall commands."""
    from backend.poller import _get_tesla_client

    with _get_tesla_client(email, account_id) as tesla:
        if not tesla.authorized:
            raise RuntimeError("Tesla not authorized")
        products = tesla.battery_list() + tesla.solar_list()
        if not products:
            raise RuntimeError("No energy sites found")
        return products[0], tesla


async def set_pw_reserve(pool: asyncpg.Pool, account_id: UUID, reserve_pct: int) -> bool:
    """Set Powerwall backup reserve percentage (0-100).

    Higher reserve = PW holds more charge (effectively forcing charge).
    Lower reserve = PW can discharge more.
    """
    try:
        email = await pool.fetchval(
            "SELECT tesla_email FROM accounts WHERE id = $1", account_id
        )
        if not email:
            logger.error("No tesla_email for account %s", account_id)
            return False

        import asyncio
        loop = asyncio.get_event_loop()

        def _set():
            from backend.poller import _get_tesla_client
            with _get_tesla_client(email, account_id) as tesla:
                if not tesla.authorized:
                    return False
                products = tesla.battery_list() + tesla.solar_list()
                if not products:
                    return False
                site = products[0]
                site.set_backup_reserve_percent(reserve_pct)
                return True

        result = await loop.run_in_executor(None, _set)
        if result:
            logger.info("PW reserve set to %d%% for account %s", reserve_pct, account_id)
        return result

    except Exception as exc:
        logger.error("Failed to set PW reserve: %s", exc)
        return False


async def set_pw_mode(pool: asyncpg.Pool, account_id: UUID, mode: str) -> bool:
    """Set Powerwall operation mode: 'self_consumption', 'backup', 'autonomous'."""
    try:
        email = await pool.fetchval(
            "SELECT tesla_email FROM accounts WHERE id = $1", account_id
        )
        if not email:
            return False

        import asyncio
        loop = asyncio.get_event_loop()

        def _set():
            from backend.poller import _get_tesla_client
            with _get_tesla_client(email, account_id) as tesla:
                if not tesla.authorized:
                    return False
                products = tesla.battery_list() + tesla.solar_list()
                if not products:
                    return False
                site = products[0]
                site.set_operation(mode)
                return True

        result = await loop.run_in_executor(None, _set)
        if result:
            logger.info("PW mode set to %s for account %s", mode, account_id)
        return result

    except Exception as exc:
        logger.error("Failed to set PW mode: %s", exc)
        return False


# ─── Nest Control ───

async def set_nest_temp(pool: asyncpg.Pool, account_id: UUID, device_id: str, temp_f: float) -> bool:
    """Set Nest cooling setpoint."""
    try:
        from backend.nest_api import _sdm_request
        temp_c = round((temp_f - 32) * 5 / 9, 1)
        await _sdm_request(
            pool, account_id, "POST",
            f"devices/{device_id}:executeCommand",
            json_body={
                "command": "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
                "params": {"coolCelsius": temp_c},
            },
        )
        logger.info("Nest set cool %s°F device=%s account=%s", temp_f, device_id, account_id)
        return True
    except Exception as exc:
        logger.error("Failed to set Nest temp: %s", exc)
        return False


async def set_nest_eco(pool: asyncpg.Pool, account_id: UUID, device_id: str, enabled: bool) -> bool:
    """Set Nest eco mode on/off."""
    try:
        from backend.nest_api import _sdm_request
        mode = "MANUAL_ECO" if enabled else "OFF"
        await _sdm_request(
            pool, account_id, "POST",
            f"devices/{device_id}:executeCommand",
            json_body={
                "command": "sdm.devices.commands.ThermostatEco.SetMode",
                "params": {"mode": mode},
            },
        )
        logger.info("Nest eco=%s device=%s account=%s", enabled, device_id, account_id)
        return True
    except Exception as exc:
        logger.error("Failed to set Nest eco: %s", exc)
        return False


# ─── Log Action ───

async def log_action(
    pool: asyncpg.Pool,
    account_id: UUID,
    action: str,
    device: str,
    reason: str,
    details: dict | None = None,
) -> None:
    """Write to optimizer_log table."""
    await pool.execute("""
        INSERT INTO optimizer_log (account_id, ts, action, device, reason, details)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    """, account_id, datetime.now(timezone.utc), action, device, reason,
       __import__("json").dumps(details or {}))


# ─── Execute Plan ───

async def execute_hour(
    pool: asyncpg.Pool,
    account_id: UUID,
    hour_plan: HourPlan,
    state: DeviceState,
    nest_device_ids: list[str] | None = None,
) -> list[str]:
    """Execute the actions for a single hour of the plan.

    Returns list of actions taken (for activity log).
    """
    actions_taken: list[str] = []

    # ─── Powerwall ───
    if hour_plan.pw_action == "charge":
        # Raise reserve to encourage charging
        target_reserve = min(100, int(state.pw_soc_pct + 20))
        success = await set_pw_reserve(pool, account_id, target_reserve)
        if success:
            desc = f"PW charging — reserve raised to {target_reserve}%"
            await log_action(pool, account_id, "pw_charge", "powerwall",
                             hour_plan.reason, {"target_reserve": target_reserve})
            actions_taken.append(desc)

    elif hour_plan.pw_action == "discharge":
        # Lower reserve to allow discharge
        target_reserve = max(int(state.pw_reserve_pct), 10)
        success = await set_pw_reserve(pool, account_id, target_reserve)
        if success:
            desc = f"PW discharging — reserve at {target_reserve}%"
            await log_action(pool, account_id, "pw_discharge", "powerwall",
                             hour_plan.reason, {"target_reserve": target_reserve})
            actions_taken.append(desc)

    # ─── HVAC ───
    if hour_plan.hvac_action == "precool" and hour_plan.hvac_setpoint_f and nest_device_ids:
        for device_id in nest_device_ids:
            success = await set_nest_temp(pool, account_id, device_id, hour_plan.hvac_setpoint_f)
            if success:
                desc = f"Nest set to {hour_plan.hvac_setpoint_f:.0f}°F (pre-cool)"
                actions_taken.append(desc)
        if actions_taken:
            await log_action(pool, account_id, "hvac_setpoint", "nest",
                             hour_plan.reason, {"setpoint_f": hour_plan.hvac_setpoint_f})

    elif hour_plan.hvac_action == "eco" and nest_device_ids:
        for device_id in nest_device_ids:
            await set_nest_eco(pool, account_id, device_id, True)
        desc = "Nest switched to Eco mode (peak hours)"
        await log_action(pool, account_id, "hvac_eco", "nest", hour_plan.reason)
        actions_taken.append(desc)

    # ─── EV ───
    if hour_plan.ev_action == "charge":
        # Phase 2: control via Wall Connector
        # For now: just log recommendation
        desc = f"EV should charge at {hour_plan.ev_target_w/1000:.1f}kW"
        await log_action(pool, account_id, "ev_recommend", "ev",
                         hour_plan.reason, {"target_w": hour_plan.ev_target_w})
        actions_taken.append(desc)

    return actions_taken
