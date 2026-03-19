"""
Backfill tesla_intervals from Tesla's calendar history API.

Usage:
    python3 -m backend.backfill --days 7

Fetches 'power' (5-min intervals) and 'soe' (battery %) history,
merges them, and inserts into the database.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import asyncpg
import teslapy

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)


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
            target = datetime.now(timezone.utc) - timedelta(days=day_offset)
            end_str = target.strftime("%Y-%m-%dT23:59:59Z")
            logger.info("Fetching %s ...", target.strftime("%Y-%m-%d"))

            # Power data (5-min intervals): solar, battery, grid power
            power_data = site.get_calendar_history_data(
                kind="power", end_date=end_str
            )
            power_ts = power_data.get("response", power_data).get("time_series", [])

            # SOE data (battery state of charge, ~15-min intervals)
            soe_data = site.get_calendar_history_data(
                kind="soe", end_date=end_str
            )
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


async def insert_intervals(intervals: List[Dict]):
    """Insert intervals into database, skipping duplicates."""
    db_url = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(db_url)

    inserted = 0
    skipped = 0

    for iv in intervals:
        ts = datetime.fromisoformat(iv["ts"])
        # Check if already exists
        existing = await pool.fetchval(
            "SELECT COUNT(*) FROM tesla_intervals WHERE ts = $1", ts
        )
        if existing > 0:
            skipped += 1
            continue

        await pool.execute(
            """
            INSERT INTO tesla_intervals (ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            ts,
            iv["solar_w"],
            iv["home_w"],
            iv["grid_w"],
            iv["battery_w"],
            iv["battery_pct"],
            iv["vehicle_w"],
        )
        inserted += 1

    await pool.close()
    logger.info("Done: %d inserted, %d skipped (duplicates)", inserted, skipped)


if __name__ == "__main__":
    days = 7
    for i, arg in enumerate(sys.argv):
        if arg == "--days" and i + 1 < len(sys.argv):
            days = int(sys.argv[i + 1])

    logger.info("Backfilling %d days of Tesla history...", days)
    intervals = fetch_history(days)
    logger.info("Fetched %d total intervals", len(intervals))
    asyncio.run(insert_intervals(intervals))
