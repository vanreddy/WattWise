"""
Optimizer API endpoints:
  GET  /optimizer/plan       — current day plan + timeline
  GET  /optimizer/log        — recent activity log entries
  GET  /optimizer/state      — auto mode, controls, device state
  POST /optimizer/state      — update controls (auto_mode, reserve, comfort, etc.)
  POST /optimizer/run        — manually trigger optimization cycle
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from backend.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/optimizer", tags=["optimizer"])


@router.get("/plan")
async def get_plan(request: Request, user: dict = Depends(get_current_user)):
    """Get current optimization plan and timeline."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    row = await pool.fetchrow(
        "SELECT current_plan FROM optimizer_state WHERE account_id = $1",
        account_id,
    )

    if not row or not row["current_plan"]:
        return {"plan": None, "message": "No plan generated yet. Auto mode will generate one shortly."}

    plan = row["current_plan"]
    if isinstance(plan, str):
        plan = json.loads(plan)

    return {"plan": plan}


@router.get("/log")
async def get_log(
    request: Request,
    user: dict = Depends(get_current_user),
    hours: int = 24,
    limit: int = 50,
):
    """Get recent optimizer activity log."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = await pool.fetch("""
        SELECT ts, action, device, reason, details
        FROM optimizer_log
        WHERE account_id = $1 AND ts >= $2
        ORDER BY ts DESC
        LIMIT $3
    """, account_id, since, limit)

    return {
        "entries": [
            {
                "ts": row["ts"].isoformat(),
                "action": row["action"],
                "device": row["device"],
                "reason": row["reason"],
                "details": row["details"],
            }
            for row in rows
        ]
    }


@router.get("/state")
async def get_state(request: Request, user: dict = Depends(get_current_user)):
    """Get optimizer state: auto mode, controls, overrides."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    row = await pool.fetchrow(
        "SELECT * FROM optimizer_state WHERE account_id = $1", account_id
    )

    if not row:
        # Return defaults
        return {
            "auto_mode": True,
            "disabled_until": None,
            "pw_reserve_pct": 20,
            "comfort_min_f": 68,
            "comfort_max_f": 78,
            "ev_min_pct": 60,
            "ev_max_pct": 90,
            "device_overrides": {},
        }

    return {
        "auto_mode": row["auto_mode"],
        "disabled_until": row["disabled_until"].isoformat() if row["disabled_until"] else None,
        "pw_reserve_pct": row["pw_reserve_pct"],
        "comfort_min_f": row["comfort_min_f"],
        "comfort_max_f": row["comfort_max_f"],
        "ev_min_pct": row["ev_min_pct"],
        "ev_max_pct": row["ev_max_pct"],
        "device_overrides": row["device_overrides"] or {},
    }


@router.post("/state")
async def update_state(request: Request, user: dict = Depends(get_current_user)):
    """Update optimizer controls.

    Body can include any subset of:
    {
      "auto_mode": bool,
      "disabled_until": "ISO datetime" | null,
      "pw_reserve_pct": int,
      "comfort_min_f": int,
      "comfort_max_f": int,
      "ev_min_pct": int,
      "ev_max_pct": int,
    }
    """
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    body = await request.json()

    # Ensure row exists
    await pool.execute("""
        INSERT INTO optimizer_state (account_id) VALUES ($1)
        ON CONFLICT (account_id) DO NOTHING
    """, account_id)

    # Build dynamic update
    allowed_fields = {
        "auto_mode", "disabled_until", "pw_reserve_pct",
        "comfort_min_f", "comfort_max_f", "ev_min_pct", "ev_max_pct",
    }

    updates = []
    values = [account_id]
    idx = 2

    for field in allowed_fields:
        if field in body:
            val = body[field]
            # Parse disabled_until from ISO string
            if field == "disabled_until" and val and isinstance(val, str):
                val = datetime.fromisoformat(val)
            updates.append(f"{field} = ${idx}")
            values.append(val)
            idx += 1

    if not updates:
        return {"status": "no changes"}

    updates.append("updated_at = NOW()")
    sql = f"UPDATE optimizer_state SET {', '.join(updates)} WHERE account_id = $1"
    await pool.execute(sql, *values)

    logger.info("Optimizer state updated for %s: %s", account_id,
                {k: body[k] for k in body if k in allowed_fields})

    return {"status": "ok"}


@router.post("/run")
async def trigger_run(request: Request, user: dict = Depends(get_current_user)):
    """Manually trigger an optimization cycle."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    from backend.optimizer.engine import run_optimization
    result = await run_optimization(pool, account_id)

    return result
