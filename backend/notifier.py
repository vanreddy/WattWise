from __future__ import annotations

"""
Telegram notifications via Bot API.

Multi-tenant: sends to all users on an account who have linked their Telegram.
Global bot token (@watt_wise_bot), per-user chat IDs from `users` table.

Three message types:
  - Real-time solar surplus alert
  - Daily report digest
  - Weekly report with Claude AI narrative
"""

import logging
import os
from uuid import UUID

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}/sendMessage"


async def _get_account_chat_ids(pool, account_id: UUID) -> list[str]:
    """Get all Telegram chat IDs for users on this account."""
    rows = await pool.fetch(
        "SELECT telegram_chat_id FROM users WHERE account_id = $1 AND telegram_chat_id IS NOT NULL",
        account_id,
    )
    return [row["telegram_chat_id"] for row in rows]


def _send_to_chat(text: str, chat_id: str) -> None:
    """Send a message to a single Telegram chat ID."""
    token = os.environ["TELEGRAM_BOT_TOKEN"]
    url = TELEGRAM_API.format(token=token)
    resp = httpx.post(
        url,
        json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
        timeout=15,
    )
    if resp.status_code != 200:
        logger.error("Telegram send failed (chat_id=%s): %s %s", chat_id, resp.status_code, resp.text)
    else:
        logger.info("Telegram message sent to %s: %s chars", chat_id, len(text))


async def _send(text: str, pool=None, account_id: UUID | None = None) -> None:
    """Send message to all linked Telegram users for an account."""
    if pool and account_id:
        chat_ids = await _get_account_chat_ids(pool, account_id)
        if not chat_ids:
            logger.warning("No Telegram chat IDs for account %s", account_id)
            return
        for cid in chat_ids:
            _send_to_chat(text, cid)
    else:
        # Legacy fallback: use env var
        chat_id = os.environ.get("TELEGRAM_CHAT_ID")
        if chat_id:
            _send_to_chat(text, chat_id)
        else:
            logger.warning("No TELEGRAM_CHAT_ID configured and no account context")


# --- Formatters ---


def _format_actions(actions: list[str] | None) -> str:
    if not actions:
        return ""
    items = "\n".join(f"  • {a}" for a in actions)
    return f"\n🔴 <b>Actions</b>\n{items}\n"


# --- Public API ---


async def send_alert(subject: str, message: str, pool=None, account_id: UUID | None = None) -> None:
    text = f"⚡ <b>WattWise Alert</b>\n\n{message}"
    await _send(text, pool=pool, account_id=account_id)


async def send_daily_report(data: dict, pool=None, account_id: UUID | None = None) -> None:
    data.setdefault("mtd_vs_prior", "")
    actions = _format_actions(data.get("actions"))

    text = (
        f"📊 <b>Daily Energy Report — {data['date']}</b>\n"
        f"{actions}\n"
        f"<b>Context</b>\n"
        f"{data['context']}\n\n"
        f"<b>Numbers</b>\n"
        f"<pre>"
        f"Grid Import     {data['total_import_kwh']:5.1f} kWh  ${data['total_cost']:.2f}\n"
        f"  Peak          {data['peak_kwh']:5.1f} kWh  ${data['peak_cost']:.2f}\n"
        f"  Part Peak     {data['part_peak_kwh']:5.1f} kWh  ${data['part_peak_cost']:.2f}\n"
        f"  Off Peak      {data['off_peak_kwh']:5.1f} kWh  ${data['off_peak_cost']:.2f}\n"
        f"EV Charging     {data['ev_kwh']:5.1f} kWh  ${data['ev_cost']:.2f}\n"
        f"PW Coverage     {data['battery_coverage']:4.0f}%\n"
        f"Solar Gen       {data['solar_generated_kwh']:5.1f} kWh\n"
        f"Solar Self-Use  {data['solar_self_consumed_kwh']:5.1f} kWh\n"
        f"Solar Export    {data['solar_exported_kwh']:5.1f} kWh  ${data['export_credit']:.2f} cr\n"
        f"Month-to-Date          ${data['mtd_cost']:.2f} {data['mtd_vs_prior']}"
        f"</pre>"
    )
    await _send(text, pool=pool, account_id=account_id)


async def send_weekly_report(data: dict, pool=None, account_id: UUID | None = None) -> None:
    data.setdefault("wow_change", "")
    actions = _format_actions(data.get("actions"))

    text = (
        f"📈 <b>Weekly Energy Report — {data['week_label']}</b>\n"
        f"{actions}\n"
        f"<b>This Week</b>\n"
        f"{data['ai_narrative']}\n\n"
        f"<b>Numbers</b>\n"
        f"<pre>"
        f"Grid Import     {data['total_import_kwh']:5.1f} kWh  ${data['total_cost']:.2f}\n"
        f"  Peak          {data['peak_kwh']:5.1f} kWh  ${data['peak_cost']:.2f}\n"
        f"  Off Peak      {data['off_peak_kwh']:5.1f} kWh  ${data['off_peak_cost']:.2f}\n"
        f"EV Charging     {data['ev_kwh']:5.1f} kWh  ${data['ev_cost']:.2f}\n"
        f"PW Coverage     {data['battery_coverage']:4.0f}%\n"
        f"Solar Gen       {data['solar_generated_kwh']:5.1f} kWh\n"
        f"Solar Self/Exp  {data['solar_self_consumed_kwh']:5.1f} / {data['solar_exported_kwh']:.1f} kWh\n"
        f"Week-over-Week         ${data['total_cost']:.2f} {data['wow_change']}"
        f"</pre>"
    )
    await _send(text, pool=pool, account_id=account_id)
