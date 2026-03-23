"""
Telegram bot listener for /start command — linking flow.

Uses long-polling (getUpdates) to listen for incoming messages.
When a user sends /start, generates a 6-digit code, stores it in
telegram_link_codes with their chat_id, and replies with instructions.

Runs as a background asyncio task alongside the FastAPI server.
"""

from __future__ import annotations

import asyncio
import logging
import os
import random

import httpx

logger = logging.getLogger(__name__)

TELEGRAM_API = "https://api.telegram.org/bot{token}"


async def _get_updates(token: str, offset: int, timeout: int = 30) -> dict:
    """Long-poll Telegram for new updates."""
    url = f"{TELEGRAM_API.format(token=token)}/getUpdates"
    async with httpx.AsyncClient(timeout=timeout + 5) as client:
        resp = await client.get(url, params={"offset": offset, "timeout": timeout})
        return resp.json()


async def _send_message(token: str, chat_id: str, text: str) -> None:
    url = f"{TELEGRAM_API.format(token=token)}/sendMessage"
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(url, json={
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
        })


def _generate_code() -> str:
    """Generate a 6-digit numeric linking code."""
    return f"{random.randint(100000, 999999)}"


async def handle_start(pool, token: str, chat_id: str, username: str | None) -> None:
    """Handle /start command: generate code, store in DB, reply."""
    code = _generate_code()

    # Upsert: one active code per chat_id at a time
    await pool.execute(
        """INSERT INTO telegram_link_codes (chat_id, code, expires_at)
           VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
           ON CONFLICT (chat_id) DO UPDATE
           SET code = $2, expires_at = NOW() + INTERVAL '10 minutes', created_at = NOW()""",
        str(chat_id), code,
    )

    display = f" @{username}" if username else ""
    await _send_message(token, chat_id, (
        f"Hi{display}! Your WattWise linking code is:\n\n"
        f"<b>{code}</b>\n\n"
        f"Enter this code in WattWise Settings to connect your Telegram.\n"
        f"This code expires in 10 minutes."
    ))
    logger.info("Telegram link code issued for chat_id=%s", chat_id)


async def run_bot_polling(pool) -> None:
    """Main loop: long-poll Telegram for /start commands."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        logger.warning("TELEGRAM_BOT_TOKEN not set — bot listener disabled")
        return

    # Ensure link codes table exists
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS telegram_link_codes (
            chat_id  TEXT PRIMARY KEY,
            code     TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL
        )
    """)

    logger.info("Telegram bot listener started")
    offset = 0

    while True:
        try:
            data = await _get_updates(token, offset)
            if not data.get("ok"):
                logger.error("Telegram getUpdates error: %s", data)
                await asyncio.sleep(5)
                continue

            for update in data.get("result", []):
                offset = update["update_id"] + 1
                msg = update.get("message", {})
                text = msg.get("text", "")
                chat_id = msg.get("chat", {}).get("id")

                if not chat_id:
                    continue

                if text.strip().startswith("/start"):
                    username = msg.get("from", {}).get("username")
                    await handle_start(pool, token, str(chat_id), username)

        except asyncio.CancelledError:
            logger.info("Telegram bot listener shutting down")
            return
        except Exception:
            logger.exception("Telegram bot polling error")
            await asyncio.sleep(5)
