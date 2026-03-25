from __future__ import annotations

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
from zoneinfo import ZoneInfo

from uuid import UUID

import anthropic
import asyncpg

LOCAL_TZ = ZoneInfo("America/Los_Angeles")

from backend.notifier import send_daily_report
from backend.rates import (
    get_export_rate,
    get_import_rate,
    get_tou_period,
    is_peak_window,
    is_summer,
)

logger = logging.getLogger(__name__)

# 5-minute interval in hours for kWh conversion
INTERVAL_HOURS = 5 / 60

# Action rule thresholds
ACTION_MIN_DAYS = 3           # pattern must hold 3+ of last 7 days
ACTION_MIN_MONTHLY_SAVING = 5  # estimated saving > $5/month


async def aggregate_day(pool: asyncpg.Pool, day: date, account_id: UUID) -> dict:
    """Aggregate tesla_intervals for a single day into a summary dict."""

    # Fetch all intervals for the day (in Pacific time)
    start = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)

    rows = await pool.fetch(
        """
        SELECT ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w
        FROM tesla_intervals
        WHERE account_id = $1 AND ts >= $2 AND ts < $3
        ORDER BY ts
        """,
        account_id, start, end,
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

        # EV charging — read from wall_connector_power (stored as vehicle_w)
        vw = float(row["vehicle_w"] or 0)
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
            # Battery discharging (positive battery_w) means covering load
            # Tesla convention: battery_w > 0 = discharging, < 0 = charging
            if row["battery_w"] > 50:  # small threshold to ignore noise
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

    # Sanity check the aggregated summary
    from backend.data_sanity_checks import validate_daily_summary
    issues = validate_daily_summary(summary, len(rows))
    if issues:
        logger.warning("Aggregation sanity issues for %s/%s:\n  %s", account_id, day, "\n  ".join(issues))

    return summary


async def save_summary(pool: asyncpg.Pool, summary: dict, account_id: UUID) -> None:
    """Upsert a daily summary row."""
    await pool.execute(
        """
        INSERT INTO daily_summaries (
            day, total_import_kwh, total_export_kwh, solar_generated_kwh,
            solar_self_consumed_kwh, peak_import_kwh, part_peak_import_kwh,
            off_peak_import_kwh, peak_cost, part_peak_cost, off_peak_cost,
            total_cost, export_credit, ev_kwh, ev_peak_kwh, ev_off_peak_kwh,
            ev_cost, battery_peak_coverage_pct, battery_depletion_hour,
            context_narrative, actions_json, account_id
        ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
        )
        ON CONFLICT (account_id, day) DO UPDATE SET
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
        account_id,
    )


# --- Action rules ---


async def evaluate_actions(pool: asyncpg.Pool, target_day: date, account_id: UUID) -> list[str]:
    """
    Evaluate action rules against the last 7 days of summaries.
    Returns list of action strings to include in the report.
    """
    rows = await pool.fetch(
        """
        SELECT * FROM daily_summaries
        WHERE account_id = $1 AND day > $2 AND day <= $3
        ORDER BY day
        """,
        account_id, target_day - timedelta(days=7), target_day,
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
            WHERE account_id = $1 AND ts >= $2 AND ts < $3 AND grid_w > 2000
            """,
            account_id,
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

DAILY_NARRATIVE_PROMPT = """\
You are an energy advisor for a homeowner with solar panels, a Tesla Powerwall, \
and a BMW iX EV. Write a 2-3 sentence daily insight for their energy dashboard. \
Be specific about dollar amounts and kWh. Focus on the single most interesting \
or actionable pattern from the day. Keep the tone concise and helpful — like a \
knowledgeable friend, not a formal report.

Rate context: {season_rates} Export earns ~$0.068/kWh. Current season: {season}.

Yesterday's data:
- Grid import: {total_import_kwh:.1f} kWh, cost ${total_cost:.2f}
- Peak hours: {peak_import_kwh:.1f} kWh (${peak_cost:.2f}), Part-peak: \
{part_peak_import_kwh:.1f} kWh (${part_peak_cost:.2f}), Off-peak: \
{off_peak_import_kwh:.1f} kWh (${off_peak_cost:.2f})
- Solar generated: {solar_generated_kwh:.1f} kWh
- Solar self-consumed: {solar_self_consumed_kwh:.1f} kWh \
(avoided ${solar_self_consumed_value:.2f} in grid imports)
- Solar exported: {total_export_kwh:.1f} kWh (earned ${export_credit:.2f})
- EV charging: {ev_kwh:.1f} kWh total — {ev_peak_kwh:.1f} kWh during peak \
(${ev_peak_cost:.2f}), {ev_off_peak_kwh:.1f} kWh off-peak (${ev_off_peak_cost:.2f})
- Powerwall: covered {battery_peak_coverage_pct:.0f}% of peak window. \
{depletion_note}

Do NOT start with "Yesterday" — vary your opening. End with one specific, \
actionable suggestion if applicable."""


def _pick_context_narrative_fallback(summary: dict) -> str:
    """Templated fallback if LLM call fails."""
    s = summary
    if s["ev_peak_kwh"] > 1.0:
        avoidable = s["ev_peak_kwh"] * 0.356
        return (
            f"Your EV pulled {s['ev_peak_kwh']:.1f} kWh during peak hours, "
            f"costing ${avoidable:.2f} at peak rates. Charging during solar hours "
            f"or off-peak would save you money."
        )
    if s.get("battery_depletion_hour") and s["battery_depletion_hour"] < 21:
        hr = int(s["battery_depletion_hour"])
        return (
            f"Your Powerwall ran out around {hr % 12 or 12}pm, leaving "
            f"{21 - hr} hours of peak window uncovered by battery. "
            f"Grid import during that window cost ${s['peak_cost']:.2f}."
        )
    if s["solar_generated_kwh"] > 20 and s["peak_import_kwh"] < 3:
        return (
            f"Great solar day — {s['solar_generated_kwh']:.0f} kWh generated "
            f"with only {s['peak_import_kwh']:.1f} kWh imported during peak. "
            f"Your Powerwall covered {s['battery_peak_coverage_pct']:.0f}% of peak demand."
        )
    return (
        f"Imported {s['total_import_kwh']:.1f} kWh from the grid "
        f"(${s['total_cost']:.2f}) and generated {s['solar_generated_kwh']:.1f} kWh "
        f"of solar."
    )


async def generate_daily_narrative(summary: dict) -> str:
    """Call Claude to generate the daily context narrative. Falls back to template."""
    s = summary
    season = "Summer" if is_summer(s["day"]) else "Winter"

    if season == "Summer":
        season_rates = "Peak $0.796/kWh (5-8pm weekdays), off-peak $0.561/kWh."
    else:
        season_rates = "Peak $0.356/kWh (4-9pm daily), part-peak $0.333/kWh (3-4pm, 9pm-12am), off-peak $0.319/kWh."

    avg_rate = s["total_cost"] / max(s["total_import_kwh"], 0.1)
    solar_self_consumed_value = s["solar_self_consumed_kwh"] * avg_rate

    ev_peak_cost = s["ev_peak_kwh"] * (0.796 if season == "Summer" else 0.356)
    ev_off_peak_cost = s["ev_off_peak_kwh"] * (0.561 if season == "Summer" else 0.319)

    depletion_note = "Battery lasted through peak."
    if s.get("battery_depletion_hour") and s["battery_depletion_hour"] < 21:
        hr = int(s["battery_depletion_hour"])
        depletion_note = f"Battery depleted at ~{hr % 12 or 12}pm, before peak ended at 9pm."

    prompt = DAILY_NARRATIVE_PROMPT.format(
        season=season,
        season_rates=season_rates,
        total_import_kwh=s["total_import_kwh"],
        total_cost=s["total_cost"],
        peak_import_kwh=s["peak_import_kwh"],
        peak_cost=s["peak_cost"],
        part_peak_import_kwh=s["part_peak_import_kwh"],
        part_peak_cost=s["part_peak_cost"],
        off_peak_import_kwh=s["off_peak_import_kwh"],
        off_peak_cost=s["off_peak_cost"],
        solar_generated_kwh=s["solar_generated_kwh"],
        solar_self_consumed_kwh=s["solar_self_consumed_kwh"],
        solar_self_consumed_value=solar_self_consumed_value,
        total_export_kwh=s["total_export_kwh"],
        export_credit=s["export_credit"],
        ev_kwh=s["ev_kwh"],
        ev_peak_kwh=s["ev_peak_kwh"],
        ev_peak_cost=ev_peak_cost,
        ev_off_peak_kwh=s["ev_off_peak_kwh"],
        ev_off_peak_cost=ev_off_peak_cost,
        battery_peak_coverage_pct=s["battery_peak_coverage_pct"] or 0,
        depletion_note=depletion_note,
    )

    try:
        client = anthropic.Anthropic()
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        return message.content[0].text
    except Exception:
        logger.exception("Claude API failed for daily narrative, using fallback")
        return _pick_context_narrative_fallback(s)


# --- Month-to-date ---


async def get_mtd(pool: asyncpg.Pool, target_day: date, account_id: UUID) -> dict:
    """Get month-to-date cost and comparison to prior month same day."""
    first_of_month = target_day.replace(day=1)

    mtd = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_cost), 0) as cost FROM daily_summaries WHERE account_id = $1 AND day >= $2 AND day <= $3",
        account_id, first_of_month, target_day,
    )

    # Prior month same period
    if first_of_month.month == 1:
        prior_first = first_of_month.replace(year=first_of_month.year - 1, month=12)
    else:
        prior_first = first_of_month.replace(month=first_of_month.month - 1)
    prior_day = min(target_day.day, 28)  # safe for all months
    prior_end = prior_first.replace(day=prior_day)

    prior_mtd = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_cost), 0) as cost FROM daily_summaries WHERE account_id = $1 AND day >= $2 AND day <= $3",
        account_id, prior_first, prior_end,
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


async def _run_daily_for_account(pool: asyncpg.Pool, yesterday: date, account_id: UUID) -> None:
    """Run daily aggregation for a single account."""
    summary = await aggregate_day(pool, yesterday, account_id=account_id)
    if not summary:
        logger.warning("No data to aggregate for %s (account=%s)", yesterday, account_id)
        return

    actions = await evaluate_actions(pool, yesterday, account_id=account_id)
    summary["actions"] = actions
    summary["context_narrative"] = await generate_daily_narrative(summary)

    await save_summary(pool, summary, account_id=account_id)

    # Build report data
    mtd = await get_mtd(pool, yesterday, account_id=account_id)
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

    # Daily report notifications disabled

    # Log the report
    await pool.execute(
        """
        INSERT INTO reports_log (report_type, covers_from, covers_to, subject, body_html, metadata, account_id)
        VALUES ('daily', $1, $1, $2, $3, $4, $5)
        """,
        yesterday,
        f"WattWise Daily — {yesterday.isoformat()}",
        "(logged)",
        json.dumps({"total_cost": summary["total_cost"]}),
        account_id,
    )

    logger.info("Daily report sent for %s (account=%s) — cost=$%.2f", yesterday, account_id, summary["total_cost"])


async def run_daily_aggregation(pool: asyncpg.Pool) -> None:
    """Full daily job: aggregate, evaluate, report for all accounts."""
    yesterday = date.today() - timedelta(days=1)
    logger.info("Running daily aggregation for %s", yesterday)

    accounts = await pool.fetch("SELECT id FROM accounts")
    if not accounts:
        logger.warning("No accounts found in DB — nothing to aggregate")
        return

    for acct in accounts:
        try:
            await _run_daily_for_account(pool, yesterday, acct["id"])
        except Exception:
            logger.exception("Error in daily aggregation for account %s", acct["id"])
