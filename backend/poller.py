"""
Tesla API poller — fetches energy site live status every 5 minutes
and writes to tesla_intervals. Checks solar surplus alert on each poll.

Multi-tenant: loops over all accounts in the DB, loading per-account
Tesla token caches from kv_store.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
from uuid import UUID

import asyncpg
import teslapy

logger = logging.getLogger(__name__)

# Fallback file cache (used only by --auth CLI)
CACHE_PATH = Path(os.getenv("TESLA_CACHE_PATH", ".tesla_cache.json"))

# DB key prefix for storing Tesla token cache per account
TESLA_CACHE_KEY = "tesla_token_cache"

# Solar surplus alert thresholds
ALERT_EXPORT_W = 3000          # 3kW export
ALERT_SUSTAIN_MINUTES = 15     # sustained for 15 min
ALERT_COOLDOWN_HOURS = 4       # don't re-alert within 4 hours

# In-memory copy of token caches, keyed by account_id string
_token_caches: dict[str, dict] = {}

# Per-account export history for solar surplus alerts
_export_histories: dict[str, list[tuple[datetime, float]]] = {}


async def _load_cache_from_db(pool: asyncpg.Pool, account_id: UUID | None = None) -> dict:
    """Load Tesla token cache from kv_store table.

    If account_id is provided, loads cache for that account.
    If None, loads the legacy global cache (for backward compat during migration).
    """
    global _token_caches

    if account_id:
        row = await pool.fetchval(
            "SELECT value FROM kv_store WHERE key = $1 AND account_id = $2",
            TESLA_CACHE_KEY, account_id,
        )
        cache = _ensure_dict(row)
        _token_caches[str(account_id)] = cache
        return cache
    else:
        # Legacy: load global cache (no account_id)
        row = await pool.fetchval(
            "SELECT value FROM kv_store WHERE key = $1 AND account_id IS NULL",
            TESLA_CACHE_KEY,
        )
        cache = {}
        if row:
            cache = row
            while isinstance(cache, str):
                cache = json.loads(cache)
        elif CACHE_PATH.exists():
            try:
                with open(CACHE_PATH, encoding="utf-8") as f:
                    cache = json.load(f)
                logger.info("Seeded Tesla token cache from file: %s", CACHE_PATH)
            except (IOError, ValueError):
                cache = {}
        _token_caches["__global__"] = cache
        return cache


def _ensure_dict(val) -> dict:
    """Ensure a value is a dict, handling double-encoded JSON strings."""
    if val is None:
        return {}
    while isinstance(val, str):
        val = json.loads(val)
    return val if isinstance(val, dict) else {}


async def _save_cache_to_db(pool: asyncpg.Pool, account_id: UUID | None = None) -> None:
    """Persist Tesla token cache to kv_store table."""
    cache_key = str(account_id) if account_id else "__global__"
    cache = _ensure_dict(_token_caches.get(cache_key, {}))

    # asyncpg needs a JSON string for JSONB columns
    cache_json = json.dumps(cache)

    if account_id:
        await pool.execute(
            """
            INSERT INTO kv_store (key, value, updated_at, account_id)
            VALUES ($1, $2::jsonb, NOW(), $3)
            ON CONFLICT (key, account_id)
            DO UPDATE SET value = $2::jsonb, updated_at = NOW()
            """,
            TESLA_CACHE_KEY, cache_json, account_id,
        )
    else:
        await pool.execute(
            """
            INSERT INTO kv_store (key, value, updated_at)
            VALUES ($1, $2::jsonb, NOW())
            ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()
            """,
            TESLA_CACHE_KEY, cache_json,
        )
    logger.debug("Saved Tesla token cache to DB for %s", cache_key)


def _make_cache_callbacks(account_id: UUID | None = None):
    """Create TeslaPy cache_loader/cache_dumper callbacks for a specific account."""
    cache_key = str(account_id) if account_id else "__global__"

    def loader() -> dict:
        return _token_caches.get(cache_key, {})

    def dumper(cache: dict) -> None:
        _token_caches[cache_key] = cache
        logger.debug("Token cache updated in memory for %s", cache_key)

    return loader, dumper


# Legacy global callbacks (used by _get_tesla_client without account context)
def _cache_loader() -> dict:
    return _token_caches.get("__global__", {})


def _cache_dumper(cache: dict) -> None:
    _token_caches["__global__"] = cache


def _get_tesla_client(email: str | None = None, account_id: UUID | None = None) -> teslapy.Tesla:
    """Create a TeslaPy client with per-account or global cache."""
    if not email:
        email = os.environ["TESLA_EMAIL"]

    if account_id:
        loader, dumper = _make_cache_callbacks(account_id)
        return teslapy.Tesla(email, cache_loader=loader, cache_dumper=dumper)

    return teslapy.Tesla(email, cache_loader=_cache_loader, cache_dumper=_cache_dumper)


def _get_tesla_client_file() -> teslapy.Tesla:
    """Create a TeslaPy client with file-based cache (for CLI --auth only)."""
    email = os.environ["TESLA_EMAIL"]
    return teslapy.Tesla(email, cache_file=str(CACHE_PATH))


def _fetch_live_status(email: str | None = None, account_id: UUID | None = None) -> tuple[dict, dict]:
    """Synchronous Tesla API call — returns (live_status, site_info).

    site_info contains site_name and energy_site_id for account metadata.
    """
    with _get_tesla_client(email, account_id) as tesla:
        if not tesla.authorized:
            raise RuntimeError(
                "Tesla not authorized. Run: python -m backend.poller --auth"
            )

        products = tesla.battery_list() + tesla.solar_list()
        if not products:
            raise RuntimeError("No energy sites found on Tesla account")

        site = products[0]
        site_info = {
            "site_name": site.get("site_name", ""),
            "energy_site_id": str(site.get("energy_site_id", "")),
        }
        data = site.get_site_data()
        return data.get("response", data), site_info


async def poll_once(pool: asyncpg.Pool, account_id: UUID | None = None, tesla_email: str | None = None) -> dict | None:
    """Poll Tesla API once, insert row, persist token cache, return data."""
    status, site_info = _fetch_live_status(tesla_email, account_id)

    # Persist any token refresh that happened during the API call
    await _save_cache_to_db(pool, account_id)

    # Update account with site metadata (if available and account exists)
    if account_id and site_info.get("site_name"):
        await pool.execute(
            """UPDATE accounts SET site_name = $1, energy_site_id = $2
               WHERE id = $3 AND (site_name IS NULL OR site_name != $1)""",
            site_info["site_name"], site_info["energy_site_id"], account_id,
        )

    ts = datetime.now(timezone.utc)
    solar_w = float(status.get("solar_power", 0))
    home_w = float(status.get("load_power", 0))
    grid_w = float(status.get("grid_power", 0))
    battery_w = float(status.get("battery_power", 0))
    battery_pct = float(status.get("percentage_charged", 0))

    # Read EV charging power from Wall Connector hardware (works for non-Tesla EVs)
    wc_list = status.get("wall_connectors", [])
    vehicle_w = sum(float(wc.get("wall_connector_power", 0)) for wc in wc_list)

    await pool.execute(
        """
        INSERT INTO tesla_intervals (ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w, account_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (account_id, ts) DO UPDATE SET
            solar_w = EXCLUDED.solar_w,
            home_w = EXCLUDED.home_w,
            grid_w = EXCLUDED.grid_w,
            battery_w = EXCLUDED.battery_w,
            battery_pct = EXCLUDED.battery_pct,
            vehicle_w = EXCLUDED.vehicle_w
        """,
        ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w, account_id,
    )

    logger.info(
        "Polled %s: solar=%.0fW home=%.0fW grid=%.0fW battery=%.0fW(%.0f%%) ev=%.0fW",
        tesla_email or "default", solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w,
    )

    return {
        "ts": ts,
        "solar_w": solar_w,
        "home_w": home_w,
        "grid_w": grid_w,
        "battery_w": battery_w,
        "battery_pct": battery_pct,
        "vehicle_w": vehicle_w,
    }


# --- Solar surplus alert tracking ---

async def check_solar_surplus_alert(
    pool: asyncpg.Pool, data: dict, account_id: UUID | None = None,
) -> bool:
    """Check if solar surplus alert should fire. Returns True if alert was sent."""
    from backend.notifier import send_alert

    from backend.rates import get_import_rate, get_export_rate

    acct_key = str(account_id) if account_id else "__global__"
    export_history = _export_histories.setdefault(acct_key, [])

    now = data["ts"]
    grid_w = data["grid_w"]

    # grid_w negative = exporting
    if grid_w >= 0:
        export_history.clear()
        return False

    export_w = abs(grid_w)
    export_history.append((now, export_w))

    # Prune readings older than sustain window
    cutoff = now.timestamp() - (ALERT_SUSTAIN_MINUTES * 60)
    export_history[:] = [
        (t, w) for t, w in export_history
        if t.timestamp() >= cutoff
    ]

    if len(export_history) < (ALERT_SUSTAIN_MINUTES // 5):
        return False

    if not all(w >= ALERT_EXPORT_W for _, w in export_history):
        return False

    # Check cooldown — no alert in last N hours
    if account_id:
        last_alert = await pool.fetchval(
            """SELECT fired_at FROM alerts_log
               WHERE account_id = $1 AND alert_type = 'solar_surplus'
               ORDER BY fired_at DESC LIMIT 1""",
            account_id,
        )
    else:
        last_alert = await pool.fetchval(
            """SELECT fired_at FROM alerts_log
               WHERE alert_type = 'solar_surplus'
               ORDER BY fired_at DESC LIMIT 1"""
        )

    if last_alert:
        hours_since = (now - last_alert).total_seconds() / 3600
        if hours_since < ALERT_COOLDOWN_HOURS:
            return False

    # Fire alert
    avg_export_kw = sum(w for _, w in export_history) / len(export_history) / 1000
    battery_pct = data["battery_pct"]
    current_rate = get_import_rate(now.astimezone())
    export_rate = get_export_rate()
    multiplier = current_rate / export_rate

    message = (
        f"You're exporting {avg_export_kw:.1f}kW to the grid right now, "
        f"earning ~${export_rate}/kWh. That same energy used at home is worth "
        f"${current_rate}/kWh — {multiplier:.0f}× more valuable. "
        f"Good time to run appliances or charge your EV."
    )

    await pool.execute(
        """
        INSERT INTO alerts_log (fired_at, alert_type, message, metadata, account_id)
        VALUES ($1, 'solar_surplus', $2, $3, $4)
        """,
        now, message,
        json.dumps({
            "export_kw": round(avg_export_kw, 2),
            "battery_pct": battery_pct,
            "import_rate": current_rate,
        }),
        account_id,
    )

    await send_alert("☀️ Solar Surplus Alert", message, pool=pool, account_id=account_id)
    export_history.clear()
    logger.info("Solar surplus alert fired for %s: %.1fkW export", acct_key, avg_export_kw)
    return True


async def poll_and_check(pool: asyncpg.Pool) -> None:
    """Poll all accounts."""
    # Get all accounts from DB
    accounts = await pool.fetch("SELECT id, tesla_email FROM accounts")

    if not accounts:
        # Fallback: legacy single-tenant mode (no accounts in DB yet)
        try:
            data = await poll_once(pool)
            if data:
                await check_solar_surplus_alert(pool, data)
        except Exception:
            logger.exception("Error during legacy poll cycle")
        return

    for acct in accounts:
        try:
            await _load_cache_from_db(pool, acct["id"])
            data = await poll_once(pool, acct["id"], acct["tesla_email"])
            if data:
                await check_solar_surplus_alert(pool, data, acct["id"])
        except Exception:
            logger.exception("Error polling account %s (%s)", acct["id"], acct["tesla_email"])


# --- CLI for first-time auth ---

if __name__ == "__main__":
    import sys
    if "--auth" in sys.argv:
        print("Starting Tesla OAuth login...")
        with _get_tesla_client_file() as tesla:
            if not tesla.authorized:
                state = tesla.new_state()
                code_verifier = tesla.new_code_verifier()
                url = tesla.authorization_url(state=state, code_verifier=code_verifier)
                print(f"\nOpen this URL in your browser:\n{url}\n")
                print("After login, paste the redirect URL here:")
                redirect_url = input("> ").strip()
                tesla.fetch_token(
                    authorization_response=redirect_url,
                    code_verifier=code_verifier,
                )
            print(f"Authenticated as {os.environ['TESLA_EMAIL']}")
            products = tesla.battery_list() + tesla.solar_list()
            print(f"Found {len(products)} energy site(s)")
            if products:
                site = products[0]
                print(f"Site name: {site.get('site_name', 'N/A')}")
                print(f"Energy site ID: {site.get('energy_site_id', 'N/A')}")
                data = site.get_site_data()
                status = data.get("response", data)
                print(f"Live status: solar={status.get('solar_power', 0)}W "
                      f"grid={status.get('grid_power', 0)}W "
                      f"battery={status.get('percentage_charged', 0)}%")

            if CACHE_PATH.exists():
                print(f"\nToken cached at {CACHE_PATH}")
                print("To seed the DB, run: python -m backend.poller --seed-db")
    elif "--seed-db" in sys.argv:
        import asyncio

        async def seed():
            if not CACHE_PATH.exists():
                print(f"No cache file found at {CACHE_PATH}. Run --auth first.")
                return
            pool = await asyncpg.create_pool(os.environ["DATABASE_URL"])
            await pool.execute("""
                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            """)
            with open(CACHE_PATH, encoding="utf-8") as f:
                cache = json.load(f)
            await pool.execute(
                """
                INSERT INTO kv_store (key, value, updated_at)
                VALUES ($1, $2, NOW())
                ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
                """,
                TESLA_CACHE_KEY,
                json.dumps(cache),
            )
            await pool.close()
            print(f"Tesla token cache seeded to DB from {CACHE_PATH}")

        asyncio.run(seed())
    else:
        print("Usage:")
        print("  python -m backend.poller --auth       # First-time Tesla OAuth login")
        print("  python -m backend.poller --seed-db    # Copy file token cache to DB")
