"""
Smartcar integration for BMW iX: OAuth, battery status, charge control.

Smartcar API:
  - Standard OAuth 2.0 with Smartcar Connect consent flow
  - Read: battery level, charge status, plug state
  - Control: start_charge, stop_charge
  - BMW iX requires OS Version 8+ (supported)
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

router = APIRouter(prefix="/smartcar", tags=["smartcar"])

# ─── Config from env ───
SMARTCAR_CLIENT_ID = os.getenv("SMARTCAR_CLIENT_ID", "")
SMARTCAR_CLIENT_SECRET = os.getenv("SMARTCAR_CLIENT_SECRET", "")
SMARTCAR_REDIRECT_URI = os.getenv("SMARTCAR_REDIRECT_URI", "")  # e.g. https://selfpower.vixmixlabs.com/auth/smartcar/callback
SMARTCAR_MODE = os.getenv("SMARTCAR_MODE", "simulated")         # "simulated" or "live"

SMARTCAR_AUTH_URL = "https://connect.smartcar.com/oauth/authorize"
SMARTCAR_TOKEN_URL = "https://auth.smartcar.com/oauth/token"
SMARTCAR_API_BASE = "https://api.smartcar.com/v2.0"

SMARTCAR_KV_KEY = "smartcar_token_cache"


# ─── Request models ───

class SmartcarCompleteRequest(BaseModel):
    code: str


# ─── Token helpers ───

async def _get_smartcar_tokens(pool, account_id) -> dict | None:
    """Load Smartcar OAuth tokens from kv_store."""
    row = await pool.fetchval(
        "SELECT value FROM kv_store WHERE key = $1 AND account_id = $2",
        SMARTCAR_KV_KEY, account_id,
    )
    if row:
        return json.loads(row) if isinstance(row, str) else row
    return None


async def _save_smartcar_tokens(pool, account_id, tokens: dict):
    """Persist Smartcar OAuth tokens to kv_store."""
    await pool.execute(
        """INSERT INTO kv_store (key, account_id, value, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW())
           ON CONFLICT (key, account_id)
           DO UPDATE SET value = $3::jsonb, updated_at = NOW()""",
        SMARTCAR_KV_KEY, account_id, json.dumps(tokens),
    )


async def _refresh_smartcar_token(pool, account_id, tokens: dict) -> dict:
    """Use refresh_token to get a new access_token from Smartcar."""
    import base64
    credentials = base64.b64encode(
        f"{SMARTCAR_CLIENT_ID}:{SMARTCAR_CLIENT_SECRET}".encode()
    ).decode()

    async with httpx.AsyncClient() as client:
        resp = await client.post(SMARTCAR_TOKEN_URL, data={
            "grant_type": "refresh_token",
            "refresh_token": tokens["refresh_token"],
        }, headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        })
        resp.raise_for_status()
        data = resp.json()

    tokens["access_token"] = data["access_token"]
    if "refresh_token" in data:
        tokens["refresh_token"] = data["refresh_token"]
    tokens["expires_at"] = datetime.now(timezone.utc).timestamp() + data.get("expires_in", 7200)
    await _save_smartcar_tokens(pool, account_id, tokens)
    return tokens


async def _get_valid_token(pool, account_id) -> str:
    """Get a valid Smartcar access token, refreshing if expired."""
    tokens = await _get_smartcar_tokens(pool, account_id)
    if not tokens:
        raise HTTPException(status_code=400, detail="Smartcar (BMW) not connected")

    expires_at = tokens.get("expires_at", 0)
    if datetime.now(timezone.utc).timestamp() > expires_at - 60:
        tokens = await _refresh_smartcar_token(pool, account_id, tokens)

    return tokens["access_token"]


async def _smartcar_request(pool, account_id, method: str, path: str, json_body: dict | None = None) -> dict:
    """Make an authenticated request to the Smartcar API."""
    token = await _get_valid_token(pool, account_id)
    url = f"{SMARTCAR_API_BASE}{path}"

    async with httpx.AsyncClient() as client:
        resp = await client.request(
            method, url,
            headers={"Authorization": f"Bearer {token}"},
            json=json_body,
            timeout=30.0,  # Smartcar can be slow (wakes up car)
        )

        # If 401, try refreshing once
        if resp.status_code == 401:
            tokens = await _get_smartcar_tokens(pool, account_id)
            if tokens:
                tokens = await _refresh_smartcar_token(pool, account_id, tokens)
                resp = await client.request(
                    method, url,
                    headers={"Authorization": f"Bearer {tokens['access_token']}"},
                    json=json_body,
                    timeout=30.0,
                )

        resp.raise_for_status()
        return resp.json() if resp.content else {}


# ─── OAuth endpoints ───

@router.post("/auth/start")
async def smartcar_auth_start(request: Request, user: dict = Depends(get_current_user)):
    """Generate Smartcar Connect OAuth URL."""
    if not SMARTCAR_CLIENT_ID:
        raise HTTPException(status_code=500, detail="Smartcar integration not configured")

    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    # Check if already connected
    tokens = await _get_smartcar_tokens(pool, account_id)
    if tokens and tokens.get("refresh_token"):
        return {"status": "already_connected"}

    import secrets
    state = secrets.token_urlsafe(32)

    await pool.execute(
        """INSERT INTO kv_store (key, account_id, value, updated_at)
           VALUES ($1, $2, $3::jsonb, NOW())
           ON CONFLICT (key, account_id)
           DO UPDATE SET value = $3::jsonb, updated_at = NOW()""",
        "smartcar_oauth_state", account_id, json.dumps({"state": state}),
    )

    params = (
        f"?response_type=code"
        f"&client_id={SMARTCAR_CLIENT_ID}"
        f"&redirect_uri={SMARTCAR_REDIRECT_URI}"
        f"&scope=read_vehicle_info read_battery read_charge control_charge"
        f"&state={state}"
        f"&mode={SMARTCAR_MODE}"
        f"&make=BMW"  # Pre-filter to BMW in Smartcar Connect
    )

    return {"authorization_url": SMARTCAR_AUTH_URL + params, "state": state}


@router.post("/auth/complete")
async def smartcar_auth_complete(body: SmartcarCompleteRequest, request: Request, user: dict = Depends(get_current_user)):
    """Exchange authorization code for tokens and discover vehicles."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    import base64
    credentials = base64.b64encode(
        f"{SMARTCAR_CLIENT_ID}:{SMARTCAR_CLIENT_SECRET}".encode()
    ).decode()

    # Exchange code for tokens
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(SMARTCAR_TOKEN_URL, data={
                "grant_type": "authorization_code",
                "code": body.code,
                "redirect_uri": SMARTCAR_REDIRECT_URI,
            }, headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
            })
            resp.raise_for_status()
            token_data = resp.json()
    except Exception as exc:
        logger.exception("Smartcar token exchange failed: %s", exc)
        raise HTTPException(status_code=400, detail=f"Smartcar authentication failed: {exc}")

    tokens = {
        "access_token": token_data["access_token"],
        "refresh_token": token_data.get("refresh_token"),
        "expires_at": datetime.now(timezone.utc).timestamp() + token_data.get("expires_in", 7200),
    }
    await _save_smartcar_tokens(pool, account_id, tokens)
    logger.info("Smartcar OAuth: tokens saved for account %s", account_id)

    # Discover vehicles
    vehicles = []
    try:
        result = await _smartcar_request(pool, account_id, "GET", "/vehicles")
        for vid in result.get("vehicles", []):
            # Get vehicle info
            info = await _smartcar_request(pool, account_id, "GET", f"/vehicles/{vid}")
            vehicles.append({
                "vehicle_id": vid,
                "make": info.get("make", ""),
                "model": info.get("model", ""),
                "year": info.get("year"),
            })
            logger.info("Smartcar vehicle found: %s %s %s (%s)",
                       info.get("year"), info.get("make"), info.get("model"), vid)
    except Exception as exc:
        logger.warning("Smartcar vehicle discovery failed: %s", exc)

    # Update account
    await pool.execute(
        "UPDATE accounts SET smartcar_connected = TRUE WHERE id = $1",
        account_id,
    )

    # Store vehicle IDs for future polling
    if vehicles:
        await pool.execute(
            """INSERT INTO kv_store (key, account_id, value, updated_at)
               VALUES ($1, $2, $3::jsonb, NOW())
               ON CONFLICT (key, account_id)
               DO UPDATE SET value = $3::jsonb, updated_at = NOW()""",
            "smartcar_vehicles", account_id, json.dumps(vehicles),
        )

    # Clean up OAuth state
    await pool.execute(
        "DELETE FROM kv_store WHERE key = 'smartcar_oauth_state' AND account_id = $1",
        account_id,
    )

    return {"status": "ok", "vehicles": vehicles}


@router.delete("/disconnect")
async def smartcar_disconnect(request: Request, user: dict = Depends(get_current_user)):
    """Disconnect Smartcar (BMW) — remove tokens and vehicle cache."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    for key in [SMARTCAR_KV_KEY, "smartcar_vehicles", "smartcar_oauth_state"]:
        await pool.execute(
            "DELETE FROM kv_store WHERE key = $1 AND account_id = $2",
            key, account_id,
        )
    await pool.execute(
        "UPDATE accounts SET smartcar_connected = FALSE WHERE id = $1",
        account_id,
    )

    logger.info("Smartcar disconnected: account=%s", account_id)
    return {"status": "ok"}


# ─── Vehicle status ───

@router.get("/vehicles")
async def list_vehicles(request: Request, user: dict = Depends(get_current_user)):
    """List connected vehicles."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    row = await pool.fetchval(
        "SELECT value FROM kv_store WHERE key = 'smartcar_vehicles' AND account_id = $1",
        account_id,
    )
    if not row:
        return {"vehicles": []}

    vehicles = json.loads(row) if isinstance(row, str) else row
    return {"vehicles": vehicles}


@router.get("/vehicles/{vehicle_id}/battery")
async def vehicle_battery(vehicle_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Get battery level and range for a vehicle."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    result = await _smartcar_request(pool, account_id, "GET", f"/vehicles/{vehicle_id}/battery")
    return {
        "vehicle_id": vehicle_id,
        "percent_remaining": result.get("percentRemaining"),
        "range_km": result.get("range"),
        "range_miles": round(result.get("range", 0) * 0.621371, 1) if result.get("range") else None,
    }


@router.get("/vehicles/{vehicle_id}/charge")
async def vehicle_charge_status(vehicle_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Get charge status (is it charging? is it plugged in?)."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    result = await _smartcar_request(pool, account_id, "GET", f"/vehicles/{vehicle_id}/charge")
    return {
        "vehicle_id": vehicle_id,
        "state": result.get("state"),        # "CHARGING", "NOT_CHARGING", "FULLY_CHARGED"
        "is_plugged_in": result.get("isPluggedIn"),
    }


@router.get("/vehicles/{vehicle_id}/status")
async def vehicle_full_status(vehicle_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Get combined battery + charge status for dashboard display."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    # Fetch battery and charge in parallel
    import asyncio
    battery_task = _smartcar_request(pool, account_id, "GET", f"/vehicles/{vehicle_id}/battery")
    charge_task = _smartcar_request(pool, account_id, "GET", f"/vehicles/{vehicle_id}/charge")
    battery, charge = await asyncio.gather(battery_task, charge_task, return_exceptions=True)

    result = {"vehicle_id": vehicle_id}

    if not isinstance(battery, Exception):
        result["percent_remaining"] = battery.get("percentRemaining")
        result["range_km"] = battery.get("range")
        result["range_miles"] = round(battery.get("range", 0) * 0.621371, 1) if battery.get("range") else None
    else:
        logger.warning("Smartcar battery read failed: %s", battery)

    if not isinstance(charge, Exception):
        result["charge_state"] = charge.get("state")
        result["is_plugged_in"] = charge.get("isPluggedIn")
    else:
        logger.warning("Smartcar charge read failed: %s", charge)

    return result


# ─── Charge control ───

@router.post("/vehicles/{vehicle_id}/charge/start")
async def start_charge(vehicle_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Start charging the vehicle."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    result = await _smartcar_request(
        pool, account_id, "POST",
        f"/vehicles/{vehicle_id}/charge",
        json_body={"action": "START"},
    )
    logger.info("Smartcar charge started: vehicle=%s account=%s", vehicle_id, account_id)
    return {"status": "ok", "result": result}


@router.post("/vehicles/{vehicle_id}/charge/stop")
async def stop_charge(vehicle_id: str, request: Request, user: dict = Depends(get_current_user)):
    """Stop charging the vehicle."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    result = await _smartcar_request(
        pool, account_id, "POST",
        f"/vehicles/{vehicle_id}/charge",
        json_body={"action": "STOP"},
    )
    logger.info("Smartcar charge stopped: vehicle=%s account=%s", vehicle_id, account_id)
    return {"status": "ok", "result": result}
