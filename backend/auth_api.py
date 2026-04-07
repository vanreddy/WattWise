"""WattWise auth endpoints: login, register, refresh, me, tesla-oauth."""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

import teslapy
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from backend.auth import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    hash_password,
    hash_refresh_token,
    verify_password,
    REFRESH_EXPIRE_DAYS,
)
from backend.backfill import backfill_account, get_backfill_status
from backend.poller import _make_cache_callbacks, _token_caches, _save_cache_to_db, TESLA_CACHE_KEY

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# --------------- request / response models ---------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    tesla_email: Optional[str] = None

class RefreshRequest(BaseModel):
    refresh_token: str

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class TeslaCompleteRequest(BaseModel):
    redirect_url: str
    state: str
    code_verifier: str


# --------------- helpers ---------------

async def _issue_tokens(pool, user_id: str, account_id: str) -> dict:
    """Create access + refresh tokens and store refresh hash in DB."""
    access = create_access_token(user_id, account_id)
    refresh = create_refresh_token()
    refresh_hash = hash_refresh_token(refresh)
    expires = datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS)

    await pool.execute(
        """INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
           VALUES ($1, $2, $3)""",
        UUID(user_id), refresh_hash, expires,
    )
    return {"access_token": access, "refresh_token": refresh}


# --------------- endpoints ---------------

@router.post("/login")
async def login(body: LoginRequest, request: Request):
    pool = request.app.state.pool

    row = await pool.fetchrow(
        "SELECT id, account_id, email, password_hash, role FROM users WHERE email = $1",
        body.email,
    )
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    tokens = await _issue_tokens(pool, str(row["id"]), str(row["account_id"]))
    return {
        **tokens,
        "user": {
            "id": str(row["id"]),
            "email": row["email"],
            "role": row["role"],
            "account_id": str(row["account_id"]),
        },
    }


@router.post("/register")
async def register(body: RegisterRequest, request: Request):
    pool = request.app.state.pool

    # Check if email is already taken
    existing = await pool.fetchval("SELECT id FROM users WHERE email = $1", body.email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # tesla_email is optional — can be linked later via Tesla OAuth onboarding
    if body.tesla_email:
        existing_acct = await pool.fetchval(
            "SELECT id FROM accounts WHERE tesla_email = $1", body.tesla_email,
        )
        if existing_acct:
            raise HTTPException(status_code=409, detail="Tesla account already linked")

    pw_hash = hash_password(body.password)

    async with pool.acquire() as conn:
        async with conn.transaction():
            acct = await conn.fetchrow(
                "INSERT INTO accounts (tesla_email) VALUES ($1) RETURNING id",
                body.tesla_email,  # can be NULL
            )
            user = await conn.fetchrow(
                """INSERT INTO users (account_id, email, password_hash, role)
                   VALUES ($1, $2, $3, 'primary') RETURNING id""",
                acct["id"], body.email, pw_hash,
            )

    account_id = str(acct["id"])
    user_id = str(user["id"])

    tokens = await _issue_tokens(pool, user_id, account_id)
    return {
        **tokens,
        "user": {
            "id": user_id,
            "email": body.email,
            "role": "primary",
            "account_id": account_id,
        },
    }


@router.post("/refresh")
async def refresh(body: RefreshRequest, request: Request):
    pool = request.app.state.pool
    token_hash = hash_refresh_token(body.refresh_token)

    row = await pool.fetchrow(
        """SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked,
                  u.account_id
           FROM refresh_tokens rt
           JOIN users u ON u.id = rt.user_id
           WHERE rt.token_hash = $1""",
        token_hash,
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if row["revoked"]:
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    if row["expires_at"] < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    # Revoke old token and issue new pair
    await pool.execute(
        "UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1", row["id"],
    )

    tokens = await _issue_tokens(pool, str(row["user_id"]), str(row["account_id"]))
    return tokens


@router.get("/me")
async def me(request: Request, user: dict = Depends(get_current_user)):
    pool = request.app.state.pool
    row = await pool.fetchrow(
        """SELECT u.id, u.email, u.role, u.account_id, u.created_at,
                  a.site_name, a.energy_site_id,
                  a.zip_code, a.latitude, a.longitude,
                  a.solar_capacity_kw, a.rate_plan_name,
                  COALESCE(a.nest_connected, FALSE) AS nest_connected,
                  COALESCE(a.smartcar_connected, FALSE) AS smartcar_connected
           FROM users u
           JOIN accounts a ON a.id = u.account_id
           WHERE u.id = $1""",
        UUID(user["user_id"]),
    )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    # Check if Tesla token cache exists for this account
    tesla_cache = await pool.fetchval(
        "SELECT 1 FROM kv_store WHERE key = 'tesla_token_cache' AND account_id = $1",
        row["account_id"],
    )

    return {
        "id": str(row["id"]),
        "email": row["email"],
        "role": row["role"],
        "account_id": str(row["account_id"]),
        "created_at": row["created_at"].isoformat(),
        "site_name": row["site_name"],
        "energy_site_id": row["energy_site_id"],
        "tesla_connected": tesla_cache is not None,
        "nest_connected": row["nest_connected"],
        "smartcar_connected": row["smartcar_connected"],
        "zip_code": row["zip_code"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "solar_capacity_kw": row["solar_capacity_kw"],
        "rate_plan_name": row["rate_plan_name"],
    }


@router.put("/me/password")
async def change_password(body: ChangePasswordRequest, request: Request, user: dict = Depends(get_current_user)):
    """Change the current user's password."""
    pool = request.app.state.pool

    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    row = await pool.fetchrow(
        "SELECT password_hash FROM users WHERE id = $1",
        UUID(user["user_id"]),
    )
    if not row or not verify_password(body.current_password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Current password is incorrect")

    new_hash = hash_password(body.new_password)
    await pool.execute(
        "UPDATE users SET password_hash = $1 WHERE id = $2",
        new_hash, UUID(user["user_id"]),
    )

    logger.info("Password changed: user=%s", user["user_id"])
    return {"status": "ok"}


@router.delete("/account/tesla")
async def disconnect_tesla(request: Request, user: dict = Depends(get_current_user)):
    """Disconnect Tesla account — clears cached OAuth tokens so polling stops."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    # Remove cached Tesla tokens
    await pool.execute(
        "DELETE FROM kv_store WHERE key = 'tesla_token_cache' AND account_id = $1",
        account_id,
    )

    # Clear site metadata
    await pool.execute(
        "UPDATE accounts SET site_name = NULL, energy_site_id = NULL WHERE id = $1",
        account_id,
    )

    logger.info("Tesla disconnected: account=%s by user=%s", user["account_id"], user["user_id"])
    return {"status": "ok"}


# --------------- Tesla OAuth web flow ---------------

@router.post("/tesla/start")
async def tesla_oauth_start(request: Request, user: dict = Depends(get_current_user)):
    """Generate a Tesla OAuth authorization URL for the user to open in their browser."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    # Get tesla_email from accounts (may be null if not set yet)
    tesla_email = await pool.fetchval("SELECT tesla_email FROM accounts WHERE id = $1", account_id)
    if not tesla_email:
        raise HTTPException(
            status_code=400,
            detail="Set your Tesla email first (included during registration)",
        )

    # Create TeslaPy client and generate auth URL
    loader, dumper = _make_cache_callbacks(account_id)
    with teslapy.Tesla(tesla_email, cache_loader=loader, cache_dumper=dumper) as tesla:
        if tesla.authorized:
            # Verify the token actually works (it might be expired)
            try:
                tesla.battery_list()  # quick API call to confirm token works
                return {"status": "already_connected", "message": "Tesla is already connected"}
            except Exception:
                pass  # Token expired/invalid — proceed to re-auth

        state = tesla.new_state()
        code_verifier = tesla.new_code_verifier()
        url = tesla.authorization_url(state=state, code_verifier=code_verifier)

    return {
        "authorization_url": url,
        "state": state,
        "code_verifier": code_verifier,
    }


@router.post("/tesla/complete")
async def tesla_oauth_complete(body: TeslaCompleteRequest, request: Request, user: dict = Depends(get_current_user)):
    """Complete Tesla OAuth — exchange the redirect URL for tokens and fetch site info."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    tesla_email = await pool.fetchval("SELECT tesla_email FROM accounts WHERE id = $1", account_id)
    if not tesla_email:
        raise HTTPException(status_code=400, detail="Tesla email not set on account")

    loader, dumper = _make_cache_callbacks(account_id)
    try:
        with teslapy.Tesla(tesla_email, cache_loader=loader, cache_dumper=dumper) as tesla:
            tesla.fetch_token(
                authorization_response=body.redirect_url,
                code_verifier=body.code_verifier,
            )

            # Fetch site info + SITE_CONFIG for metadata
            site_name = None
            energy_site_id = None
            zip_code = None
            latitude = None
            longitude = None
            solar_capacity_kw = None
            rate_plan_name = None
            tariff_content = None

            products = tesla.battery_list() + tesla.solar_list()
            if products:
                site = products[0]
                site_name = site.get("site_name")
                energy_site_id = str(site.get("energy_site_id", ""))

                # Fetch detailed site config for zip, rates, capacity
                try:
                    config = site.api("SITE_CONFIG")["response"]
                    address = config.get("address", {})
                    zip_code = address.get("zip")
                    geo = config.get("geolocation", {})
                    latitude = geo.get("latitude")
                    longitude = geo.get("longitude")
                    nameplate = config.get("nameplate_power")
                    if nameplate:
                        solar_capacity_kw = round(nameplate / 1000, 2)
                    tariff = config.get("tariff_content", {})
                    if tariff:
                        rate_plan_name = tariff.get("name")
                        tariff_content = tariff
                    logger.info("Tesla SITE_CONFIG: zip=%s lat=%s lon=%s solar=%.1fkW plan=%s",
                                zip_code, latitude, longitude, solar_capacity_kw or 0, rate_plan_name)
                except Exception as cfg_err:
                    logger.warning("Failed to fetch SITE_CONFIG: %s", cfg_err)
    except Exception as exc:
        logger.exception("Tesla OAuth exchange failed: %s", exc)
        raise HTTPException(status_code=400, detail=f"Tesla authentication failed: {exc}")

    # Save token cache to DB
    await _save_cache_to_db(pool, account_id)
    logger.info("Tesla OAuth: token saved to DB for account %s", account_id)

    # Update account with all site metadata
    import json as _json
    await pool.execute(
        """UPDATE accounts SET
            site_name = $1, energy_site_id = $2,
            zip_code = $3, latitude = $4, longitude = $5,
            solar_capacity_kw = $6, rate_plan_name = $7,
            tariff_content = $8
        WHERE id = $9""",
        site_name, energy_site_id,
        zip_code, latitude, longitude,
        solar_capacity_kw, rate_plan_name,
        _json.dumps(tariff_content) if tariff_content else None,
        account_id,
    )

    logger.info("Tesla connected: account=%s site=%s zip=%s plan=%s", account_id, site_name, zip_code, rate_plan_name)

    # Kick off full historical backfill in the background (all available history)
    import asyncio
    asyncio.create_task(backfill_account(pool, account_id, days=3650, include_today=True))

    return {
        "status": "ok",
        "site_name": site_name,
        "energy_site_id": energy_site_id,
    }


# --------------- Backfill status ---------------

@router.get("/account/backfill/status")
async def backfill_status(request: Request, user: dict = Depends(get_current_user)):
    """Get the backfill progress for the current account."""
    account_id = UUID(user["account_id"])
    status = get_backfill_status(account_id)

    # Also check how many days of data actually exist in the DB
    pool = request.app.state.pool
    days_in_db = await pool.fetchval(
        """SELECT COUNT(DISTINCT day) FROM daily_summaries WHERE account_id = $1""",
        account_id,
    )

    return {
        **status,
        "days_in_db": days_in_db or 0,
    }


# --------------- Manual backfill trigger ---------------

@router.post("/account/backfill/trigger")
async def trigger_backfill(request: Request, user: dict = Depends(get_current_user)):
    """Manually trigger a backfill for the current account."""
    import asyncio
    account_id = UUID(user["account_id"])
    pool = request.app.state.pool

    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    days = min(int(body.get("days", 3)), 365)
    include_today = body.get("include_today", True)

    asyncio.create_task(backfill_account(pool, account_id, days=days, include_today=include_today))

    return {"status": "started", "days": days, "include_today": include_today}
