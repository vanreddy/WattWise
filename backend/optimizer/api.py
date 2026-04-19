"""
Optimizer API endpoints:
  GET  /optimizer/plan — current day forecast + recommendations
"""

import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Request

from backend.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/optimizer", tags=["optimizer"])


@router.get("/plan")
async def get_plan(request: Request, user: dict = Depends(get_current_user)):
    """Get current forecast plan and timeline."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    row = await pool.fetchrow(
        "SELECT current_plan FROM optimizer_state WHERE account_id = $1",
        account_id,
    )

    if not row or not row["current_plan"]:
        return {"plan": None, "message": "No forecast generated yet."}

    plan = row["current_plan"]
    if isinstance(plan, str):
        plan = json.loads(plan)

    return {"plan": plan}
