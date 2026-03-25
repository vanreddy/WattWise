"""
Backfill tesla_intervals from Tesla's calendar history API.

Multi-tenant: called from auth_api.py to backfill 30 days for a new account.

Fetches 'power' (5-min intervals) and 'soe' (battery %) history,
merges them, and inserts into the database.

IMPORTANT: Tesla's calendar history API uses the site's local timezone.
We must request data using Pacific time (America/Los_Angeles) so we get
full 24-hour days aligned to midnight Pacific, not midnight UTC.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timedelta
from typing import Dict, List
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg
import teslapy

from backend.poller import _make_cache_callbacks, _load_cache_from_db, _save_cache_to_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

LOCAL_TZ = ZoneInfo("America/Los_Angeles")

# In-memory backfill progress: account_id_str -> {days_fetched, days_total, status, error}
_backfill_progress: dict[str, dict] = {}


def _fetch_one_day(site, day_offset: int) -> List[Dict]:
    """Fetch one day of power + soe data from Tesla for a site."""
    target = datetime.now(LOCAL_TZ) - timedelta(days=day_offset)
    end_of_day = target.replace(hour=23, minute=59, second=59)
    end_str = end_of_day.isoformat()

    def _parse_response(raw):
        if isinstance(raw, str):
            if not raw.strip():
                return {}
            try:
                raw = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                return {}
        return raw if isinstance(raw, dict) else {}

    power_data = _parse_response(site.get_calendar_history_data(kind="power", end_date=end_str))
    power_ts = power_data.get("response", power_data).get("time_series", [])

    soe_data = _parse_response(site.get_calendar_history_data(kind="soe", end_date=end_str))
    soe_ts = soe_data.get("response", soe_data).get("time_series", [])

    soe_map = {e["timestamp"]: e.get("soe", 0) for e in soe_ts}
    soe_times = sorted(soe_map.keys())

    def find_nearest_soe(ts_str: str) -> float:
        if ts_str in soe_map:
            return soe_map[ts_str]
        best = 0.0
        for st in soe_times:
            if st <= ts_str:
                best = soe_map[st]
            else:
                break
        return best

    intervals = []
    for entry in power_ts:
        ts_str = entry["timestamp"]
        solar_w = float(entry.get("solar_power", 0))
        battery_w = float(entry.get("battery_power", 0))
        grid_w = float(entry.get("grid_power", 0))
        home_w = solar_w + battery_w + grid_w

        intervals.append({
            "ts": ts_str,
            "solar_w": solar_w,
            "home_w": max(home_w, 0),
            "grid_w": grid_w,
            "battery_w": battery_w,
            "battery_pct": find_nearest_soe(ts_str),
            "vehicle_w": 0.0,
        })

    return intervals


async def _insert_intervals_for_account(
    pool: asyncpg.Pool, intervals: List[Dict], account_id: UUID,
) -> int:
    """Batch insert intervals for a specific account. Returns count inserted."""
    if not intervals:
        return 0

    # Build rows for batch insert
    rows = []
    for iv in intervals:
        rows.append((
            datetime.fromisoformat(iv["ts"]),
            iv["solar_w"], iv["home_w"], iv["grid_w"],
            iv["battery_w"], iv["battery_pct"], iv["vehicle_w"],
            account_id,
        ))

    # Use a single connection for the batch to avoid pool contention
    async with pool.acquire() as conn:
        # Batch insert using executemany — much faster than individual executes
        await conn.executemany(
            """INSERT INTO tesla_intervals (ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w, account_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (account_id, ts) DO NOTHING""",
            rows,
        )

    return len(rows)


async def _aggregate_day_for_account(
    pool: asyncpg.Pool, day_offset: int, account_id: UUID,
) -> None:
    """Aggregate one day's intervals into daily_summaries for an account."""
    from backend.aggregator import aggregate_day, save_summary

    target_day = (datetime.now(LOCAL_TZ) - timedelta(days=day_offset)).date()
    try:
        summary = await aggregate_day(pool, target_day, account_id=account_id)
        if summary:
            await save_summary(pool, summary, account_id=account_id)
            logger.info("Aggregated day %s for account %s", target_day, account_id)
    except Exception:
        logger.exception("Failed to aggregate %s for account %s", target_day, account_id)


async def backfill_account(pool: asyncpg.Pool, account_id: UUID, days: int = 30, include_today: bool = False) -> None:
    """Backfill N days of Tesla history for a specific account.

    Updates _backfill_progress in-memory so the frontend can poll status.
    If include_today=True, also fetches today's partial data (offset 0).
    """
    acct_key = str(account_id)
    _backfill_progress[acct_key] = {
        "days_fetched": 0,
        "days_total": days,
        "status": "fetching",
        "error": None,
    }

    try:
        # Load Tesla token cache for this account
        await _load_cache_from_db(pool, account_id)

        tesla_email = await pool.fetchval(
            "SELECT tesla_email FROM accounts WHERE id = $1", account_id,
        )
        if not tesla_email:
            raise RuntimeError("No Tesla email on account")

        loader, dumper = _make_cache_callbacks(account_id)

        with teslapy.Tesla(tesla_email, cache_loader=loader, cache_dumper=dumper) as tesla:
            logger.info("Backfill %s: authorized=%s, cache keys=%s", acct_key, tesla.authorized, list(loader().keys())[:5])
            if not tesla.authorized:
                raise RuntimeError("Tesla not authorized — re-authenticate via Settings page")

            # Try an API call — if the token is expired, this will attempt auto-refresh
            try:
                products = tesla.battery_list() + tesla.solar_list()
            except Exception as api_err:
                logger.error("Backfill %s: Tesla API call failed (token likely expired): %s", acct_key, api_err)
                raise RuntimeError(f"Tesla token expired — re-authenticate via Settings: {api_err}")
            if not products:
                raise RuntimeError("No energy sites found")

            site = products[0]

            start_offset = 0 if include_today else 1
            for day_offset in range(start_offset, days + 1):
                target = datetime.now(LOCAL_TZ) - timedelta(days=day_offset)
                logger.info("Backfill account %s: fetching %s ...", acct_key, target.strftime("%Y-%m-%d"))

                try:
                    intervals = _fetch_one_day(site, day_offset)
                except Exception as day_err:
                    logger.warning("Backfill %s: skipping %s — %s", acct_key, target.strftime("%Y-%m-%d"), day_err)
                    _backfill_progress[acct_key]["days_fetched"] = day_offset
                    continue

                if intervals:
                    await _insert_intervals_for_account(pool, intervals, account_id)
                    await _aggregate_day_for_account(pool, day_offset, account_id)

                fetched = day_offset
                _backfill_progress[acct_key]["days_fetched"] = fetched
                logger.info("Backfill account %s: %d/%d days done", acct_key, fetched, days)

        # Save updated token cache
        await _save_cache_to_db(pool, account_id)

        _backfill_progress[acct_key]["status"] = "done"
        logger.info("Backfill complete for account %s: %d days", acct_key, days)

    except Exception as exc:
        logger.exception("Backfill failed for account %s", acct_key)
        _backfill_progress[acct_key]["status"] = "error"
        _backfill_progress[acct_key]["error"] = str(exc)


def get_backfill_status(account_id: UUID) -> dict:
    """Get backfill progress for an account."""
    acct_key = str(account_id)
    return _backfill_progress.get(acct_key, {
        "days_fetched": 0,
        "days_total": 0,
        "status": "not_started",
        "error": None,
    })


if __name__ == "__main__":
    print("Legacy single-tenant CLI has been removed.")
    print("Backfill is now triggered per-account via the auth API.")
    print("See: POST /auth/backfill/{account_id}")
    sys.exit(1)
