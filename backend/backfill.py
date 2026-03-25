"""
Backfill tesla_intervals from Tesla's calendar history API.

Multi-tenant: called from auth_api.py to backfill history for a new account.

Fetches 'power' (5-min intervals) and 'soe' (battery %) history,
merges them, and inserts into the database.

Key design decisions:
  - Fetches newest days first so the dashboard is useful immediately
  - Resumable: skips days that already have sufficient data in the DB
  - Wraps synchronous Tesla API calls in asyncio.to_thread to avoid blocking
  - Saves token cache after every successful day (not just at the end)
  - Persists progress to DB so it survives restarts
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
from datetime import datetime, date, timedelta
from typing import Dict, List
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg
import teslapy

from backend.poller import _make_cache_callbacks, _load_cache_from_db, _save_cache_to_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

LOCAL_TZ = ZoneInfo("America/Los_Angeles")

# Minimum interval count to consider a day "complete" (288 = full day of 5-min intervals)
MIN_INTERVALS_COMPLETE = 250

# In-memory backfill progress (supplemented by DB persistence)
_backfill_progress: dict[str, dict] = {}


def _fetch_one_day(site, target_date: date) -> List[Dict]:
    """Fetch one day of power + soe data from Tesla for a site.

    Synchronous — must be called via asyncio.to_thread().
    """
    end_of_day = datetime.combine(target_date, datetime.max.time().replace(microsecond=0), tzinfo=LOCAL_TZ)
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

    rows = []
    for iv in intervals:
        rows.append((
            datetime.fromisoformat(iv["ts"]),
            iv["solar_w"], iv["home_w"], iv["grid_w"],
            iv["battery_w"], iv["battery_pct"], iv["vehicle_w"],
            account_id,
        ))

    async with pool.acquire() as conn:
        await conn.executemany(
            """INSERT INTO tesla_intervals (ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w, account_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (account_id, ts) DO NOTHING""",
            rows,
        )

    return len(rows)


async def _aggregate_day_for_account(
    pool: asyncpg.Pool, target_date: date, account_id: UUID,
) -> None:
    """Aggregate one day's intervals into daily_summaries for an account."""
    from backend.aggregator import aggregate_day, save_summary

    try:
        summary = await aggregate_day(pool, target_date, account_id=account_id)
        if summary:
            await save_summary(pool, summary, account_id=account_id)
    except Exception:
        logger.exception("Failed to aggregate %s for account %s", target_date, account_id)


async def _count_intervals_for_day(pool: asyncpg.Pool, account_id: UUID, target_date: date) -> int:
    """Count how many intervals exist for a given day."""
    start = datetime.combine(target_date, datetime.min.time(), tzinfo=LOCAL_TZ)
    end = datetime.combine(target_date + timedelta(days=1), datetime.min.time(), tzinfo=LOCAL_TZ)
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM tesla_intervals WHERE account_id = $1 AND ts >= $2 AND ts < $3",
        account_id, start, end,
    )
    return count or 0


async def _save_progress_to_db(pool: asyncpg.Pool, account_id: UUID, progress: dict) -> None:
    """Persist backfill progress to kv_store so it survives restarts."""
    await pool.execute(
        """INSERT INTO kv_store (key, value, updated_at, account_id)
           VALUES ('backfill_progress', $1::jsonb, NOW(), $2)
           ON CONFLICT (key, account_id)
           DO UPDATE SET value = $1::jsonb, updated_at = NOW()""",
        json.dumps(progress), account_id,
    )


async def backfill_account(
    pool: asyncpg.Pool,
    account_id: UUID,
    days: int = 30,
    include_today: bool = False,
) -> None:
    """Backfill N days of Tesla history for a specific account.

    - Fetches newest days first for immediate dashboard usability
    - Skips days that already have sufficient data (resumable)
    - Wraps blocking Tesla API calls in asyncio.to_thread
    - Saves token cache after each successful day
    - Persists progress to DB
    """
    acct_key = str(account_id)
    progress = {
        "days_fetched": 0,
        "days_total": days,
        "status": "fetching",
        "error": None,
    }
    _backfill_progress[acct_key] = progress

    try:
        await _load_cache_from_db(pool, account_id)

        tesla_email = await pool.fetchval(
            "SELECT tesla_email FROM accounts WHERE id = $1", account_id,
        )
        if not tesla_email:
            raise RuntimeError("No Tesla email on account")

        loader, dumper = _make_cache_callbacks(account_id)

        with teslapy.Tesla(tesla_email, cache_loader=loader, cache_dumper=dumper) as tesla:
            logger.info("Backfill %s: authorized=%s", acct_key, tesla.authorized)
            if not tesla.authorized:
                raise RuntimeError("Tesla not authorized — re-authenticate via Settings page")

            # Verify API access with a test call (non-blocking)
            try:
                products = await asyncio.to_thread(lambda: tesla.battery_list() + tesla.solar_list())
            except Exception as api_err:
                logger.error("Backfill %s: Tesla API failed: %s", acct_key, api_err)
                raise RuntimeError(f"Tesla token expired — re-authenticate: {api_err}")

            if not products:
                raise RuntimeError("No energy sites found")
            site = products[0]

            # Fetch newest first, stop when Tesla returns no data (end of history)
            today = datetime.now(LOCAL_TZ).date()
            start_offset = 0 if include_today else 1
            consecutive_empty = 0
            max_consecutive_empty = 5  # stop after 5 days with no data = end of history

            fetched_count = 0
            skipped_count = 0
            day_offset = start_offset

            while day_offset <= days:
                target_date = today - timedelta(days=day_offset)

                # Check if day already has sufficient data (resumable)
                existing = await _count_intervals_for_day(pool, account_id, target_date)
                if existing >= MIN_INTERVALS_COMPLETE:
                    skipped_count += 1
                    fetched_count += 1
                    day_offset += 1
                    progress["days_fetched"] = fetched_count
                    consecutive_empty = 0
                    continue

                logger.info("Backfill %s: fetching %s (existing: %d intervals)...",
                            acct_key, target_date, existing)

                try:
                    intervals = await asyncio.to_thread(_fetch_one_day, site, target_date)
                except Exception as day_err:
                    logger.warning("Backfill %s: skipping %s — %s", acct_key, target_date, day_err)
                    fetched_count += 1
                    day_offset += 1
                    progress["days_fetched"] = fetched_count
                    consecutive_empty += 1
                    if consecutive_empty >= max_consecutive_empty:
                        logger.info("Backfill %s: %d consecutive empty days — reached end of Tesla history", acct_key, consecutive_empty)
                        break
                    continue

                if intervals:
                    await _insert_intervals_for_account(pool, intervals, account_id)
                    await _aggregate_day_for_account(pool, target_date, account_id)
                    consecutive_empty = 0
                else:
                    consecutive_empty += 1
                    if consecutive_empty >= max_consecutive_empty:
                        logger.info("Backfill %s: %d consecutive empty days — reached end of Tesla history", acct_key, consecutive_empty)
                        break

                fetched_count += 1
                day_offset += 1
                progress["days_fetched"] = fetched_count

                # Save token cache periodically
                if fetched_count % 10 == 0:
                    await _save_cache_to_db(pool, account_id)
                    await _save_progress_to_db(pool, account_id, progress)

                if fetched_count % 25 == 0:
                    logger.info("Backfill %s: %d days processed (%d skipped)",
                                acct_key, fetched_count, skipped_count)

        # Final save
        await _save_cache_to_db(pool, account_id)
        progress["status"] = "done"
        await _save_progress_to_db(pool, account_id, progress)
        logger.info("Backfill complete for %s: %d days (%d skipped, %d fetched)",
                     acct_key, len(days_to_fetch), skipped_count, len(days_to_fetch) - skipped_count)

    except Exception as exc:
        logger.exception("Backfill failed for account %s", acct_key)
        progress["status"] = "error"
        progress["error"] = str(exc)
        try:
            await _save_progress_to_db(pool, account_id, progress)
        except Exception:
            pass


def get_backfill_status(account_id: UUID) -> dict:
    """Get backfill progress for an account (in-memory, fast)."""
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
