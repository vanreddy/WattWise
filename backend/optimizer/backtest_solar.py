"""
Solar Prediction Backtest — compares original vs. seasonal-detrended model.

For each day in the test period, simulates what each model would have
predicted using only the previous 14 days of data, then compares against
actual solar generation.

Usage:
    python -m backend.optimizer.backtest_solar
"""

import sys
import math
from datetime import date, timedelta
from collections import defaultdict

import psycopg2

# Import the clear-sky model from predict.py
from backend.optimizer.predict import (
    clear_sky_potential,
    clear_sky_hourly_shape,
    DECAY_FACTOR,
)

# ─── Config ───
DB_URL = "postgresql://postgres:kDGSFeabhbtYQIFLTZTiiGpeMqKtryAL@nozomi.proxy.rlwy.net:17264/railway"
TEST_START = date(2025, 12, 1)
TEST_END = date(2026, 3, 31)


def fetch_all_hourly_solar(conn) -> dict[date, dict[int, float]]:
    """Fetch all hourly solar averages, organized by date → hour → watts."""
    cur = conn.cursor()
    cur.execute("""
        SELECT
            ts::date AS day,
            EXTRACT(HOUR FROM ts) AS hr,
            AVG(solar_w) AS avg_w
        FROM tesla_intervals
        WHERE ts >= %s AND ts <= %s
        GROUP BY 1, 2
        ORDER BY 1, 2
    """, (TEST_START - timedelta(days=15), TEST_END + timedelta(days=1)))

    data: dict[date, dict[int, float]] = defaultdict(dict)
    for day, hr, avg_w in cur.fetchall():
        data[day][int(hr)] = float(avg_w)

    cur.close()
    return dict(data)


# ─── Model A: Original (weighted average, no detrend) ───

def predict_original(
    target_date: date,
    all_data: dict[date, dict[int, float]],
) -> dict[int, float]:
    hourly_weighted: dict[int, list[tuple[float, float]]] = defaultdict(list)

    for days_ago in range(1, 15):
        hist_date = target_date - timedelta(days=days_ago)
        if hist_date not in all_data:
            continue
        weight = DECAY_FACTOR ** (days_ago - 1)
        for hr, solar_w in all_data[hist_date].items():
            hourly_weighted[hr].append((solar_w, weight))

    predictions: dict[int, float] = {}
    for hr in range(24):
        values = hourly_weighted.get(hr, [])
        if values:
            total_w = sum(w for _, w in values)
            predictions[hr] = sum(v * w for v, w in values) / total_w if total_w > 0 else 0
        else:
            predictions[hr] = 0.0
    return predictions


# ─── Model B: Seasonal detrended (daily-level normalization) ───

def predict_detrended(
    target_date: date,
    all_data: dict[date, dict[int, float]],
) -> dict[int, float]:
    """Seasonal detrend at the daily level:
    1. For each historical day, compute daily kWh / clear_sky_potential → perf ratio
    2. Weighted average of perf ratios → avg system output per unit potential
    3. Multiply by today's potential → predicted daily kWh
    4. Distribute across hours using today's hourly shape
    """
    today_potential = clear_sky_potential(target_date)
    today_shape = clear_sky_hourly_shape(target_date)

    # Step 1: Collect daily performance ratios
    daily_ratios: list[tuple[float, float]] = []  # (ratio_kwh, weight)

    for days_ago in range(1, 15):
        hist_date = target_date - timedelta(days=days_ago)
        if hist_date not in all_data:
            continue

        weight = DECAY_FACTOR ** (days_ago - 1)
        hist_potential = clear_sky_potential(hist_date)

        # Daily total kWh for this historical day
        hist_daily_kwh = sum(all_data[hist_date].values()) / 1000.0

        if hist_potential > 0.01:
            ratio = hist_daily_kwh / hist_potential  # kWh per unit potential
            daily_ratios.append((ratio, weight))

    # Step 2: Weighted average performance ratio
    if daily_ratios:
        total_w = sum(w for _, w in daily_ratios)
        avg_ratio = sum(r * w for r, w in daily_ratios) / total_w if total_w > 0 else 0
    else:
        avg_ratio = 0.0

    # Step 3: Predicted daily kWh
    predicted_daily_kwh = avg_ratio * today_potential

    # Step 4: Distribute across hours using today's clear-sky shape
    predictions: dict[int, float] = {}
    for hr in range(24):
        # shape weight → fraction of daily energy in this hour
        hr_fraction = today_shape.get(hr, 0.0)
        # Convert back to average watts for this hour: kWh_this_hour * 1000
        predictions[hr] = predicted_daily_kwh * hr_fraction * 1000.0

    return predictions


# ─── Metrics ───

def daily_kwh(hourly_watts: dict[int, float]) -> float:
    return sum(hourly_watts.values()) / 1000.0


def hourly_rmse(predicted: dict[int, float], actual: dict[int, float]) -> float:
    errors = []
    for hr in range(6, 20):
        p = predicted.get(hr, 0)
        a = actual.get(hr, 0)
        errors.append((p - a) ** 2)
    return math.sqrt(sum(errors) / len(errors)) if errors else 0


# ─── Main ───

def run_backtest():
    conn = psycopg2.connect(DB_URL)
    print("Fetching all hourly solar data...")
    all_data = fetch_all_hourly_solar(conn)
    conn.close()

    print(f"Loaded {len(all_data)} days of data")
    print(f"Test period: {TEST_START} to {TEST_END}")

    # Quick sanity check: print clear-sky potentials
    print("\nClear-sky potential by month (relative to summer solstice):")
    for m in [12, 1, 2, 3]:
        y = 2025 if m == 12 else 2026
        d = date(y, m, 15)
        print(f"  {d.strftime('%b %d')}: {clear_sky_potential(d):.3f}")
    print()

    # ─── Run both models ───
    orig_by_month: dict[str, list[dict]] = defaultdict(list)
    detr_by_month: dict[str, list[dict]] = defaultdict(list)

    current = TEST_START
    while current <= TEST_END:
        if current not in all_data:
            current += timedelta(days=1)
            continue

        actual_hourly = all_data[current]
        actual_kwh = daily_kwh(actual_hourly)
        if actual_kwh < 0.5:
            current += timedelta(days=1)
            continue

        month_key = current.strftime("%Y-%m")

        # Original model
        pred_orig = predict_original(current, all_data)
        orig_kwh = daily_kwh(pred_orig)
        orig_err = abs(orig_kwh - actual_kwh) / actual_kwh * 100
        orig_bias = orig_kwh - actual_kwh
        orig_rmse = hourly_rmse(pred_orig, actual_hourly)
        orig_by_month[month_key].append({
            "date": current, "actual": actual_kwh, "predicted": orig_kwh,
            "ape": orig_err, "bias": orig_bias, "rmse": orig_rmse,
        })

        # Detrended model
        pred_detr = predict_detrended(current, all_data)
        detr_kwh = daily_kwh(pred_detr)
        detr_err = abs(detr_kwh - actual_kwh) / actual_kwh * 100
        detr_bias = detr_kwh - actual_kwh
        detr_rmse = hourly_rmse(pred_detr, actual_hourly)
        detr_by_month[month_key].append({
            "date": current, "actual": actual_kwh, "predicted": detr_kwh,
            "ape": detr_err, "bias": detr_bias, "rmse": detr_rmse,
        })

        current += timedelta(days=1)

    # ─── Print Comparison ───
    print("=" * 90)
    print(f"{'SOLAR PREDICTION BACKTEST — ORIGINAL vs. SEASONAL DETREND':^90}")
    print("=" * 90)
    print()
    print(f"{'':30} {'── Original ──':>24}    {'── Detrended ──':>24}    {'Δ MAPE':>8}")
    print(f"{'Month':<10} {'Days':>5} {'Actual':>10}  {'MAPE':>8} {'Bias':>10}   {'MAPE':>8} {'Bias':>10}   {'':>8}")
    print("-" * 90)

    all_orig = []
    all_detr = []

    for month_key in sorted(set(list(orig_by_month.keys()) + list(detr_by_month.keys()))):
        o_days = orig_by_month[month_key]
        d_days = detr_by_month[month_key]
        n = len(o_days)
        avg_actual = sum(d["actual"] for d in o_days) / n

        o_mape = sum(d["ape"] for d in o_days) / n
        o_bias = sum(d["bias"] for d in o_days) / n
        d_mape = sum(d["ape"] for d in d_days) / n
        d_bias = sum(d["bias"] for d in d_days) / n

        delta = d_mape - o_mape
        arrow = "✅" if delta < 0 else "❌"

        print(f"{month_key:<10} {n:>5} {avg_actual:>8.1f} kWh  {o_mape:>7.1f}% {o_bias:>+9.1f} kWh   {d_mape:>7.1f}% {d_bias:>+9.1f} kWh   {delta:>+6.1f}% {arrow}")

        all_orig.extend(o_days)
        all_detr.extend(d_days)

    print("-" * 90)

    n = len(all_orig)
    o_mape = sum(d["ape"] for d in all_orig) / n
    o_bias = sum(d["bias"] for d in all_orig) / n
    d_mape = sum(d["ape"] for d in all_detr) / n
    d_bias = sum(d["bias"] for d in all_detr) / n
    delta = d_mape - o_mape
    avg_actual = sum(d["actual"] for d in all_orig) / n

    print(f"{'OVERALL':<10} {n:>5} {avg_actual:>8.1f} kWh  {o_mape:>7.1f}% {o_bias:>+9.1f} kWh   {d_mape:>7.1f}% {d_bias:>+9.1f} kWh   {delta:>+6.1f}% {'✅' if delta < 0 else '❌'}")
    print()

    # ─── Error distribution comparison ───
    o_errs = sorted(d["ape"] for d in all_orig)
    d_errs = sorted(d["ape"] for d in all_detr)

    print(f"{'ERROR DISTRIBUTION':^90}")
    print(f"{'Metric':<20} {'Original':>15} {'Detrended':>15} {'Better?':>10}")
    print("-" * 60)
    for label, pct in [("Median", 0.50), ("P75", 0.75), ("P90", 0.90), ("P95", 0.95)]:
        ov = o_errs[int(n * pct)]
        dv = d_errs[int(n * pct)]
        better = "✅" if dv < ov else "❌"
        print(f"{label:<20} {ov:>13.1f}% {dv:>13.1f}% {better:>10}")

    for thresh in [10, 20, 30]:
        o_pct = sum(1 for e in o_errs if e <= thresh) / n * 100
        d_pct = sum(1 for e in d_errs if e <= thresh) / n * 100
        better = "✅" if d_pct > o_pct else "❌"
        print(f"Within {thresh}%{'':<13} {o_pct:>12.0f}% {d_pct:>12.0f}% {better:>10}")
    print()

    # ─── Bias analysis ───
    o_over = sum(1 for d in all_orig if d["bias"] > 0)
    d_over = sum(1 for d in all_detr if d["bias"] > 0)
    print(f"BIAS: Original over-predicted {o_over}/{n} days ({o_over/n*100:.0f}%)")
    print(f"      Detrended over-predicted {d_over}/{n} days ({d_over/n*100:.0f}%)")
    print()

    # ─── Worst days comparison ───
    print("TOP 5 WORST DAYS — did detrend help?")
    orig_worst = sorted(all_orig, key=lambda d: d["ape"], reverse=True)[:5]
    for ow in orig_worst:
        dt = ow["date"]
        dw = next(d for d in all_detr if d["date"] == dt)
        better = "✅" if dw["ape"] < ow["ape"] else "❌"
        print(f"  {dt}  actual={ow['actual']:.1f} kWh  orig={ow['predicted']:.1f} ({ow['ape']:.0f}%)  detr={dw['predicted']:.1f} ({dw['ape']:.0f}%)  {better}")

    # ─── Monthly bias direction ───
    print()
    print("MONTHLY BIAS DIRECTION (Detrended):")
    for month_key in sorted(detr_by_month.keys()):
        days = detr_by_month[month_key]
        avg_bias = sum(d["bias"] for d in days) / len(days)
        over = sum(1 for d in days if d["bias"] > 0)
        under = len(days) - over
        direction = "OVER ↑" if avg_bias > 0 else "UNDER ↓"
        print(f"  {month_key}: {direction} by {abs(avg_bias):.1f} kWh/day  (over {over}d / under {under}d)")


if __name__ == "__main__":
    run_backtest()
