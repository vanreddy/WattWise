"""
Data sanity checks for SelfPower energy data pipeline.

Three layers of validation:
1. Interval-level: validate individual 5-min readings before insert
2. Daily aggregate: validate computed daily summaries
3. Flow conservation: validate Sankey/hourly energy balance

All checks LOG warnings (non-fatal) and return a list of issues found.
"""

import logging
import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

import asyncpg

logger = logging.getLogger(__name__)

# ─── Constants ───────────────────────────────────────────────────
MAX_RESIDENTIAL_W = 50_000       # 50 kW — max reasonable residential power
MAX_SOLAR_W = 25_000             # 25 kW — largest typical residential solar
MAX_BATTERY_W = 15_000           # 15 kW — Powerwall max discharge rate
ENERGY_BALANCE_TOLERANCE = 0.05  # 5% tolerance for energy conservation
INTERVAL_COUNT_MIN = 270         # Minimum intervals for a "complete" day
INTERVAL_COUNT_MAX = 290         # Maximum (allowing slight overlap at day boundary)
INTERVAL_COUNT_EXACT = 288       # Theoretical exact (24h × 12 per hour)
COST_PER_KWH_MIN = 0.05         # $0.05/kWh — floor for any TOU rate
COST_PER_KWH_MAX = 1.00         # $1.00/kWh — ceiling for any TOU rate
MAX_DAILY_SOLAR_KWH = 200       # 200 kWh — generous cap for residential
MAX_DAILY_COST = 200.0           # $200 — generous cap for daily grid cost
BATTERY_PCT_JUMP_THRESHOLD = 20  # % — max reasonable jump in one 5-min interval


# ═══════════════════════════════════════════════════════════════════
# Layer 1: Interval-level checks (before insert)
# ═══════════════════════════════════════════════════════════════════

def validate_interval(
    ts: datetime,
    solar_w: float,
    home_w: float,
    grid_w: float,
    battery_w: float,
    battery_pct: float,
    vehicle_w: float,
    prev_battery_pct: Optional[float] = None,
) -> List[str]:
    """
    Validate a single 5-minute interval reading.
    Returns list of issue descriptions (empty = all good).
    """
    issues: List[str] = []

    # 1. NaN / Inf checks
    for name, val in [("solar_w", solar_w), ("home_w", home_w), ("grid_w", grid_w),
                       ("battery_w", battery_w), ("battery_pct", battery_pct), ("vehicle_w", vehicle_w)]:
        if val is None or (isinstance(val, float) and (math.isnan(val) or math.isinf(val))):
            issues.append(f"{name} is {val} (NaN/Inf/None)")

    if issues:
        return issues  # Can't do further checks with bad values

    # 2. Solar never negative
    if solar_w < -10:  # Small tolerance for measurement noise
        issues.append(f"solar_w={solar_w:.0f}W is negative")

    # 3. Power range checks
    if abs(solar_w) > MAX_SOLAR_W:
        issues.append(f"solar_w={solar_w:.0f}W exceeds {MAX_SOLAR_W}W cap")
    if abs(home_w) > MAX_RESIDENTIAL_W:
        issues.append(f"home_w={home_w:.0f}W exceeds {MAX_RESIDENTIAL_W}W cap")
    if abs(grid_w) > MAX_RESIDENTIAL_W:
        issues.append(f"grid_w={grid_w:.0f}W exceeds {MAX_RESIDENTIAL_W}W cap")
    if abs(battery_w) > MAX_BATTERY_W:
        issues.append(f"battery_w={battery_w:.0f}W exceeds {MAX_BATTERY_W}W cap")

    # 4. Battery percentage bounded
    if battery_pct < 0 or battery_pct > 100:
        issues.append(f"battery_pct={battery_pct:.1f}% out of 0-100 range")

    # 5. Battery % jump check (if previous reading available)
    if prev_battery_pct is not None:
        jump = abs(battery_pct - prev_battery_pct)
        if jump > BATTERY_PCT_JUMP_THRESHOLD:
            issues.append(f"battery_pct jumped {jump:.1f}% in one interval ({prev_battery_pct:.1f}→{battery_pct:.1f})")

    # 6. Vehicle power non-negative
    if vehicle_w < -10:
        issues.append(f"vehicle_w={vehicle_w:.0f}W is negative")

    # 7. Energy conservation: solar + grid + battery ≈ home + vehicle
    sources = max(0, solar_w) + max(0, grid_w) + max(0, battery_w)
    sinks = max(0, home_w) + max(0, vehicle_w) + abs(min(0, grid_w)) + abs(min(0, battery_w))
    if sinks > 0:
        imbalance = abs(sources - sinks) / max(sources, sinks, 1)
        if imbalance > ENERGY_BALANCE_TOLERANCE:
            issues.append(
                f"energy imbalance={imbalance:.1%}: sources={sources:.0f}W sinks={sinks:.0f}W"
            )

    # 8. Timestamp alignment (should be on 5-minute boundary)
    if ts.minute % 5 != 0 or ts.second != 0:
        issues.append(f"timestamp {ts} not aligned to 5-minute boundary")

    return issues


# ═══════════════════════════════════════════════════════════════════
# Layer 2: Daily aggregate checks
# ═══════════════════════════════════════════════════════════════════

def validate_daily_summary(summary: Dict[str, Any], interval_count: int = 0) -> List[str]:
    """
    Validate a computed daily summary dictionary.
    Returns list of issue descriptions.
    """
    issues: List[str] = []

    # 1. Interval count check
    if interval_count > 0:
        if interval_count < INTERVAL_COUNT_MIN:
            issues.append(f"only {interval_count} intervals (expected {INTERVAL_COUNT_MIN}-{INTERVAL_COUNT_MAX})")
        elif interval_count > INTERVAL_COUNT_MAX:
            issues.append(f"{interval_count} intervals exceeds max {INTERVAL_COUNT_MAX} — possible duplicates")

    # 2. All energy values non-negative
    for key in ["total_import_kwh", "total_export_kwh", "solar_generated_kwh",
                 "solar_self_consumed_kwh", "ev_kwh"]:
        val = summary.get(key, 0)
        if val < 0:
            issues.append(f"{key}={val:.2f} kWh is negative")

    # 3. Solar self-consumed <= solar generated
    solar_gen = summary.get("solar_generated_kwh", 0)
    solar_self = summary.get("solar_self_consumed_kwh", 0)
    if solar_self > solar_gen + 0.1:  # Small tolerance
        issues.append(f"solar_self_consumed ({solar_self:.1f}) > solar_generated ({solar_gen:.1f})")

    # 4. Solar cap
    if solar_gen > MAX_DAILY_SOLAR_KWH:
        issues.append(f"solar_generated_kwh={solar_gen:.1f} exceeds {MAX_DAILY_SOLAR_KWH} cap")

    # 5. TOU import consistency: peak + part_peak + off_peak ≈ total_import
    peak = summary.get("peak_import_kwh", 0)
    part_peak = summary.get("part_peak_import_kwh", 0)
    off_peak = summary.get("off_peak_import_kwh", 0)
    total_import = summary.get("total_import_kwh", 0)
    tou_sum = peak + part_peak + off_peak
    if total_import > 0.1:
        diff = abs(tou_sum - total_import)
        if diff > 0.5:  # 0.5 kWh tolerance
            issues.append(
                f"TOU import mismatch: peak({peak:.1f})+part_peak({part_peak:.1f})+off_peak({off_peak:.1f})"
                f"={tou_sum:.1f} vs total_import={total_import:.1f} (diff={diff:.1f})"
            )

    # 6. Cost consistency: total_cost ≈ sum of period costs
    peak_cost = summary.get("peak_cost", 0)
    part_peak_cost = summary.get("part_peak_cost", 0)
    off_peak_cost = summary.get("off_peak_cost", 0)
    ev_cost = summary.get("ev_cost", 0)
    total_cost = summary.get("total_cost", 0)
    cost_sum = peak_cost + part_peak_cost + off_peak_cost + ev_cost
    if abs(cost_sum - total_cost) > 0.01:
        issues.append(
            f"cost mismatch: component sum={cost_sum:.2f} vs total_cost={total_cost:.2f}"
        )

    # 7. Cost bounds
    if total_cost > MAX_DAILY_COST:
        issues.append(f"total_cost=${total_cost:.2f} exceeds ${MAX_DAILY_COST} cap")
    if total_cost < 0:
        issues.append(f"total_cost=${total_cost:.2f} is negative (should use export_credit)")

    # 8. Cost per kWh sanity (if meaningful import)
    if total_import > 1.0 and total_cost > 0:
        effective_rate = total_cost / total_import
        if effective_rate < COST_PER_KWH_MIN or effective_rate > COST_PER_KWH_MAX:
            issues.append(f"effective rate ${effective_rate:.3f}/kWh outside bounds (${COST_PER_KWH_MIN}-${COST_PER_KWH_MAX})")

    # 9. Battery coverage percentage bounded
    batt_cov = summary.get("battery_peak_coverage_pct")
    if batt_cov is not None and (batt_cov < 0 or batt_cov > 100):
        issues.append(f"battery_peak_coverage_pct={batt_cov:.1f}% out of 0-100")

    # 10. Export credit non-negative
    export_credit = summary.get("export_credit", 0)
    if export_credit < 0:
        issues.append(f"export_credit=${export_credit:.2f} is negative")

    return issues


# ═══════════════════════════════════════════════════════════════════
# Layer 3: Flow conservation checks (Sankey / cross-chart)
# ═══════════════════════════════════════════════════════════════════

def validate_sankey_flows(flows: Dict[str, float]) -> List[str]:
    """
    Validate Sankey flow allocations.
    flows should contain keys like: solar_to_home, solar_to_battery, solar_to_grid,
    battery_to_home, grid_to_home, etc.
    Returns list of issue descriptions.
    """
    issues: List[str] = []

    # All flows non-negative
    for key, val in flows.items():
        if val < -0.01:
            issues.append(f"flow {key}={val:.2f} kWh is negative")

    # Source totals
    solar_out = flows.get("solar_to_home", 0) + flows.get("solar_to_battery", 0) + flows.get("solar_to_grid", 0)
    battery_out = flows.get("battery_to_home", 0) + flows.get("battery_to_grid", 0)
    grid_out = flows.get("grid_to_home", 0) + flows.get("grid_to_battery", 0)

    # Sink totals
    home_in = flows.get("solar_to_home", 0) + flows.get("battery_to_home", 0) + flows.get("grid_to_home", 0)
    battery_in = flows.get("solar_to_battery", 0) + flows.get("grid_to_battery", 0)
    grid_in = flows.get("solar_to_grid", 0) + flows.get("battery_to_grid", 0)

    total_sources = solar_out + battery_out + grid_out
    total_sinks = home_in + battery_in + grid_in

    # Conservation: total sources ≈ total sinks
    if total_sources > 0.1:
        imbalance = abs(total_sources - total_sinks) / total_sources
        if imbalance > ENERGY_BALANCE_TOLERANCE:
            issues.append(
                f"Sankey imbalance: sources={total_sources:.1f} kWh, sinks={total_sinks:.1f} kWh "
                f"({imbalance:.1%} off)"
            )

    return issues


def validate_cross_chart_consistency(
    sankey_totals: Dict[str, float],
    hourly_totals: Dict[str, float],
) -> List[str]:
    """
    Check that Sankey and hourly chart totals agree.
    Both dicts should have: solar_kwh, grid_import_kwh, grid_export_kwh, battery_charge_kwh, battery_discharge_kwh, home_kwh
    """
    issues: List[str] = []

    for key in ["solar_kwh", "grid_import_kwh", "grid_export_kwh", "home_kwh"]:
        s_val = sankey_totals.get(key, 0)
        h_val = hourly_totals.get(key, 0)
        if max(s_val, h_val) > 0.1:
            diff_pct = abs(s_val - h_val) / max(s_val, h_val)
            if diff_pct > 0.02:  # 2% tolerance
                issues.append(
                    f"cross-chart mismatch on {key}: sankey={s_val:.1f} hourly={h_val:.1f} ({diff_pct:.1%} off)"
                )

    return issues


# ═══════════════════════════════════════════════════════════════════
# Database-level checks (run periodically)
# ═══════════════════════════════════════════════════════════════════

async def check_duplicate_intervals(pool: asyncpg.Pool, account_id: UUID) -> List[str]:
    """Check for duplicate timestamps in tesla_intervals."""
    issues: List[str] = []

    dupes = await pool.fetch("""
        SELECT ts, COUNT(*) as cnt
        FROM tesla_intervals
        WHERE account_id = $1
        GROUP BY ts
        HAVING COUNT(*) > 1
        ORDER BY ts DESC
        LIMIT 10
    """, account_id)

    if dupes:
        issues.append(f"Found {len(dupes)} duplicate timestamps (showing up to 10)")
        for row in dupes:
            issues.append(f"  ts={row['ts']} count={row['cnt']}")

    return issues


async def check_interval_gaps(
    pool: asyncpg.Pool,
    account_id: UUID,
    day: date,
) -> List[str]:
    """Check for missing intervals (gaps > 10 minutes) on a given day."""
    issues: List[str] = []

    from datetime import timezone as tz
    # Use Pacific time for day boundaries
    try:
        import zoneinfo
        local_tz = zoneinfo.ZoneInfo("America/Los_Angeles")
    except Exception:
        local_tz = tz.utc

    start = datetime.combine(day, time(0, 0), tzinfo=local_tz)
    end = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=local_tz)

    rows = await pool.fetch("""
        SELECT ts FROM tesla_intervals
        WHERE account_id = $1 AND ts >= $2 AND ts < $3
        ORDER BY ts
    """, account_id, start, end)

    if not rows:
        issues.append(f"No intervals for {day}")
        return issues

    count = len(rows)
    if count < INTERVAL_COUNT_MIN:
        issues.append(f"Only {count} intervals for {day} (expected >= {INTERVAL_COUNT_MIN})")

    # Find gaps > 10 minutes
    prev_ts = rows[0]["ts"]
    gaps = []
    for row in rows[1:]:
        delta = (row["ts"] - prev_ts).total_seconds()
        if delta > 600:  # > 10 minutes
            gaps.append((prev_ts, row["ts"], int(delta / 60)))
        prev_ts = row["ts"]

    if gaps:
        issues.append(f"Found {len(gaps)} gaps > 10min on {day}")
        for gap_start, gap_end, minutes in gaps[:5]:  # Show first 5
            issues.append(f"  gap: {gap_start.strftime('%H:%M')} → {gap_end.strftime('%H:%M')} ({minutes}min)")

    return issues


async def run_daily_sanity_check(
    pool: asyncpg.Pool,
    account_id: UUID,
    day: date,
) -> Dict[str, Any]:
    """
    Run all sanity checks for a specific day and account.
    Returns a report dict with all findings.
    """
    report: Dict[str, Any] = {
        "account_id": str(account_id),
        "day": str(day),
        "issues": [],
        "status": "ok",
    }

    # 1. Check for duplicates
    dupe_issues = await check_duplicate_intervals(pool, account_id)
    report["issues"].extend(dupe_issues)

    # 2. Check for gaps
    gap_issues = await check_interval_gaps(pool, account_id, day)
    report["issues"].extend(gap_issues)

    # 3. Check daily summary if it exists
    summary_row = await pool.fetchrow(
        "SELECT * FROM daily_summaries WHERE account_id = $1 AND day = $2",
        account_id, day,
    )
    if summary_row:
        summary_dict = dict(summary_row)
        # Count intervals for that day
        try:
            import zoneinfo
            local_tz = zoneinfo.ZoneInfo("America/Los_Angeles")
        except Exception:
            local_tz = timezone.utc

        start = datetime.combine(day, time(0, 0), tzinfo=local_tz)
        end = datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=local_tz)
        interval_count = await pool.fetchval(
            "SELECT COUNT(*) FROM tesla_intervals WHERE account_id = $1 AND ts >= $2 AND ts < $3",
            account_id, start, end,
        )
        summary_issues = validate_daily_summary(summary_dict, interval_count)
        report["issues"].extend(summary_issues)

    if report["issues"]:
        report["status"] = "warnings"
        logger.warning(
            "Sanity check %s/%s: %d issues found:\n  %s",
            account_id, day, len(report["issues"]),
            "\n  ".join(report["issues"]),
        )
    else:
        logger.info("Sanity check %s/%s: all clean", account_id, day)

    return report
