"""WattWise auth endpoints: login, register, refresh, me, invite, telegram."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# --------------- request / response models ---------------

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    tesla_email: Optional[str] = None   # required for primary signup
    invite_token: Optional[str] = None  # required for secondary signup

class RefreshRequest(BaseModel):
    refresh_token: str

class InviteRequest(BaseModel):
    email: EmailStr

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

class TelegramUpdate(BaseModel):
    chat_id: str

class TelegramLinkRequest(BaseModel):
    code: str


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

    if body.invite_token:
        # --- Secondary user via invite ---
        invite = await pool.fetchrow(
            """SELECT id, account_id, email, expires_at, used_at FROM invites
               WHERE id = $1""",
            UUID(body.invite_token),
        )
        if not invite:
            raise HTTPException(status_code=404, detail="Invalid invite token")
        if invite["used_at"]:
            raise HTTPException(status_code=409, detail="Invite already used")
        if invite["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="Invite expired")
        if invite["email"].lower() != body.email.lower():
            raise HTTPException(status_code=403, detail="Email does not match invite")

        # Check max 2 users per account
        user_count = await pool.fetchval(
            "SELECT COUNT(*) FROM users WHERE account_id = $1",
            invite["account_id"],
        )
        if user_count >= 2:
            raise HTTPException(status_code=409, detail="Account already has 2 users")

        pw_hash = hash_password(body.password)
        user = await pool.fetchrow(
            """INSERT INTO users (account_id, email, password_hash, role)
               VALUES ($1, $2, $3, 'secondary') RETURNING id""",
            invite["account_id"], body.email, pw_hash,
        )

        # Mark invite as used
        await pool.execute(
            "UPDATE invites SET used_at = NOW() WHERE id = $1",
            invite["id"],
        )

        account_id = str(invite["account_id"])
        user_id = str(user["id"])
        role = "secondary"

    else:
        # --- Primary user: create new account ---
        if not body.tesla_email:
            raise HTTPException(
                status_code=400,
                detail="tesla_email is required when creating a new account",
            )

        # Check if Tesla email is already linked
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
                    body.tesla_email,
                )
                user = await conn.fetchrow(
                    """INSERT INTO users (account_id, email, password_hash, role)
                       VALUES ($1, $2, $3, 'primary') RETURNING id""",
                    acct["id"], body.email, pw_hash,
                )

        account_id = str(acct["id"])
        user_id = str(user["id"])
        role = "primary"

    tokens = await _issue_tokens(pool, user_id, account_id)
    return {
        **tokens,
        "user": {
            "id": user_id,
            "email": body.email,
            "role": role,
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
        """SELECT u.id, u.email, u.role, u.account_id, u.telegram_chat_id, u.created_at,
                  a.site_name, a.energy_site_id
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
        "telegram_chat_id": row["telegram_chat_id"],
        "created_at": row["created_at"].isoformat(),
        "site_name": row["site_name"],
        "energy_site_id": row["energy_site_id"],
        "tesla_connected": tesla_cache is not None,
    }


@router.post("/invite")
async def invite(body: InviteRequest, request: Request, user: dict = Depends(get_current_user)):
    pool = request.app.state.pool

    # Only primary users can invite
    role = await pool.fetchval(
        "SELECT role FROM users WHERE id = $1", UUID(user["user_id"]),
    )
    if role != "primary":
        raise HTTPException(status_code=403, detail="Only the primary user can send invites")

    # Check account doesn't already have 2 users
    user_count = await pool.fetchval(
        "SELECT COUNT(*) FROM users WHERE account_id = $1",
        UUID(user["account_id"]),
    )
    if user_count >= 2:
        raise HTTPException(status_code=409, detail="Account already has 2 users")

    # Check no pending invite for this email
    pending = await pool.fetchval(
        """SELECT id FROM invites
           WHERE account_id = $1 AND email = $2 AND used_at IS NULL AND expires_at > NOW()""",
        UUID(user["account_id"]), body.email,
    )
    if pending:
        raise HTTPException(status_code=409, detail="Active invite already exists for this email")

    invite_row = await pool.fetchrow(
        """INSERT INTO invites (account_id, email, created_by)
           VALUES ($1, $2, $3) RETURNING id""",
        UUID(user["account_id"]), body.email, UUID(user["user_id"]),
    )

    return {"invite_id": str(invite_row["id"])}


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


@router.put("/me/telegram")
async def update_telegram(body: TelegramUpdate, request: Request, user: dict = Depends(get_current_user)):
    pool = request.app.state.pool
    await pool.execute(
        "UPDATE users SET telegram_chat_id = $1 WHERE id = $2",
        body.chat_id, UUID(user["user_id"]),
    )
    return {"status": "ok", "telegram_chat_id": body.chat_id}


@router.post("/me/telegram/link")
async def link_telegram(body: TelegramLinkRequest, request: Request, user: dict = Depends(get_current_user)):
    """Verify a 6-digit code from @watt_wise_bot and link the user's Telegram."""
    pool = request.app.state.pool

    row = await pool.fetchrow(
        """DELETE FROM telegram_link_codes
           WHERE code = $1 AND expires_at > NOW()
           RETURNING chat_id""",
        body.code.strip(),
    )
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    chat_id = row["chat_id"]
    await pool.execute(
        "UPDATE users SET telegram_chat_id = $1 WHERE id = $2",
        chat_id, UUID(user["user_id"]),
    )

    logger.info("Telegram linked: user=%s chat_id=%s", user["user_id"], chat_id)
    return {"status": "ok", "telegram_chat_id": chat_id}


@router.delete("/me/telegram")
async def unlink_telegram(request: Request, user: dict = Depends(get_current_user)):
    """Disconnect Telegram notifications for the current user."""
    pool = request.app.state.pool
    await pool.execute(
        "UPDATE users SET telegram_chat_id = NULL WHERE id = $1",
        UUID(user["user_id"]),
    )
    return {"status": "ok"}


@router.delete("/account/tesla")
async def disconnect_tesla(request: Request, user: dict = Depends(get_current_user)):
    """Disconnect Tesla account — clears cached OAuth tokens so polling stops. Primary only."""
    pool = request.app.state.pool

    role = await pool.fetchval(
        "SELECT role FROM users WHERE id = $1", UUID(user["user_id"]),
    )
    if role != "primary":
        raise HTTPException(status_code=403, detail="Only the primary user can disconnect Tesla")

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
