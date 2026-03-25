from __future__ import annotations

"""
Notification stubs.

Previously sent messages via Telegram. Now just logs the notification
so that daily/weekly report jobs still work without error.
"""

import logging
from uuid import UUID

logger = logging.getLogger(__name__)


# --- Public API (called by aggregator.py and weekly_summary.py) ---


async def send_alert(subject: str, message: str, pool=None, account_id: UUID | None = None) -> None:
    logger.info("Alert (account=%s): %s — %s", account_id, subject, message[:120])


async def send_daily_report(data: dict, pool=None, account_id: UUID | None = None) -> None:
    logger.info(
        "Daily report (account=%s): date=%s cost=$%.2f",
        account_id, data.get("date"), data.get("total_cost", 0),
    )


async def send_weekly_report(data: dict, pool=None, account_id: UUID | None = None) -> None:
    logger.info(
        "Weekly report (account=%s): %s cost=$%.2f",
        account_id, data.get("week_label"), data.get("total_cost", 0),
    )
