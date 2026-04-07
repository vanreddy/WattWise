"""
Prediction module: solar, base load, and temperature forecasts.

Solar: Clear-sky normalized historical average × weather forecast.
Base load: 7-day same-weekday average with HVAC/EV stripped.
Temperature: From OpenWeatherMap hourly forecast.
"""

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import asyncpg
import httpx

logger = logging.getLogger(__name__)

# ─── OpenWeatherMap ───

OWM_API_KEY = os.getenv("OPENWEATHERMAP_API_KEY", "")
OWM_BASE = "https://api.openweathermap.org/data/3.0/onecall"
CLOUD_COVER_COEFF = 0.8  # 100% clouds → 20% of clear-sky output
DECAY_FACTOR = 0.85      # Exponential decay for historical weighting


async def fetch_weather_forecast(lat: float, lon: float) -> list[dict]:
    """Fetch 48-hour hourly forecast from OpenWeatherMap.

    Returns list of dicts: [{hour: int, clouds_pct: float, temp_f: float, dt: datetime}, ...]
    """
    if not OWM_API_KEY:
        logger.warning("No OPENWEATHERMAP_API_KEY — returning empty forecast")
        return []

    url = f"{OWM_BASE}?lat={lat}&lon={lon}&exclude=minutely,daily,alerts&units=imperial&appid={OWM_API_KEY}"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()

    hourly = []
    for h in data.get("hourly", []):
        dt = datetime.fromtimestamp(h["dt"], tz=timezone.utc)
        hourly.append({
            "dt": dt,
            "hour": dt.hour,
            "clouds_pct": h.get("clouds", 0) / 100.0,  # 0.0 - 1.0
            "temp_f": h.get("temp", 70),
            "conditions": h.get("weather", [{}])[0].get("main", ""),
        })

    return hourly


async def store_weather_snapshot(pool: asyncpg.Pool, account_id, hourly: list[dict]):
    """Store hourly weather observations for backtest history."""
    if not hourly:
        return

    for h in hourly:
        await pool.execute("""
            INSERT INTO weather_history (account_id, ts, cloud_cover_pct, temp_f, conditions)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (account_id, ts) DO UPDATE SET
                cloud_cover_pct = EXCLUDED.cloud_cover_pct,
                temp_f = EXCLUDED.temp_f,
                conditions = EXCLUDED.conditions
        """, account_id, h["dt"], h["clouds_pct"], h["temp_f"], h["conditions"])


# ─── Solar Prediction ───

async def predict_solar(
    pool: asyncpg.Pool,
    account_id,
    weather_forecast: list[dict],
    now: Optional[datetime] = None,
) -> dict[int, float]:
    """Predict solar generation (watts) for each hour in the next 24 hours.

    Returns: {hour_offset: predicted_watts, ...} where offset 0 = current hour.
    """
    now = now or datetime.now(timezone.utc)
    local_hour = now.hour  # Simplified — use account timezone later

    # Step 1: Fetch last 14 days of hourly solar data
    rows = await pool.fetch("""
        SELECT
            date_trunc('hour', ts) AS hour_ts,
            AVG(solar_w) AS avg_solar_w
        FROM tesla_intervals
        WHERE account_id = $1
          AND ts >= $2
        GROUP BY hour_ts
        ORDER BY hour_ts
    """, account_id, now - timedelta(days=14))

    if not rows:
        logger.warning("No solar history for prediction — returning zeros")
        return {h: 0.0 for h in range(24)}

    # Organize by day → hour
    # day_data[days_ago][hour] = avg_solar_w
    day_data: dict[int, dict[int, float]] = {}
    for row in rows:
        hour_ts = row["hour_ts"]
        days_ago = (now.date() - hour_ts.date()).days
        if 1 <= days_ago <= 14:
            hr = hour_ts.hour
            day_data.setdefault(days_ago, {})[hr] = row["avg_solar_w"]

    # Step 2: Get historical weather (cloud cover) for normalization
    weather_rows = await pool.fetch("""
        SELECT ts, cloud_cover_pct
        FROM weather_history
        WHERE account_id = $1
          AND ts >= $2
    """, account_id, now - timedelta(days=14))

    hist_clouds: dict[str, float] = {}
    for wr in weather_rows:
        key = f"{wr['ts'].date()}_{wr['ts'].hour}"
        hist_clouds[key] = wr["cloud_cover_pct"] or 0.0

    # Step 3: Normalize each historical hour to clear-sky equivalent
    clear_sky: dict[int, list[tuple[float, float]]] = {}  # hour → [(value, weight), ...]
    for days_ago, hours in sorted(day_data.items()):
        weight = DECAY_FACTOR ** (days_ago - 1)  # yesterday = 1.0
        for hr, solar_w in hours.items():
            date_key = f"{(now - timedelta(days=days_ago)).date()}_{hr}"
            cloud_pct = hist_clouds.get(date_key, 0.0)
            weather_factor = max(0.1, 1.0 - cloud_pct * CLOUD_COVER_COEFF)
            clear_sky_w = solar_w / weather_factor
            clear_sky.setdefault(hr, []).append((clear_sky_w, weight))

    # Step 4: Weighted average for each hour → baseline
    baseline: dict[int, float] = {}
    for hr, values in clear_sky.items():
        total_weight = sum(w for _, w in values)
        if total_weight > 0:
            baseline[hr] = sum(v * w for v, w in values) / total_weight
        else:
            baseline[hr] = 0.0

    # Step 5: Apply today's weather forecast
    forecast_clouds: dict[int, float] = {}
    for f in weather_forecast:
        forecast_clouds[f["hour"]] = f["clouds_pct"]

    predictions: dict[int, float] = {}
    for offset in range(24):
        target_hour = (local_hour + offset) % 24
        base = baseline.get(target_hour, 0.0)
        cloud_pct = forecast_clouds.get(target_hour, 0.0)
        weather_factor = max(0.1, 1.0 - cloud_pct * CLOUD_COVER_COEFF)
        predicted = max(0.0, base * weather_factor)
        predictions[offset] = round(predicted, 1)

    return predictions


# ─── Base Load Prediction ───

async def predict_base_load(
    pool: asyncpg.Pool,
    account_id,
    now: Optional[datetime] = None,
) -> dict[int, float]:
    """Predict base load (watts, excluding HVAC/EV) for each hour in the next 24h.

    Uses last 4 same-weekday profiles.
    """
    now = now or datetime.now(timezone.utc)
    weekday = now.weekday()  # 0=Monday

    # Find same-weekday days in last 28 days
    same_weekdays = []
    for days_ago in range(1, 29):
        d = now - timedelta(days=days_ago)
        if d.weekday() == weekday:
            same_weekdays.append(d.date())
        if len(same_weekdays) >= 4:
            break

    if not same_weekdays:
        return {h: 500.0 for h in range(24)}  # Default 500W base

    rows = await pool.fetch("""
        SELECT
            date_trunc('hour', ts) AS hour_ts,
            AVG(home_w) AS avg_home_w,
            AVG(vehicle_w) AS avg_ev_w
        FROM tesla_intervals
        WHERE account_id = $1
          AND ts::date = ANY($2::date[])
        GROUP BY hour_ts
        ORDER BY hour_ts
    """, account_id, same_weekdays)

    # Average by hour, strip EV (HVAC harder to strip without separate metering)
    hourly_loads: dict[int, list[float]] = {}
    for row in rows:
        hr = row["hour_ts"].hour
        base = max(0, row["avg_home_w"] - row["avg_ev_w"])
        hourly_loads.setdefault(hr, []).append(base)

    local_hour = now.hour
    predictions: dict[int, float] = {}
    for offset in range(24):
        target_hour = (local_hour + offset) % 24
        vals = hourly_loads.get(target_hour, [])
        predictions[offset] = round(sum(vals) / len(vals), 1) if vals else 500.0

    return predictions


# ─── Temperature Forecast ───

def extract_temp_forecast(weather_forecast: list[dict], now: Optional[datetime] = None) -> dict[int, float]:
    """Extract outdoor temperature (°F) for next 24 hours from weather forecast."""
    now = now or datetime.now(timezone.utc)
    local_hour = now.hour

    temp_by_hour: dict[int, float] = {}
    for f in weather_forecast:
        temp_by_hour[f["hour"]] = f["temp_f"]

    predictions: dict[int, float] = {}
    for offset in range(24):
        target_hour = (local_hour + offset) % 24
        predictions[offset] = temp_by_hour.get(target_hour, 75.0)

    return predictions
