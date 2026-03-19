"""
Daily aggregation job — runs at 6:50am, covers the prior day.

1. Aggregates tesla_intervals into daily_summaries
2. Runs action rules against last 7 days
3. Picks a context narrative
4. Sends the daily report at 7am
"""

import json
import logging
from datetime import date, datetime, time, timedelta, timezone

import asyncpg

from backend.notifier import send_daily_report
from backend.rates import (
    get_export_rate,
    get_import_rate,
    get_tou_period,
    is_peak_window,
)

logger = logging.getLogger(__name__)

# 5-minute interval in hours for kWh conversion
INTERVAL_HOURS = 5 / 60

# Action rule thresholds
ACTION_MIN_DAYS = 3           # pattern must hold 3+ of last 7 days
ACTION_MIN_MONTHLY_SAVING = 5  # estimated saving > $5/month


async def aggregate_day(pool: asyncpg.Pool, day: date) -> dict:
    """Aggregate tesla_intervals for a single day into a summary dict."""

    # Fetch all intervals for the day (in local time)
    start = datetime.combine(day, time.min).astimezone()
    end = datetime.combine(day + timedelta(days=1), time.min).astimezone()

    rows = await pool.fetch(
        """
        SELECT ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w
        FROM tesla_intervals
        WHERE ts >= $1 AND ts < $2
        ORDER BY ts
        """,
        start, end,
    )

    if not rows:
        logger.warning("No data for %s", day)
        return {}

    # Accumulators
    total_import_kwh = 0.0
    total_export_kwh = 0.0
    solar_generated_kwh = 0.0
    peak_import_kwh = 0.0
    part_peak_import_kwh = 0.0
    off_peak_import_kwh = 0.0
    peak_cost = 0.0
    part_peak_cost = 0.0
    off_peak_cost = 0.0
    ev_kwh = 0.0
    ev_peak_kwh = 0.0
    ev_off_peak_kwh = 0.0
    ev_cost = 0.0

    # Powerwall peak tracking
    peak_intervals_total = 0
    peak_intervals_covered = 0  # battery discharging during peak
    battery_depletion_hour = None

    for row in rows:
        ts_local = row["ts"].astimezone()
        rate = get_import_rate(ts_local)
        period = get_tou_period(ts_local)

        solar_kwh = max(row["solar_w"], 0) * INTERVAL_HOURS / 1000
        solar_generated_kwh += solar_kwh

        grid_w = row["grid_w"]
        if grid_w > 0:
            import_kwh = grid_w * INTERVAL_HOURS / 1000
            total_import_kwh += import_kwh
            cost = import_kwh * rate
            if period == "peak":
                peak_import_kwh += import_kwh
                peak_cost += cost
            elif period == "part_peak":
                part_peak_import_kwh += import_kwh
                part_peak_cost += cost
            else:
                off_peak_import_kwh += import_kwh
                off_peak_cost += cost
        else:
            export_kwh = abs(grid_w) * INTERVAL_HOURS / 1000
            total_export_kwh += export_kwh

        # EV charging
        vw = max(row["vehicle_w"], 0)
        if vw > 0:
            ev_interval_kwh = vw * INTERVAL_HOURS / 1000
            ev_kwh += ev_interval_kwh
            ev_interval_cost = ev_interval_kwh * rate
            ev_cost += ev_interval_cost
            if period == "peak":
                ev_peak_kwh += ev_interval_kwh
            else:
                ev_off_peak_kwh += ev_interval_kwh

        # Powerwall peak coverage
        if is_peak_window(ts_local):
            peak_intervals_total += 1
            # Battery discharging (negative battery_w) means covering load
            if row["battery_w"] < -50:  # small threshold to ignore noise
                peak_intervals_covered += 1
            # Track when battery depleted during peak
            if (
                battery_depletion_hour is None
                and row["battery_pct"] < 10
                and row["battery_w"] >= 0
            ):
                battery_depletion_hour = ts_local.hour + ts_local.minute / 60

    total_cost = peak_cost + part_peak_cost + off_peak_cost
    export_credit = total_export_kwh * get_export_rate()
    solar_self_consumed_kwh = solar_generated_kwh - total_export_kwh
    battery_coverage = (
        (peak_intervals_covered / peak_intervals_total * 100)
        if peak_intervals_total > 0
        else 0
    )

    summary = {
        "day": day,
        "total_import_kwh": total_import_kwh,
        "total_export_kwh": total_export_kwh,
        "solar_generated_kwh": solar_generated_kwh,
        "solar_self_consumed_kwh": max(solar_self_consumed_kwh, 0),
        "peak_import_kwh": peak_import_kwh,
        "part_peak_import_kwh": part_peak_import_kwh,
        "off_peak_import_kwh": off_peak_import_kwh,
        "peak_cost": peak_cost,
        "part_peak_cost": part_peak_cost,
        "off_peak_cost": off_peak_cost,
        "total_cost": total_cost,
        "export_credit": export_credit,
        "ev_kwh": ev_kwh,
        "ev_peak_kwh": ev_peak_kwh,
        "ev_off_peak_kwh": ev_off_peak_kwh,
        "ev_cost": ev_cost,
        "battery_peak_coverage_pct": battery_coverage,
        "battery_depletion_hour": battery_depletion_hour,
    }
    return summary


async def save_summary(pool: asyncpg.Pool, summary: dict) -> None:
    """Upsert a daily summary row."""
    await pool.execute(
        """
        INSERT INTO daily_summaries (
            day, total_import_kwh, total_export_kwh, solar_generated_kwh,
            solar_self_consumed_kwh, peak_import_kwh, part_peak_import_kwh,
            off_peak_import_kwh, peak_cost, part_peak_cost, off_peak_cost,
            total_cost, export_credit, ev_kwh, ev_peak_kwh, ev_off_peak_kwh,
            ev_cost, battery_peak_coverage_pct, battery_depletion_hour,
            context_narrative, actions_json
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21
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
            battery_depletion_hour = EXCLUDED.battery_depletion_hour,
            context_narrative = EXCLUDED.context_narrative,
            actions_json = EXCLUDED.actions_json
        """,
        summary["day"],
        summary["total_import_kwh"],
        summary["total_export_kwh"],
        summary["solar_generated_kwh"],
        summary["solar_self_consumed_kwh"],
        summary["peak_import_kwh"],
        summary["part_peak_import_kwh"],
        summary["off_peak_import_kwh"],
        summary["peak_cost"],
        summary["part_peak_cost"],
        summary["off_peak_cost"],
        summary["total_cost"],
        summary["export_credit"],
        summary["ev_kwh"],
        summary["ev_peak_kwh"],
        summary["ev_off_peak_kwh"],
        summary["ev_cost"],
        summary["battery_peak_coverage_pct"],
        summary["battery_depletion_hour"],
        summary.get("context_narrative"),
        json.dumps(summary.get("actions", [])),
    )


# --- Action rules ---


async def evaluate_actions(pool: asyncpg.Pool, target_day: date) -> list[str]:
    """
    Evaluate action rules against the last 7 days of summaries.
    Returns list of action strings to include in the report.
    """
    rows = await pool.fetch(
        """
        SELECT * FROM daily_summaries
        WHERE day > $1 AND day <= $2
        ORDER BY day
        """,
        target_day - timedelta(days=7),
        target_day,
    )

    if len(rows) < 3:
        return []

    actions = []

    # Rule 1: EV charging during peak hours
    ev_peak_days = sum(1 for r in rows if r["ev_peak_kwh"] > 0.5)
    if ev_peak_days >= ACTION_MIN_DAYS:
        avg_ev_peak_cost = sum(
            r["ev_peak_kwh"] * 0.356 for r in rows  # worst case winter peak
        ) / len(rows)
        monthly_saving = avg_ev_peak_cost * 30  # rough monthly projection
        if monthly_saving >= ACTION_MIN_MONTHLY_SAVING:
            actions.append(
                "Shift EV charging to solar hours (9am–3pm) — your EV charged "
                f"during peak rates on {ev_peak_days} of the last {len(rows)} days."
            )

    # Rule 2: Repeated high grid draw in same window
    # Find hours with consistently high import across days
    from collections import Counter
    high_draw_hours: Counter = Counter()
    for r in rows:
        # Check interval data for this day
        day_intervals = await pool.fetch(
            """
            SELECT ts, grid_w FROM tesla_intervals
            WHERE ts >= $1 AND ts < $2 AND grid_w > 2000
            """,
            datetime.combine(r["day"], time.min).astimezone(),
            datetime.combine(r["day"] + timedelta(days=1), time.min).astimezone(),
        )
        for interval in day_intervals:
            high_draw_hours[interval["ts"].astimezone().hour] += 1

    for hour, count in high_draw_hours.most_common(3):
        if count >= ACTION_MIN_DAYS:
            end_hour = hour + 1
            period_label = f"{hour % 12 or 12}{'am' if hour < 12 else 'pm'}–{end_hour % 12 or 12}{'am' if end_hour < 12 else 'pm'}"
            actions.append(
                f"You consistently draw heavily from the grid between {period_label} "
                f"({count} of the last {len(rows)} days)."
            )
            break  # only report the worst one

    # Rule 3: Powerwall depleting before peak window closes
    depletion_days = sum(
        1 for r in rows
        if r["battery_depletion_hour"] is not None
    )
    if depletion_days >= ACTION_MIN_DAYS:
        avg_depletion = sum(
            r["battery_depletion_hour"]
            for r in rows
            if r["battery_depletion_hour"] is not None
        ) / depletion_days
        depletion_hr = int(avg_depletion)
        depletion_min = int((avg_depletion - depletion_hr) * 60)
        actions.append(
            f"Your battery is running out before 9pm — average depletion at "
            f"{depletion_hr % 12 or 12}:{depletion_min:02d}pm. "
            f"Consider adjusting your Powerwall reserve setting."
        )

    return actions


# --- Context narrative ---


def pick_context_narrative(summary: dict) -> str:
    """Pick the most relevant templated context for the day."""
    s = summary

    # EV charged at peak rates
    if s["ev_peak_kwh"] > 1.0:
        avoidable = s["ev_peak_kwh"] * 0.356
        return (
            f"Your EV pulled {s['ev_peak_kwh']:.1f} kWh during peak hours yesterday, "
            f"costing ${avoidable:.2f} at peak rates. Charging during solar hours "
            f"or off-peak would save you money."
        )

    # Powerwall depleted early
    if s["battery_depletion_hour"] and s["battery_depletion_hour"] < 21:
        hr = int(s["battery_depletion_hour"])
        return (
            f"Your Powerwall ran out around {hr % 12 or 12}pm, leaving "
            f"{21 - hr} hours of peak window uncovered by battery. "
            f"Grid import during that window cost ${s['peak_cost']:.2f}."
        )

    # Strong solar, low peak draw
    if s["solar_generated_kwh"] > 20 and s["peak_import_kwh"] < 3:
        return (
            f"Great solar day — {s['solar_generated_kwh']:.0f} kWh generated "
            f"with only {s['peak_import_kwh']:.1f} kWh imported during peak. "
            f"Your Powerwall covered {s['battery_peak_coverage_pct']:.0f}% of peak demand."
        )

    # Powerwall covered full peak
    if s["battery_peak_coverage_pct"] > 95:
        return (
            f"Your Powerwall covered the full peak window yesterday. "
            f"Total grid cost was just ${s['total_cost']:.2f}, mostly off-peak."
        )

    # High peak draw day
    if s["peak_cost"] > s["total_cost"] * 0.4:
        return (
            f"Peak hours accounted for ${s['peak_cost']:.2f} of your "
            f"${s['total_cost']:.2f} grid cost yesterday — "
            f"{s['peak_cost'] / s['total_cost'] * 100:.0f}% of total spend."
        )

    # Default
    return (
        f"Yesterday you imported {s['total_import_kwh']:.1f} kWh from the grid "
        f"(${s['total_cost']:.2f}) and generated {s['solar_generated_kwh']:.1f} kWh "
        f"of solar."
    )


# --- Month-to-date ---


async def get_mtd(pool: asyncpg.Pool, target_day: date) -> dict:
    """Get month-to-date cost and comparison to prior month same day."""
    first_of_month = target_day.replace(day=1)

    mtd = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_cost), 0) as cost FROM daily_summaries WHERE day >= $1 AND day <= $2",
        first_of_month, target_day,
    )

    # Prior month same period
    if first_of_month.month == 1:
        prior_first = first_of_month.replace(year=first_of_month.year - 1, month=12)
    else:
        prior_first = first_of_month.replace(month=first_of_month.month - 1)
    prior_day = min(target_day.day, 28)  # safe for all months
    prior_end = prior_first.replace(day=prior_day)

    prior_mtd = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_cost), 0) as cost FROM daily_summaries WHERE day >= $1 AND day <= $2",
        prior_first, prior_end,
    )

    mtd_cost = float(mtd["cost"])
    prior_cost = float(prior_mtd["cost"])

    if prior_cost > 0:
        pct_change = (mtd_cost - prior_cost) / prior_cost * 100
        vs = f"({'↑' if pct_change > 0 else '↓'}{abs(pct_change):.0f}% vs prior month)"
    else:
        vs = ""

    return {"mtd_cost": mtd_cost, "mtd_vs_prior": vs}


# --- Main job entry point ---


async def run_daily_aggregation(pool: asyncpg.Pool) -> None:
    """Full daily job: aggregate, evaluate, report."""
    yesterday = date.today() - timedelta(days=1)
    logger.info("Running daily aggregation for %s", yesterday)

    summary = await aggregate_day(pool, yesterday)
    if not summary:
        logger.warning("No data to aggregate for %s", yesterday)
        return

    actions = await evaluate_actions(pool, yesterday)
    summary["actions"] = actions
    summary["context_narrative"] = pick_context_narrative(summary)

    await save_summary(pool, summary)

    # Build report data
    mtd = await get_mtd(pool, yesterday)
    report_data = {
        "date": yesterday.isoformat(),
        "actions": actions if actions else None,
        "context": summary["context_narrative"],
        "total_import_kwh": summary["total_import_kwh"],
        "total_cost": summary["total_cost"],
        "peak_kwh": summary["peak_import_kwh"],
        "peak_cost": summary["peak_cost"],
        "part_peak_kwh": summary["part_peak_import_kwh"],
        "part_peak_cost": summary["part_peak_cost"],
        "off_peak_kwh": summary["off_peak_import_kwh"],
        "off_peak_cost": summary["off_peak_cost"],
        "ev_kwh": summary["ev_kwh"],
        "ev_cost": summary["ev_cost"],
        "battery_coverage": summary["battery_peak_coverage_pct"],
        "solar_generated_kwh": summary["solar_generated_kwh"],
        "solar_self_consumed_kwh": summary["solar_self_consumed_kwh"],
        "solar_exported_kwh": summary["total_export_kwh"],
        "export_credit": summary["export_credit"],
        **mtd,
    }

    await send_daily_report(report_data)

    # Log the report
    await pool.execute(
        """
        INSERT INTO reports_log (report_type, covers_from, covers_to, subject, body_html, metadata)
        VALUES ('daily', $1, $1, $2, $3, $4)
        """,
        yesterday,
        f"WattWise Daily — {yesterday.isoformat()}",
        "(see email)",
        json.dumps({"total_cost": summary["total_cost"]}),
    )

    logger.info("Daily report sent for %s — cost=$%.2f", yesterday, summary["total_cost"])
