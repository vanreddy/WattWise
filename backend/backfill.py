"""
Backfill tesla_intervals from Tesla's calendar history API.

Usage (CLI):
    python3 -m backend.backfill --days 7

Usage (API — multi-tenant):
    Called from auth_api.py to backfill 30 days for a new account.

Fetches 'power' (5-min intervals) and 'soe' (battery %) history,
merges them, and inserts into the database.

IMPORTANT: Tesla's calendar history API uses the site's local timezone.
We must request data using Pacific time (America/Los_Angeles) so we get
full 24-hour days aligned to midnight Pacific, not midnight UTC.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
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


def fetch_history(days: int) -> List[Dict]:
    """Fetch power + soe history from Tesla for the last N days."""
    email = os.environ["TESLA_EMAIL"]
    cache = os.getenv("TESLA_CACHE_PATH", ".tesla_cache.json")

    all_intervals = []

    with teslapy.Tesla(email, cache_file=cache) as tesla:
        if not tesla.authorized:
            raise RuntimeError("Tesla not authorized. Run: python -m backend.poller --auth")

        products = tesla.battery_list() + tesla.solar_list()
        if not products:
            raise RuntimeError("No energy sites found")

        site = products[0]

        for day_offset in range(days, 0, -1):
            # Use Pacific time so we get full local-day data (midnight to midnight Pacific)
            target = datetime.now(LOCAL_TZ) - timedelta(days=day_offset)
            # Format end_date with the local timezone offset so Tesla returns the full local day
            end_of_day = target.replace(hour=23, minute=59, second=59)
            end_str = end_of_day.isoformat()
            logger.info("Fetching %s (Pacific) ...", target.strftime("%Y-%m-%d"))

            # Power data (5-min intervals): solar, battery, grid power
            def _parse(raw):
                if isinstance(raw, str):
                    if not raw.strip():
                        return {}
                    try:
                        raw = json.loads(raw)
                    except (json.JSONDecodeError, ValueError):
                        return {}
                return raw if isinstance(raw, dict) else {}

            power_data = _parse(site.get_calendar_history_data(
                kind="power", end_date=end_str
            ))
            power_ts = power_data.get("response", power_data).get("time_series", [])

            # SOE data (battery state of charge, ~15-min intervals)
            soe_data = _parse(site.get_calendar_history_data(
                kind="soe", end_date=end_str
            ))
            soe_ts = soe_data.get("response", soe_data).get("time_series", [])

            # Build SOE lookup by timestamp
            soe_map = {}
            for entry in soe_ts:
                soe_map[entry["timestamp"]] = entry.get("soe", 0)

            # Also build a sorted list for nearest-match lookup
            soe_times = sorted(soe_map.keys())

            def find_nearest_soe(ts_str: str) -> float:
                """Find nearest SOE reading for a given timestamp."""
                if ts_str in soe_map:
                    return soe_map[ts_str]
                # Find nearest by string comparison (ISO format sorts correctly)
                best = 0.0
                for st in soe_times:
                    if st <= ts_str:
                        best = soe_map[st]
                    else:
                        break
                return best

            for entry in power_ts:
                ts_str = entry["timestamp"]
                solar_w = float(entry.get("solar_power", 0))
                battery_w = float(entry.get("battery_power", 0))
                grid_w = float(entry.get("grid_power", 0))
                # Tesla history doesn't report load_power directly in 'power' kind
                # Compute: home = solar + battery + grid (energy balance)
                home_w = solar_w + battery_w + grid_w
                battery_pct = find_nearest_soe(ts_str)

                all_intervals.append({
                    "ts": ts_str,
                    "solar_w": solar_w,
                    "home_w": max(home_w, 0),
                    "grid_w": grid_w,
                    "battery_w": battery_w,
                    "battery_pct": battery_pct,
                    "vehicle_w": 0.0,  # not available in history
                })

            logger.info("  %d intervals, %d soe readings", len(power_ts), len(soe_ts))

    return all_intervals


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
    """Insert intervals for a specific account. Returns count inserted."""
    count = 0
    for iv in intervals:
        ts = datetime.fromisoformat(iv["ts"])
        await pool.execute(
            """INSERT INTO tesla_intervals (ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w, account_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (account_id, ts) DO NOTHING""",
            ts, iv["solar_w"], iv["home_w"], iv["grid_w"],
            iv["battery_w"], iv["battery_pct"], iv["vehicle_w"], account_id,
        )
        count += 1
    return count


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


async def insert_intervals(intervals: List[Dict]):
    """Insert intervals into database, using upsert to handle duplicates."""
    db_url = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(db_url)

    inserted = 0
    updated = 0

    for iv in intervals:
        ts = datetime.fromisoformat(iv["ts"])
        result = await pool.execute(
            """
            INSERT INTO tesla_intervals (ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (ts) DO UPDATE SET
                solar_w = EXCLUDED.solar_w,
                home_w = EXCLUDED.home_w,
                grid_w = EXCLUDED.grid_w,
                battery_w = EXCLUDED.battery_w,
                battery_pct = EXCLUDED.battery_pct,
                vehicle_w = EXCLUDED.vehicle_w
            """,
            ts,
            iv["solar_w"],
            iv["home_w"],
            iv["grid_w"],
            iv["battery_w"],
            iv["battery_pct"],
            iv["vehicle_w"],
        )
        if result == "INSERT 0 1":
            inserted += 1
        else:
            updated += 1

    await pool.close()
    logger.info("Done: %d inserted, %d updated (existing timestamps)", inserted, updated)


async def delete_backfill_data():
    """Delete all existing backfill data (preserves poller data from today)."""
    db_url = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(db_url)
    today_start = datetime.now(LOCAL_TZ).replace(hour=0, minute=0, second=0, microsecond=0)
    result = await pool.execute(
        "DELETE FROM tesla_intervals WHERE ts < $1", today_start
    )
    # Also clear daily_summaries so they get re-aggregated
    await pool.execute("DELETE FROM daily_summaries")
    await pool.close()
    logger.info("Deleted old data: %s", result)


async def reaggregate_daily(days: int):
    """Re-run daily aggregation for all backfilled days."""
    from backend.aggregator import aggregate_day

    db_url = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(db_url)
    today = datetime.now(LOCAL_TZ).date()

    for day_offset in range(days, 0, -1):
        target_day = today - timedelta(days=day_offset)
        try:
            summary = await aggregate_day(pool, target_day)
            if summary:
                # Upsert into daily_summaries
                await pool.execute(
                    """
                    INSERT INTO daily_summaries (
                        day, total_import_kwh, total_export_kwh,
                        solar_generated_kwh, solar_self_consumed_kwh,
                        peak_import_kwh, part_peak_import_kwh, off_peak_import_kwh,
                        peak_cost, part_peak_cost, off_peak_cost, total_cost,
                        export_credit, ev_kwh, ev_peak_kwh, ev_off_peak_kwh, ev_cost,
                        battery_peak_coverage_pct, battery_depletion_hour
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                        $11, $12, $13, $14, $15, $16, $17, $18, $19
                    )
                    ON CONFLICT (day) DO UPDATE SET
                        total_import_kwh = EXCLUDED.total_import_kwh,
                        total_export_kwh = EXCLUDED.total_export_kwh,
                        solar_generated_kwh = EXCLUDED.solar_generated_kwh,
                        solar_self_consumed_kwh = EXCLUDED.solar_self_consumed_kwh,
                        peak_import_kwh = EXCLUDED.peak_import_kwh,
                        part_peak_import_kwh = EXCLUDED.part_peak_import_kwh,
                        off_peak_import_kwh = EXCLUDED.off_peak_import_kwh,
                        peak_cost = EXCLUDED.peak_cost,
                        part_peak_cost = EXCLUDED.part_peak_cost,
                        off_peak_cost = EXCLUDED.off_peak_cost,
                        total_cost = EXCLUDED.total_cost,
                        export_credit = EXCLUDED.export_credit,
                        ev_kwh = EXCLUDED.ev_kwh,
                        ev_peak_kwh = EXCLUDED.ev_peak_kwh,
                        ev_off_peak_kwh = EXCLUDED.ev_off_peak_kwh,
                        ev_cost = EXCLUDED.ev_cost,
                        battery_peak_coverage_pct = EXCLUDED.battery_peak_coverage_pct,
                        battery_depletion_hour = EXCLUDED.battery_depletion_hour
                    """,
                    target_day,
                    summary.get("total_import_kwh", 0),
                    summary.get("total_export_kwh", 0),
                    summary.get("solar_generated_kwh", 0),
                    summary.get("solar_self_consumed_kwh", 0),
                    summary.get("peak_import_kwh", 0),
                    summary.get("part_peak_import_kwh", 0),
                    summary.get("off_peak_import_kwh", 0),
                    summary.get("peak_cost", 0),
                    summary.get("part_peak_cost", 0),
                    summary.get("off_peak_cost", 0),
                    summary.get("total_cost", 0),
                    summary.get("export_credit", 0),
                    summary.get("ev_kwh", 0),
                    summary.get("ev_peak_kwh", 0),
                    summary.get("ev_off_peak_kwh", 0),
                    summary.get("ev_cost", 0),
                    summary.get("battery_peak_coverage_pct", 0),
                    summary.get("battery_depletion_hour"),
                )
                logger.info("Aggregated daily summary for %s", target_day)
            else:
                logger.warning("No data to aggregate for %s", target_day)
        except Exception:
            logger.exception("Failed to aggregate %s", target_day)

    await pool.close()
    logger.info("Daily aggregation complete for %d days", days)


if __name__ == "__main__":
    days = 30
    clean = False
    reaggregate = False

    for i, arg in enumerate(sys.argv):
        if arg == "--days" and i + 1 < len(sys.argv):
            days = int(sys.argv[i + 1])
        elif arg == "--clean":
            clean = True
        elif arg == "--reaggregate":
            reaggregate = True

    if clean:
        logger.info("Cleaning old backfill data...")
        asyncio.run(delete_backfill_data())

    logger.info("Backfilling %d days of Tesla history...", days)
    intervals = fetch_history(days)
    logger.info("Fetched %d total intervals", len(intervals))
    asyncio.run(insert_intervals(intervals))

    if reaggregate:
        logger.info("Re-aggregating daily summaries...")
        asyncio.run(reaggregate_daily(days))
