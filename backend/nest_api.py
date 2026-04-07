"""
Nest (Google SDM) integration: OAuth, device status, thermostat commands.

Google Smart Device Management API:
  - OAuth 2.0 via Google identity + Nest Partner Connections Manager
  - Device traits: Temperature, ThermostatMode, ThermostatTemperatureSetpoint, ThermostatHvac
  - Commands: SetMode, SetHeat, SetCool, SetRange, SetEcoMode
"""

import json
import logging
import os
from datetime import datetime, timezone
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from backend.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/nest", tags=["nest"])

# ─── Config from env ───
NEST_PROJECT_ID = os.getenv("NEST_PROJECT_ID", "")          # Device Access project ID
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
NEST_REDIRECT_URI = os.getenv("NEST_REDIRECT_URI", "")      # e.g. https://selfpower.vixmixlabs.com/auth/nest/callback

GOOGLE_AUTH_URL = "https://nestservices.google.com/partnerconnections/{project_id}/auth"
GOOGLE_TOKEN_URL = "https://www.googleapis.com/oauth2/v4/token"
SDM_API_BASE = "https://smartdevicemanagement.googleapis.com/v1"

NEST_KV_KEY = "nest_token_cache"


# ─── Request models ───

class NestCompleteRequest(BaseModel):
    code: str

class ThermostatCommandRequest(BaseModel):
    device_id: str
    command: str         # "SetMode", "SetHeat", "SetCool", "SetRange", "SetEcoMode"
    params: dict         # e.g. {"mode": "COOL"} or {"coolCelsius": 23.0}


# ─── Token helpers ───

async def _get_nest_tokens(pool, account_id) -> dict | None:
    """Load Nest OAuth tokens from kv_store."""
    row = await pool.fetchval(
        "SELECT value FROM kv_store WHERE key = $1 AND account_id = $2",
        NEST_KV_KEY, account_id,
    )
    if row:
        return json.loads(row) if isinstance(row, str) else row
    return None


async def _save_nest_tokens(pool, account_id, tokens: dict):
    """Persist Nest OAuth tokens to kv_store."""
    await pool.execute(
        """INSERT INTO kv_store (key, account_id, value, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW())
           ON CONFLICT (key, account_id)
           DO UPDATE SET value = $3::jsonb, updated_at = NOW()""",
        NEST_KV_KEY, account_id, json.dumps(tokens),
    )


async def _refresh_access_token(pool, account_id, tokens: dict) -> dict:
    """Use refresh_token to get a new access_token from Google."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": tokens["refresh_token"],
            "grant_type": "refresh_token",
        })
        resp.raise_for_status()
        data = resp.json()

    tokens["access_token"] = data["access_token"]
    if "refresh_token" in data:
        tokens["refresh_token"] = data["refresh_token"]
    tokens["expires_at"] = datetime.now(timezone.utc).timestamp() + data.get("expires_in", 3600)
    await _save_nest_tokens(pool, account_id, tokens)
    return tokens


async def _get_valid_token(pool, account_id) -> str:
    """Get a valid Nest access token, refreshing if expired."""
    tokens = await _get_nest_tokens(pool, account_id)
    if not tokens:
        raise HTTPException(status_code=400, detail="Nest not connected")

    # Refresh if expired or expiring within 60 seconds
    expires_at = tokens.get("expires_at", 0)
    if datetime.now(timezone.utc).timestamp() > expires_at - 60:
        tokens = await _refresh_access_token(pool, account_id, tokens)

    return tokens["access_token"]


async def _sdm_request(pool, account_id, method: str, path: str, json_body: dict | None = None) -> dict:
    """Make an authenticated request to the SDM API."""
    token = await _get_valid_token(pool, account_id)
    url = f"{SDM_API_BASE}/enterprises/{NEST_PROJECT_ID}/{path}"

    async with httpx.AsyncClient() as client:
        resp = await client.request(
            method, url,
            headers={"Authorization": f"Bearer {token}"},
            json=json_body,
            timeout=15.0,
        )

        # If 401, try refreshing once
        if resp.status_code == 401:
            tokens = await _get_nest_tokens(pool, account_id)
            if tokens:
                tokens = await _refresh_access_token(pool, account_id, tokens)
                resp = await client.request(
                    method, url,
                    headers={"Authorization": f"Bearer {tokens['access_token']}"},
                    json=json_body,
                    timeout=15.0,
                )

        resp.raise_for_status()
        return resp.json() if resp.content else {}


# ─── OAuth endpoints ───

@router.post("/auth/start")
async def nest_auth_start(request: Request, user: dict = Depends(get_current_user)):
    """Generate Google/Nest OAuth URL for the user to visit."""
    if not NEST_PROJECT_ID or not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Nest integration not configured")

    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    # Check if already connected
    tokens = await _get_nest_tokens(pool, account_id)
    if tokens and tokens.get("refresh_token"):
        return {"status": "already_connected"}

    import secrets
    state = secrets.token_urlsafe(32)

    # Save state for CSRF verification
    await pool.execute(
        """INSERT INTO kv_store (key, account_id, value, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW())
           ON CONFLICT (key, account_id)
           DO UPDATE SET value = $3::jsonb, updated_at = NOW()""",
        "nest_oauth_state", account_id, json.dumps({"state": state}),
    )

    auth_url = GOOGLE_AUTH_URL.format(project_id=NEST_PROJECT_ID)
    params = (
        f"?redirect_uri={NEST_REDIRECT_URI}"
        f"&access_type=offline"
        f"&prompt=consent"
        f"&client_id={GOOGLE_CLIENT_ID}"
        f"&response_type=code"
        f"&scope=https://www.googleapis.com/auth/sdm.service"
        f"&state={state}"
    )

    return {"authorization_url": auth_url + params, "state": state}


@router.post("/auth/complete")
async def nest_auth_complete(body: NestCompleteRequest, request: Request, user: dict = Depends(get_current_user)):
    """Exchange authorization code for tokens and discover Nest devices."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(GOOGLE_TOKEN_URL, data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "code": body.code,
                "grant_type": "authorization_code",
                "redirect_uri": NEST_REDIRECT_URI,
            })
            resp.raise_for_status()
            token_data = resp.json()
    except Exception as exc:
        logger.exception("Nest token exchange failed: %s", exc)
        raise HTTPException(status_code=400, detail=f"Nest authentication failed: {exc}")

    tokens = {
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_at": datetime.now(timezone.utc).timestamp() + token_data.get("expires_in", 3600),
    }
    await _save_nest_tokens(pool, account_id, tokens)
    logger.info("Nest OAuth: tokens saved for account %s", account_id)

    # Discover thermostat devices
    devices = []
    try:
        result = await _sdm_request(pool, account_id, "GET", "devices")
        for device in result.get("devices", []):
            if device.get("type") == "sdm.devices.types.THERMOSTAT":
                # Extract device ID from full name: enterprises/{pid}/devices/{did}
                device_id = device["name"].split("/")[-1]
                traits = device.get("traits", {})
                display_name = _get_display_name(device)
                devices.append({
                    "device_id": device_id,
                    "display_name": display_name,
                    "type": "thermostat",
                })
                logger.info("Nest thermostat found: %s (%s)", display_name, device_id)
    except Exception as exc:
        logger.warning("Nest device discovery failed: %s", exc)

    # Update account
    await pool.execute(
        "UPDATE accounts SET nest_connected = TRUE WHERE id = $1",
        account_id,
    )

    # Clean up OAuth state
    await pool.execute(
        "DELETE FROM kv_store WHERE key = 'nest_oauth_state' AND account_id = $1",
        account_id,
    )

    return {"status": "ok", "devices": devices}


@router.delete("/disconnect")
async def nest_disconnect(request: Request, user: dict = Depends(get_current_user)):
    """Disconnect Nest — remove tokens."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    await pool.execute(
        "DELETE FROM kv_store WHERE key = $1 AND account_id = $2",
        NEST_KV_KEY, account_id,
    )
    await pool.execute(
        "UPDATE accounts SET nest_connected = FALSE WHERE id = $1",
        account_id,
    )

    logger.info("Nest disconnected: account=%s", account_id)
    return {"status": "ok"}


# ─── Helpers ───

def _get_display_name(device: dict) -> str:
    """Get best display name: customName → parentRelations room → 'Thermostat'."""
    traits = device.get("traits", {})
    custom = traits.get("sdm.devices.traits.Info", {}).get("customName", "")
    if custom and custom.strip():
        return custom.strip()
    # Fall back to room name from parentRelations
    for rel in device.get("parentRelations", []):
        room = rel.get("displayName", "")
        if room and room.strip():
            return room.strip()
    return "Thermostat"


# ─── Device status ───

@router.get("/devices")
async def list_devices(request: Request, user: dict = Depends(get_current_user)):
    """List all Nest thermostat devices."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    result = await _sdm_request(pool, account_id, "GET", "devices")
    devices = []
    for device in result.get("devices", []):
        if device.get("type") == "sdm.devices.types.THERMOSTAT":
            device_id = device["name"].split("/")[-1]
            traits = device.get("traits", {})
            devices.append({
                "device_id": device_id,
                "display_name": _get_display_name(device),
                "ambient_temp_c": traits.get("sdm.devices.traits.Temperature", {}).get("ambientTemperatureCelsius"),
                "humidity_pct": traits.get("sdm.devices.traits.Humidity", {}).get("ambientHumidityPercent"),
                "mode": traits.get("sdm.devices.traits.ThermostatMode", {}).get("mode"),
                "hvac_status": traits.get("sdm.devices.traits.ThermostatHvac", {}).get("status"),
                "heat_setpoint_c": traits.get("sdm.devices.traits.ThermostatTemperatureSetpoint", {}).get("heatCelsius"),
                "cool_setpoint_c": traits.get("sdm.devices.traits.ThermostatTemperatureSetpoint", {}).get("coolCelsius"),
                "eco_mode": traits.get("sdm.devices.traits.ThermostatEco", {}).get("mode"),
                "connectivity": traits.get("sdm.devices.traits.Connectivity", {}).get("status"),
            })

    return {"devices": devices}


@router.get("/devices/{device_id}/status")
async def device_status(device_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Get current status of a specific Nest thermostat."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    result = await _sdm_request(pool, account_id, "GET", f"devices/{device_id}")
    traits = result.get("traits", {})

    ambient_c = traits.get("sdm.devices.traits.Temperature", {}).get("ambientTemperatureCelsius")
    return {
        "device_id": device_id,
        "display_name": _get_display_name(result),
        "ambient_temp_c": ambient_c,
        "ambient_temp_f": round(ambient_c * 9/5 + 32, 1) if ambient_c is not None else None,
        "humidity_pct": traits.get("sdm.devices.traits.Humidity", {}).get("ambientHumidityPercent"),
        "mode": traits.get("sdm.devices.traits.ThermostatMode", {}).get("mode"),
        "available_modes": traits.get("sdm.devices.traits.ThermostatMode", {}).get("availableModes", []),
        "hvac_status": traits.get("sdm.devices.traits.ThermostatHvac", {}).get("status"),
        "heat_setpoint_c": traits.get("sdm.devices.traits.ThermostatTemperatureSetpoint", {}).get("heatCelsius"),
        "cool_setpoint_c": traits.get("sdm.devices.traits.ThermostatTemperatureSetpoint", {}).get("coolCelsius"),
        "eco_mode": traits.get("sdm.devices.traits.ThermostatEco", {}).get("mode"),
        "eco_heat_c": traits.get("sdm.devices.traits.ThermostatEco", {}).get("heatCelsius"),
        "eco_cool_c": traits.get("sdm.devices.traits.ThermostatEco", {}).get("coolCelsius"),
        "connectivity": traits.get("sdm.devices.traits.Connectivity", {}).get("status"),
    }


# ─── Thermostat commands ───

COMMAND_MAP = {
    "SetMode": "sdm.devices.commands.ThermostatMode.SetMode",
    "SetHeat": "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat",
    "SetCool": "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
    "SetRange": "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange",
    "SetEcoMode": "sdm.devices.commands.ThermostatEco.SetMode",
}


@router.post("/devices/{device_id}/command")
async def send_command(device_id: str, body: ThermostatCommandRequest, request: Request, user: dict = Depends(get_current_user)):
    """Send a command to a Nest thermostat."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    sdm_command = COMMAND_MAP.get(body.command)
    if not sdm_command:
        raise HTTPException(status_code=400, detail=f"Unknown command: {body.command}. Valid: {list(COMMAND_MAP.keys())}")

    result = await _sdm_request(
        pool, account_id, "POST",
        f"devices/{device_id}:executeCommand",
        json_body={"command": sdm_command, "params": body.params},
    )

    logger.info("Nest command sent: device=%s cmd=%s params=%s account=%s",
                device_id, body.command, body.params, account_id)
    return {"status": "ok", "result": result}


# ─── Convenience endpoints for the optimizer ───

@router.post("/devices/{device_id}/set-cool")
async def set_cool_temp(device_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Set cooling setpoint. Body: {"temp_f": 72}"""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    body = await request.json()
    temp_f = body.get("temp_f")
    if temp_f is None:
        raise HTTPException(status_code=400, detail="temp_f required")

    temp_c = round((temp_f - 32) * 5/9, 1)
    await _sdm_request(
        pool, account_id, "POST",
        f"devices/{device_id}:executeCommand",
        json_body={
            "command": "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
            "params": {"coolCelsius": temp_c},
        },
    )

    logger.info("Nest set cool: device=%s temp=%s°F (%s°C) account=%s",
                device_id, temp_f, temp_c, account_id)
    return {"status": "ok", "temp_f": temp_f, "temp_c": temp_c}


@router.post("/devices/{device_id}/set-eco")
async def set_eco_mode(device_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Toggle eco mode. Body: {"enabled": true}"""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    body = await request.json()
    enabled = body.get("enabled", True)
    mode = "MANUAL_ECO" if enabled else "OFF"

    await _sdm_request(
        pool, account_id, "POST",
        f"devices/{device_id}:executeCommand",
        json_body={
            "command": "sdm.devices.commands.ThermostatEco.SetMode",
            "params": {"mode": mode},
        },
    )

    logger.info("Nest eco mode: device=%s enabled=%s account=%s", device_id, enabled, account_id)
    return {"status": "ok", "eco_mode": mode}


@router.post("/devices/{device_id}/set-mode")
async def set_thermostat_mode(device_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Set thermostat mode. Body: {"mode": "COOL" | "HEAT" | "HEATCOOL" | "OFF"}

    If switching away from Eco, first disable Eco, then set the mode.
    If switching TO Eco, just enable Eco (keeps underlying mode).
    """
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    body = await request.json()
    target_mode = body.get("mode", "OFF").upper()

    if target_mode == "ECO":
        # Enable Eco mode
        await _sdm_request(
            pool, account_id, "POST",
            f"devices/{device_id}:executeCommand",
            json_body={
                "command": "sdm.devices.commands.ThermostatEco.SetMode",
                "params": {"mode": "MANUAL_ECO"},
            },
        )
        logger.info("Nest set mode: device=%s mode=ECO account=%s", device_id, account_id)
        return {"status": "ok", "mode": "ECO", "eco_mode": "MANUAL_ECO"}

    # Disable Eco first (if active), then set mode
    await _sdm_request(
        pool, account_id, "POST",
        f"devices/{device_id}:executeCommand",
        json_body={
            "command": "sdm.devices.commands.ThermostatEco.SetMode",
            "params": {"mode": "OFF"},
        },
    )

    if target_mode != "OFF":
        await _sdm_request(
            pool, account_id, "POST",
            f"devices/{device_id}:executeCommand",
            json_body={
                "command": "sdm.devices.commands.ThermostatMode.SetMode",
                "params": {"mode": target_mode},
            },
        )
    else:
        await _sdm_request(
            pool, account_id, "POST",
            f"devices/{device_id}:executeCommand",
            json_body={
                "command": "sdm.devices.commands.ThermostatMode.SetMode",
                "params": {"mode": "OFF"},
            },
        )

    logger.info("Nest set mode: device=%s mode=%s account=%s", device_id, target_mode, account_id)
    return {"status": "ok", "mode": target_mode, "eco_mode": "OFF"}
