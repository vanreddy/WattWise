from __future__ import annotations

"""
Weekly summary job — runs Sunday 5:50pm, covers Mon–Sun.

1. Aggregates 7 days of daily_summaries
2. Runs weekly action rules (higher confidence threshold)
3. Calls Claude Sonnet API for narrative
4. Sends weekly report
"""

import json
import logging
from datetime import date, timedelta

import anthropic
import asyncpg

from backend.notifier import send_weekly_report
from backend.rates import get_export_rate, is_summer

logger = logging.getLogger(__name__)

# Weekly action rules require higher confidence
WEEKLY_ACTION_MIN_DAYS = 5  # 5 of 7 days
WEEKLY_ACTION_MIN_MONTHLY_SAVING = 8  # $8/month


CLAUDE_PROMPT_TEMPLATE = """\
You are an energy advisor for a homeowner in Alamo, CA with solar panels, a Tesla Powerwall, an EV, and a pool pump. Generate a 2-3 sentence plain English summary of their energy week. Be specific about dollar amounts. Do not mention specific devices you have no data on (pool pump, AC). You CAN be specific about EV charging and Powerwall behavior.

Rate context: Winter peak $0.356/kWh (4-9pm daily), off-peak $0.319/kWh. Summer peak $0.796/kWh (5-8pm weekdays), off-peak $0.561/kWh. Export earns ~$0.068/kWh. Current season: {season}.

This week's data:
- Total grid import: {total_import_kwh:.1f} kWh, cost ${total_cost:.2f}
- Peak hour import: {peak_kwh:.1f} kWh, cost ${peak_cost:.2f}
- Off-peak import: {off_peak_kwh:.1f} kWh, cost ${off_peak_cost:.2f}
- Solar generated: {solar_generated_kwh:.1f} kWh
- Solar self-consumed: {solar_self_consumed_kwh:.1f} kWh (avoided ${solar_self_consumed_value:.2f} in imports)
- Solar exported: {solar_exported_kwh:.1f} kWh (earned ${export_credit:.2f} in credits)
- EV charging: {ev_kwh:.1f} kWh total. Peak hours: {ev_peak_kwh:.1f} kWh (${ev_peak_cost:.2f}). Off-peak: {ev_off_peak_kwh:.1f} kWh (${ev_off_peak_cost:.2f}). Solar hours: {ev_solar_kwh:.1f} kWh ($0).
- Powerwall: covered {battery_coverage:.0f}% of peak window hours. Average depletion time: {avg_depletion_time}.
- Prior week grid cost: ${prior_week_cost:.2f}. This week: ${total_cost:.2f}. Change: {wow_pct:+.1f}%.

Focus on the single most actionable pattern and estimate its monthly dollar impact."""


async def get_weekly_data(pool: asyncpg.Pool, week_end: date, account_id) -> dict | None:
    """Fetch and aggregate 7 days of daily summaries (Mon through Sun) for an account."""
    week_start = week_end - timedelta(days=6)

    rows = await pool.fetch(
        """
        SELECT * FROM daily_summaries
        WHERE account_id = $1 AND day >= $2 AND day <= $3
        ORDER BY day
        """,
        account_id, week_start, week_end,
    )

    if not rows:
        logger.warning("No daily summaries for week %s to %s", week_start, week_end)
        return None

    # Aggregate
    data = {
        "week_start": week_start,
        "week_end": week_end,
        "total_import_kwh": sum(r["total_import_kwh"] for r in rows),
        "total_export_kwh": sum(r["total_export_kwh"] for r in rows),
        "solar_generated_kwh": sum(r["solar_generated_kwh"] for r in rows),
        "solar_self_consumed_kwh": sum(r["solar_self_consumed_kwh"] for r in rows),
        "peak_import_kwh": sum(r["peak_import_kwh"] for r in rows),
        "part_peak_import_kwh": sum(r["part_peak_import_kwh"] for r in rows),
        "off_peak_import_kwh": sum(r["off_peak_import_kwh"] for r in rows),
        "peak_cost": sum(r["peak_cost"] for r in rows),
        "part_peak_cost": sum(r["part_peak_cost"] for r in rows),
        "off_peak_cost": sum(r["off_peak_cost"] for r in rows),
        "total_cost": sum(r["total_cost"] for r in rows),
        "export_credit": sum(r["export_credit"] for r in rows),
        "ev_kwh": sum(r["ev_kwh"] for r in rows),
        "ev_peak_kwh": sum(r["ev_peak_kwh"] for r in rows),
        "ev_off_peak_kwh": sum(r["ev_off_peak_kwh"] for r in rows),
        "ev_cost": sum(r["ev_cost"] for r in rows),
        "days": rows,
    }

    # Powerwall coverage — average across days that had peak windows
    coverage_days = [r for r in rows if r["battery_peak_coverage_pct"] is not None]
    data["battery_coverage"] = (
        sum(r["battery_peak_coverage_pct"] for r in coverage_days) / len(coverage_days)
        if coverage_days else 0
    )

    # Average depletion time
    depletion_days = [r for r in rows if r["battery_depletion_hour"] is not None]
    if depletion_days:
        avg_dep = sum(r["battery_depletion_hour"] for r in depletion_days) / len(depletion_days)
        hr = int(avg_dep)
        mn = int((avg_dep - hr) * 60)
        data["avg_depletion_time"] = f"{hr % 12 or 12}:{mn:02d}pm"
        data["avg_depletion_hour"] = avg_dep
    else:
        data["avg_depletion_time"] = "N/A (battery lasted through peak)"
        data["avg_depletion_hour"] = None

    return data


async def get_prior_week_cost(pool: asyncpg.Pool, week_start: date, account_id) -> float:
    """Get total cost for the week before this one for an account."""
    prior_start = week_start - timedelta(days=7)
    prior_end = week_start - timedelta(days=1)
    row = await pool.fetchrow(
        "SELECT COALESCE(SUM(total_cost), 0) as cost FROM daily_summaries WHERE account_id = $1 AND day >= $2 AND day <= $3",
        account_id, prior_start, prior_end,
    )
    return float(row["cost"])


async def evaluate_weekly_actions(pool: asyncpg.Pool, data: dict) -> list[str]:
    """Weekly action rules — same as daily but with higher thresholds."""
    rows = data["days"]
    if len(rows) < 5:
        return []

    actions = []

    # Rule 1: EV charging during peak
    ev_peak_days = sum(1 for r in rows if r["ev_peak_kwh"] > 0.5)
    if ev_peak_days >= WEEKLY_ACTION_MIN_DAYS:
        weekly_ev_peak_cost = sum(r["ev_peak_kwh"] for r in rows) * 0.356
        monthly_saving = weekly_ev_peak_cost * 4
        if monthly_saving >= WEEKLY_ACTION_MIN_MONTHLY_SAVING:
            actions.append(
                f"Shift EV charging to solar hours — your EV charged during peak "
                f"on {ev_peak_days} of 7 days this week, costing ~${weekly_ev_peak_cost:.0f} "
                f"extra. That's ~${monthly_saving:.0f}/month in avoidable peak charges."
            )

    # Rule 2: Powerwall depleting before peak closes
    depletion_days = sum(1 for r in rows if r["battery_depletion_hour"] is not None)
    if depletion_days >= WEEKLY_ACTION_MIN_DAYS:
        actions.append(
            f"Your battery ran out before peak ended on {depletion_days} of 7 days. "
            f"Average depletion at {data['avg_depletion_time']}. "
            f"Consider raising your Powerwall reserve to stretch through 9pm."
        )

    # Rule 3: High peak import pattern
    high_peak_days = sum(1 for r in rows if r["peak_cost"] > r["total_cost"] * 0.4)
    if high_peak_days >= WEEKLY_ACTION_MIN_DAYS:
        weekly_peak_cost = sum(r["peak_cost"] for r in rows)
        actions.append(
            f"Peak hours dominated your bill on {high_peak_days} of 7 days — "
            f"${weekly_peak_cost:.2f} in peak charges this week alone."
        )

    return actions


async def generate_ai_narrative(data: dict, prior_week_cost: float) -> str:
    """Call Claude Sonnet to generate the weekly context narrative."""
    season = "Summer" if is_summer(data["week_start"]) else "Winter"

    # Estimate solar self-consumed value (avoided import at avg rate)
    avg_rate = data["total_cost"] / max(data["total_import_kwh"], 1)
    solar_self_consumed_value = data["solar_self_consumed_kwh"] * avg_rate

    # EV solar hours estimate (EV charged during non-grid hours)
    ev_solar_kwh = max(data["ev_kwh"] - data["ev_peak_kwh"] - data["ev_off_peak_kwh"], 0)

    # EV cost breakdown
    ev_peak_cost = data["ev_peak_kwh"] * (0.796 if season == "Summer" else 0.356)
    ev_off_peak_cost = data["ev_off_peak_kwh"] * (0.561 if season == "Summer" else 0.319)

    wow_pct = 0.0
    if prior_week_cost > 0:
        wow_pct = (data["total_cost"] - prior_week_cost) / prior_week_cost * 100

    prompt = CLAUDE_PROMPT_TEMPLATE.format(
        season=season,
        total_import_kwh=data["total_import_kwh"],
        total_cost=data["total_cost"],
        peak_kwh=data["peak_import_kwh"],
        peak_cost=data["peak_cost"],
        off_peak_kwh=data["off_peak_import_kwh"] + data["part_peak_import_kwh"],
        off_peak_cost=data["off_peak_cost"] + data["part_peak_cost"],
        solar_generated_kwh=data["solar_generated_kwh"],
        solar_self_consumed_kwh=data["solar_self_consumed_kwh"],
        solar_self_consumed_value=solar_self_consumed_value,
        solar_exported_kwh=data["total_export_kwh"],
        export_credit=data["export_credit"],
        ev_kwh=data["ev_kwh"],
        ev_peak_kwh=data["ev_peak_kwh"],
        ev_peak_cost=ev_peak_cost,
        ev_off_peak_kwh=data["ev_off_peak_kwh"],
        ev_off_peak_cost=ev_off_peak_cost,
        ev_solar_kwh=ev_solar_kwh,
        battery_coverage=data["battery_coverage"],
        avg_depletion_time=data["avg_depletion_time"],
        prior_week_cost=prior_week_cost,
        wow_pct=wow_pct,
    )

    client = anthropic.Anthropic()
    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}],
    )

    return message.content[0].text


async def _run_weekly_for_account(pool: asyncpg.Pool, account_id, week_start: date, week_end: date) -> None:
    """Run weekly summary for a single account."""
    data = await get_weekly_data(pool, week_end, account_id)
    if not data:
        logger.warning("No data for weekly report (account %s)", account_id)
        return

    prior_week_cost = await get_prior_week_cost(pool, week_start, account_id)
    actions = await evaluate_weekly_actions(pool, data)

    # Generate AI narrative
    try:
        ai_narrative = await generate_ai_narrative(data, prior_week_cost)
    except Exception:
        logger.exception("Claude API call failed for account %s, using fallback", account_id)
        ai_narrative = (
            f"This week you imported {data['total_import_kwh']:.0f} kWh "
            f"from the grid at a cost of ${data['total_cost']:.2f}. "
            f"Solar generated {data['solar_generated_kwh']:.0f} kWh."
        )

    # Week-over-week label
    if prior_week_cost > 0:
        pct = (data["total_cost"] - prior_week_cost) / prior_week_cost * 100
        wow_change = f"({'↑' if pct > 0 else '↓'}{abs(pct):.0f}% vs prior week)"
    else:
        wow_change = ""

    week_label = f"{week_start.strftime('%b %d')} – {week_end.strftime('%b %d')}"

    report_data = {
        "week_label": week_label,
        "actions": actions if actions else None,
        "ai_narrative": ai_narrative,
        "total_import_kwh": data["total_import_kwh"],
        "total_cost": data["total_cost"],
        "peak_kwh": data["peak_import_kwh"],
        "peak_cost": data["peak_cost"],
        "off_peak_kwh": data["off_peak_import_kwh"] + data["part_peak_import_kwh"],
        "off_peak_cost": data["off_peak_cost"] + data["part_peak_cost"],
        "ev_kwh": data["ev_kwh"],
        "ev_cost": data["ev_cost"],
        "battery_coverage": data["battery_coverage"],
        "solar_generated_kwh": data["solar_generated_kwh"],
        "solar_self_consumed_kwh": data["solar_self_consumed_kwh"],
        "solar_exported_kwh": data["total_export_kwh"],
        "wow_change": wow_change,
    }

    await send_weekly_report(report_data, pool=pool, account_id=account_id)

    # Log the report
    await pool.execute(
        """
        INSERT INTO reports_log (report_type, covers_from, covers_to, subject, body_html, metadata, account_id)
        VALUES ('weekly', $1, $2, $3, $4, $5, $6)
        """,
        week_start,
        week_end,
        f"SelfPower Weekly — {week_label}",
        "(logged)",
        json.dumps({"total_cost": data["total_cost"], "ai_narrative": ai_narrative}),
        account_id,
    )

    logger.info("Weekly report sent for account %s — %s — cost=$%.2f", account_id, week_label, data["total_cost"])


async def run_weekly_summary(pool: asyncpg.Pool) -> None:
    """Full weekly job: iterate all accounts, aggregate, rules, AI narrative, report."""
    today = date.today()
    week_end = today
    week_start = today - timedelta(days=6)

    logger.info("Running weekly summary for %s to %s", week_start, week_end)

    accounts = await pool.fetch("SELECT id FROM accounts")
    if not accounts:
        logger.warning("No accounts found — skipping weekly summary")
        return

    for acct in accounts:
        try:
            await _run_weekly_for_account(pool, acct["id"], week_start, week_end)
        except Exception:
            logger.exception("Error in weekly summary for account %s", acct["id"])
