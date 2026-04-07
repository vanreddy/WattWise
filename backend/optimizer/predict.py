"""
Prediction module: solar, base load, and temperature forecasts.

Solar: Clear-sky normalized historical average × weather forecast.
Base load: 7-day same-weekday average with HVAC/EV stripped.
Temperature: From OpenWeatherMap hourly forecast.
"""

import logging
import math
import os
from datetime import datetime, timedelta, timezone, date as date_type
from typing import Optional

import asyncpg
import httpx

logger = logging.getLogger(__name__)

# ─── OpenWeatherMap ───

OWM_API_KEY = os.getenv("OPENWEATHERMAP_API_KEY", "")
OWM_BASE = "https://api.openweathermap.org/data/3.0/onecall"
CLOUD_COVER_COEFF = 0.8  # 100% clouds → 20% of clear-sky output
DECAY_FACTOR = 0.85      # Exponential decay for historical weighting

# ─── Seasonal Clear-Sky Model ───
# Alamo, CA latitude — used to compute solar declination and day length
LATITUDE = 37.77  # degrees


def _solar_declination(day_of_year: int) -> float:
    """Solar declination angle in radians for a given day of year."""
    return math.radians(23.45) * math.sin(math.radians(360 / 365 * (day_of_year - 81)))


def _day_length_hours(lat_rad: float, declination: float) -> float:
    """Approximate day length in hours."""
    cos_ha = -math.tan(lat_rad) * math.tan(declination)
    cos_ha = max(-1.0, min(1.0, cos_ha))  # clamp for polar edge cases
    hour_angle = math.acos(cos_ha)
    return (2.0 * hour_angle / math.pi) * 12.0


def clear_sky_potential(d: date_type) -> float:
    """Relative clear-sky solar potential for a date (0-1 scale).

    Based on day length and solar elevation at latitude.
    Normalized so summer solstice ≈ 1.0.
    """
    doy = d.timetuple().tm_yday
    lat_rad = math.radians(LATITUDE)
    decl = _solar_declination(doy)

    # Day length factor (longer days = more energy)
    day_hrs = _day_length_hours(lat_rad, decl)

    # Peak solar elevation factor (higher sun = more intensity per hour)
    solar_noon_elevation = math.degrees(
        math.asin(math.sin(lat_rad) * math.sin(decl) +
                  math.cos(lat_rad) * math.cos(decl))
    )
    elevation_factor = max(0, math.sin(math.radians(solar_noon_elevation)))

    # Combined: day_length × peak_intensity
    raw = day_hrs * elevation_factor

    # Normalize: summer solstice (doy ~172) at this latitude
    summer_decl = _solar_declination(172)
    summer_day = _day_length_hours(lat_rad, summer_decl)
    summer_elev = math.degrees(
        math.asin(math.sin(lat_rad) * math.sin(summer_decl) +
                  math.cos(lat_rad) * math.cos(summer_decl))
    )
    summer_raw = summer_day * max(0, math.sin(math.radians(summer_elev)))

    return raw / summer_raw if summer_raw > 0 else 0.0


def clear_sky_hourly_shape(d: date_type) -> dict[int, float]:
    """Relative clear-sky irradiance shape by hour (0-23).

    Returns weights that sum to ~1.0, representing what fraction of
    daily energy each hour contributes on a clear day.
    """
    doy = d.timetuple().tm_yday
    lat_rad = math.radians(LATITUDE)
    decl = _solar_declination(doy)

    # Solar noon is ~12:00 local (simplified, ignoring equation of time)
    weights: dict[int, float] = {}
    total = 0.0
    for hr in range(24):
        # Hour angle: 0 at noon, negative morning, positive afternoon
        hour_angle = math.radians(15 * (hr - 12))
        sin_elev = (math.sin(lat_rad) * math.sin(decl) +
                    math.cos(lat_rad) * math.cos(decl) * math.cos(hour_angle))
        irr = max(0.0, sin_elev)
        weights[hr] = irr
        total += irr

    # Normalize so sum = 1.0
    if total > 0:
        for hr in weights:
            weights[hr] /= total

    return weights


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

    # Step 3: Seasonal detrend at daily level + weather normalization
    # For each historical day:
    #   - Weather-normalize hourly values to remove cloud effects
    #   - Sum to get weather-normalized daily kWh
    #   - Divide by that day's clear-sky potential → performance ratio
    # Average those ratios, multiply by today's potential → predicted daily kWh
    # Then distribute across hours using today's clear-sky shape + weather forecast

    today_potential = clear_sky_potential(now.date())
    today_shape = clear_sky_hourly_shape(now.date())

    daily_ratios: list[tuple[float, float]] = []  # (ratio_kwh, weight)
    for days_ago, hours in sorted(day_data.items()):
        weight = DECAY_FACTOR ** (days_ago - 1)
        hist_date = (now - timedelta(days=days_ago)).date()
        hist_potential = clear_sky_potential(hist_date)

        # Weather-normalize each hour, then sum to daily kWh
        daily_kwh = 0.0
        for hr, solar_w in hours.items():
            date_key = f"{hist_date}_{hr}"
            cloud_pct = hist_clouds.get(date_key, 0.0)
            weather_factor = max(0.1, 1.0 - cloud_pct * CLOUD_COVER_COEFF)
            daily_kwh += (solar_w / weather_factor) / 1000.0

        if hist_potential > 0.01:
            ratio = daily_kwh / hist_potential
            daily_ratios.append((ratio, weight))

    # Step 4: Weighted average performance ratio
    if daily_ratios:
        total_weight = sum(w for _, w in daily_ratios)
        avg_ratio = sum(r * w for r, w in daily_ratios) / total_weight if total_weight > 0 else 0
    else:
        avg_ratio = 0.0

    # Step 5: Predicted daily kWh (clear-sky), then apply weather + distribute hourly
    predicted_clear_sky_kwh = avg_ratio * today_potential

    forecast_clouds: dict[int, float] = {}
    for f in weather_forecast:
        forecast_clouds[f["hour"]] = f["clouds_pct"]

    predictions: dict[int, float] = {}
    for offset in range(24):
        target_hour = (local_hour + offset) % 24
        hr_fraction = today_shape.get(target_hour, 0.0)
        clear_sky_w = predicted_clear_sky_kwh * hr_fraction * 1000.0

        cloud_pct = forecast_clouds.get(target_hour, 0.0)
        weather_factor = max(0.1, 1.0 - cloud_pct * CLOUD_COVER_COEFF)
        predicted = max(0.0, clear_sky_w * weather_factor)
        predictions[offset] = round(predicted, 1)

    return predictions


# ─── Base Load Prediction ───

# Wall Connector power data became available after this date.
# Before this, vehicle_w was always 0 (backfill API doesn't include it).
VEHICLE_W_RELIABLE_AFTER = date_type(2026, 3, 21)


async def predict_base_load(
    pool: asyncpg.Pool,
    account_id,
    now: Optional[datetime] = None,
) -> dict[int, float]:
    """Predict base load (watts, excluding HVAC/EV) for each hour in the next 24h.

    Uses last 4 same-weekday profiles where vehicle_w data is reliable
    (after Wall Connector integration went live on 2026-03-21).
    Falls back to older data only if not enough reliable days exist.
    """
    now = now or datetime.now(timezone.utc)
    weekday = now.weekday()  # 0=Monday

    # Find same-weekday days in last 56 days, preferring ones with reliable EV data
    reliable_days = []
    fallback_days = []
    for days_ago in range(1, 57):
        d = now - timedelta(days=days_ago)
        if d.weekday() == weekday:
            if d.date() >= VEHICLE_W_RELIABLE_AFTER:
                reliable_days.append(d.date())
            else:
                fallback_days.append(d.date())
        if len(reliable_days) >= 4:
            break

    # Use reliable days first; pad with fallback if needed (min 2 days)
    same_weekdays = reliable_days
    if len(same_weekdays) < 2:
        same_weekdays.extend(fallback_days[:4 - len(same_weekdays)])

    if not same_weekdays:
        return {h: 500.0 for h in range(24)}  # Default 500W base

    has_reliable_ev = len(reliable_days) > 0

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

    # Strip EV charging from home load.
    # For days with reliable vehicle_w, subtraction works directly.
    # For older days (vehicle_w=0), the EV load is baked into home_w —
    # we accept the noise since reliable days will increasingly dominate.
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

    logger.info(
        "Base load prediction: %d reliable days, %d fallback days, has_ev_data=%s",
        len(reliable_days), len(same_weekdays) - len(reliable_days), has_reliable_ev,
    )

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
