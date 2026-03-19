"""
Tesla API poller — fetches energy site live status every 5 minutes
and writes to tesla_intervals. Checks solar surplus alert on each poll.

Uses TeslaPy (pip install teslapy) which supports Tesla's current
OAuth2 SSO authentication flow.
"""

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import asyncpg
import teslapy

logger = logging.getLogger(__name__)

CACHE_PATH = Path(os.getenv("TESLA_CACHE_PATH", ".tesla_cache.json"))

# Solar surplus alert thresholds
ALERT_EXPORT_W = 3000          # 3kW export
ALERT_BATTERY_MIN_PCT = 95     # battery > 95%
ALERT_SUSTAIN_MINUTES = 30     # sustained for 30 min
ALERT_COOLDOWN_HOURS = 4       # don't re-alert within 4 hours
ALERT_WINDOW_START = 9         # 9am
ALERT_WINDOW_END = 15          # 3pm


def _get_tesla_client() -> teslapy.Tesla:
    """
    Create a TeslaPy client.

    First run requires browser-based OAuth login. After that, tokens
    are cached in CACHE_PATH and refreshed automatically.
    """
    email = os.environ["TESLA_EMAIL"]
    return teslapy.Tesla(email, cache_file=str(CACHE_PATH))


def _fetch_live_status() -> dict:
    """Synchronous Tesla API call — returns live energy site status."""
    with _get_tesla_client() as tesla:
        if not tesla.authorized:
            # First-time setup: user must complete OAuth in browser.
            # In production, run `python -m backend.poller --auth` once.
            raise RuntimeError(
                "Tesla not authorized. Run: python -m backend.poller --auth"
            )

        products = tesla.battery_list() + tesla.solar_list()
        if not products:
            raise RuntimeError("No energy sites found on Tesla account")

        site = products[0]
        return site.get_site_live_status()


async def poll_once(pool: asyncpg.Pool) -> dict | None:
    """Poll Tesla API once, insert row, return the data dict."""
    status = _fetch_live_status()

    ts = datetime.now(timezone.utc)
    solar_w = float(status.get("solar_power", 0))
    home_w = float(status.get("load_power", 0))
    grid_w = float(status.get("grid_power", 0))
    battery_w = float(status.get("battery_power", 0))
    battery_pct = float(status.get("percentage_charged", 0))

    # Tesla may report vehicle charging separately — default to 0
    vehicle_w = float(status.get("vehicle_power", 0))

    await pool.execute(
        """
        INSERT INTO tesla_intervals (ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        """,
        ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w,
    )

    logger.info(
        "Polled: solar=%.0fW home=%.0fW grid=%.0fW battery=%.0fW(%.0f%%) ev=%.0fW",
        solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w,
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

# In-memory buffer of recent export readings for sustained check
_export_history: list[tuple[datetime, float, float]] = []  # (ts, grid_w, battery_pct)


async def check_solar_surplus_alert(
    pool: asyncpg.Pool, data: dict
) -> bool:
    """
    Check if solar surplus alert should fire.
    Returns True if alert was sent.
    """
    from backend.notifier import send_alert
    from backend.rates import get_import_rate, get_export_rate

    now = data["ts"]
    local_hour = now.astimezone().hour

    # Only alert between 9am and 3pm local
    if not (ALERT_WINDOW_START <= local_hour < ALERT_WINDOW_END):
        _export_history.clear()
        return False

    grid_w = data["grid_w"]
    battery_pct = data["battery_pct"]

    # grid_w negative = exporting
    if grid_w >= 0:
        # Not exporting — reset history
        _export_history.clear()
        return False

    export_w = abs(grid_w)
    _export_history.append((now, export_w, battery_pct))

    # Prune readings older than sustain window
    cutoff = now.timestamp() - (ALERT_SUSTAIN_MINUTES * 60)
    _export_history[:] = [
        (t, w, pct) for t, w, pct in _export_history
        if t.timestamp() >= cutoff
    ]

    # Need sustained readings over the window
    if len(_export_history) < (ALERT_SUSTAIN_MINUTES // 5):
        return False

    # Check all readings meet thresholds
    if not all(w >= ALERT_EXPORT_W and pct >= ALERT_BATTERY_MIN_PCT
               for _, w, pct in _export_history):
        return False

    # Check cooldown — no alert in last N hours
    last_alert = await pool.fetchval(
        """
        SELECT fired_at FROM alerts_log
        WHERE alert_type = 'solar_surplus'
        ORDER BY fired_at DESC LIMIT 1
        """
    )
    if last_alert:
        hours_since = (now - last_alert).total_seconds() / 3600
        if hours_since < ALERT_COOLDOWN_HOURS:
            return False

    # Fire alert
    avg_export_kw = sum(w for _, w, _ in _export_history) / len(_export_history) / 1000
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
        INSERT INTO alerts_log (fired_at, alert_type, message, metadata)
        VALUES ($1, 'solar_surplus', $2, $3)
        """,
        now,
        message,
        json.dumps({
            "export_kw": round(avg_export_kw, 2),
            "battery_pct": battery_pct,
            "import_rate": current_rate,
        }),
    )

    await send_alert("☀️ Solar Surplus Alert", message)
    _export_history.clear()
    logger.info("Solar surplus alert fired: %.1fkW export", avg_export_kw)
    return True


async def poll_and_check(pool: asyncpg.Pool) -> None:
    """Single poll cycle: fetch data, insert, check alert."""
    try:
        data = await poll_once(pool)
        if data:
            await check_solar_surplus_alert(pool, data)
    except Exception:
        logger.exception("Error during poll cycle")


# --- CLI for first-time auth ---

if __name__ == "__main__":
    import sys
    if "--auth" in sys.argv:
        print("Starting Tesla OAuth login...")
        with _get_tesla_client() as tesla:
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
                status = products[0].get_site_live_status()
                print(f"Live status: solar={status.get('solar_power', 0)}W "
                      f"grid={status.get('grid_power', 0)}W "
                      f"battery={status.get('percentage_charged', 0)}%")
    else:
        print("Usage: python -m backend.poller --auth")
