"""
WattWise REST API endpoints.

GET /summary  — real-time power flows + today's running totals
GET /daily    — daily summaries for a date range
GET /hourly   — hourly aggregates for a single day
GET /alerts   — alert history
GET /reports  — report history
"""

import json
import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from zoneinfo import ZoneInfo
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request

from backend.auth import get_current_user

logger = logging.getLogger(__name__)

LOCAL_TZ = ZoneInfo("America/Los_Angeles")

from backend.rates import get_import_rate, get_tou_period, get_export_rate
from backend.aggregator import aggregate_day

router = APIRouter()

INTERVAL_HOURS = 5 / 60  # 5-minute interval


@router.get("/summary")
async def summary(request: Request, user: dict = Depends(get_current_user)):
    """Real-time snapshot: latest readings + today's running totals."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    # Latest interval
    latest = await pool.fetchrow(
        "SELECT * FROM tesla_intervals WHERE account_id = $1 ORDER BY ts DESC LIMIT 1",
        account_id,
    )

    # Today's running totals (Pacific time)
    today_start = datetime.combine(
        datetime.now(LOCAL_TZ).date(), time.min, tzinfo=LOCAL_TZ
    )
    today_rows = await pool.fetch(
        """
        SELECT ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w
        FROM tesla_intervals WHERE account_id = $1 AND ts >= $2 ORDER BY ts
        """,
        account_id, today_start,
    )

    total_import_kwh = 0.0
    total_export_kwh = 0.0
    solar_generated_kwh = 0.0
    peak_cost = 0.0
    part_peak_cost = 0.0
    off_peak_cost = 0.0

    for row in today_rows:
        ts_local = row["ts"].astimezone()
        solar_generated_kwh += max(row["solar_w"], 0) * INTERVAL_HOURS / 1000
        grid_w = row["grid_w"]
        if grid_w > 0:
            kwh = grid_w * INTERVAL_HOURS / 1000
            total_import_kwh += kwh
            rate = get_import_rate(ts_local)
            cost = kwh * rate
            period = get_tou_period(ts_local)
            if period == "peak":
                peak_cost += cost
            elif period == "part_peak":
                part_peak_cost += cost
            else:
                off_peak_cost += cost
        else:
            total_export_kwh += abs(grid_w) * INTERVAL_HOURS / 1000

    total_cost = peak_cost + part_peak_cost + off_peak_cost

    home_w = latest["home_w"] if latest else 0
    vehicle_w = latest["vehicle_w"] if latest else 0

    return {
        "current": {
            "ts": latest["ts"].isoformat() if latest else None,
            "solar_w": latest["solar_w"] if latest else 0,
            "home_w": home_w,
            "grid_w": latest["grid_w"] if latest else 0,
            "battery_w": latest["battery_w"] if latest else 0,
            "battery_pct": latest["battery_pct"] if latest else 0,
            "vehicle_w": vehicle_w,
        },
        "today": {
            "solar_generated_kwh": round(solar_generated_kwh, 2),
            "total_import_kwh": round(total_import_kwh, 2),
            "total_export_kwh": round(total_export_kwh, 2),
            "total_cost": round(total_cost, 2),
            "peak_cost": round(peak_cost, 2),
            "part_peak_cost": round(part_peak_cost, 2),
            "off_peak_cost": round(off_peak_cost, 2),
            "export_credit": round(total_export_kwh * get_export_rate(), 2),
        },
    }


@router.get("/daily")
async def daily(
    request: Request,
    start: date = Query(default=None, alias="from"),
    end: date = Query(default=None, alias="to"),
    user: dict = Depends(get_current_user),
):
    """Daily summaries for a date range. Default: last 30 days.

    If the range includes today, a live-computed summary for today
    is appended (since the nightly aggregator hasn't run yet).
    """
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    today_local = datetime.now(LOCAL_TZ).date()

    if not end:
        end = today_local
    if not start:
        start = end - timedelta(days=29)

    rows = await pool.fetch(
        """
        SELECT day, total_import_kwh, total_export_kwh, solar_generated_kwh,
               solar_self_consumed_kwh, peak_import_kwh, part_peak_import_kwh,
               off_peak_import_kwh, peak_cost, part_peak_cost, off_peak_cost,
               total_cost, export_credit, ev_kwh, ev_peak_kwh, ev_off_peak_kwh,
               ev_cost, battery_peak_coverage_pct, battery_depletion_hour,
               context_narrative, actions_json
        FROM daily_summaries
        WHERE account_id = $1 AND day >= $2 AND day <= $3
        ORDER BY day DESC
        """,
        account_id, start, end,
    )

    results = [
        {
            **{k: (v.isoformat() if isinstance(v, date) else v) for k, v in dict(row).items() if k != "actions_json"},
            "actions": json.loads(row["actions_json"]) if row["actions_json"] else [],
        }
        for row in rows
    ]

    # If today is in the requested range and not already in daily_summaries,
    # compute it live from tesla_intervals
    if start <= today_local <= end:
        already_has_today = any(r["day"] == today_local.isoformat() for r in results)
        if not already_has_today:
            live_summary = await aggregate_day(pool, today_local, account_id=account_id)
            if live_summary:
                results.insert(0, {
                    "day": today_local.isoformat(),
                    "total_import_kwh": round(live_summary.get("total_import_kwh", 0), 2),
                    "total_export_kwh": round(live_summary.get("total_export_kwh", 0), 2),
                    "solar_generated_kwh": round(live_summary.get("solar_generated_kwh", 0), 2),
                    "solar_self_consumed_kwh": round(live_summary.get("solar_self_consumed_kwh", 0), 2),
                    "peak_import_kwh": round(live_summary.get("peak_import_kwh", 0), 2),
                    "part_peak_import_kwh": round(live_summary.get("part_peak_import_kwh", 0), 2),
                    "off_peak_import_kwh": round(live_summary.get("off_peak_import_kwh", 0), 2),
                    "peak_cost": round(live_summary.get("peak_cost", 0), 2),
                    "part_peak_cost": round(live_summary.get("part_peak_cost", 0), 2),
                    "off_peak_cost": round(live_summary.get("off_peak_cost", 0), 2),
                    "total_cost": round(live_summary.get("total_cost", 0), 2),
                    "export_credit": round(live_summary.get("export_credit", 0), 2),
                    "ev_kwh": round(live_summary.get("ev_kwh", 0), 2),
                    "ev_peak_kwh": round(live_summary.get("ev_peak_kwh", 0), 2),
                    "ev_off_peak_kwh": round(live_summary.get("ev_off_peak_kwh", 0), 2),
                    "ev_cost": round(live_summary.get("ev_cost", 0), 2),
                    "battery_peak_coverage_pct": round(live_summary.get("battery_peak_coverage_pct", 0), 1),
                    "battery_depletion_hour": live_summary.get("battery_depletion_hour"),
                    "context_narrative": None,
                    "actions": [],
                })

    return results


@router.get("/hourly")
async def hourly(
    request: Request,
    day: date = Query(alias="date", default=None),
    user: dict = Depends(get_current_user),
):
    """Hourly aggregates from tesla_intervals for a single day."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    if not day:
        day = datetime.now(LOCAL_TZ).date()

    start = datetime.combine(day, time.min, tzinfo=LOCAL_TZ)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=LOCAL_TZ)

    rows = await pool.fetch(
        """
        SELECT
            date_trunc('hour', ts AT TIME ZONE 'America/Los_Angeles') AS hour,
            AVG(solar_w) AS solar_w_avg,
            AVG(home_w) AS home_w_avg,
            AVG(grid_w) AS grid_w_avg,
            AVG(battery_w) AS battery_w_avg,
            AVG(battery_pct) AS battery_pct_avg,
            AVG(vehicle_w) AS vehicle_w_avg,
            SUM(GREATEST(solar_w, 0) * $4 / 1000) AS solar_kwh,
            SUM(GREATEST(grid_w, 0) * $4 / 1000) AS grid_import_kwh,
            SUM(GREATEST(-grid_w, 0) * $4 / 1000) AS grid_export_kwh,
            SUM(GREATEST(battery_w, 0) * $4 / 1000) AS battery_discharge_kwh,
            SUM(GREATEST(-battery_w, 0) * $4 / 1000) AS battery_charge_kwh,
            SUM(GREATEST(home_w, 0) * $4 / 1000) AS home_kwh
        FROM tesla_intervals
        WHERE account_id = $1 AND ts >= $2 AND ts < $3
        GROUP BY hour
        ORDER BY hour
        """,
        account_id, start, end, INTERVAL_HOURS,
    )

    results = []
    for row in rows:
        home_w = round(row["home_w_avg"] or 0, 0)
        vehicle_w = round(row["vehicle_w_avg"] or 0, 0)
        results.append({
            "hour": row["hour"].isoformat(),
            "solar_w_avg": round(row["solar_w_avg"] or 0, 0),
            "home_w_avg": home_w,
            "grid_w_avg": round(row["grid_w_avg"] or 0, 0),
            "battery_w_avg": round(row["battery_w_avg"] or 0, 0),
            "battery_pct_avg": round(row["battery_pct_avg"] or 0, 1),
            "vehicle_w_avg": vehicle_w,
            # Per-interval energy (no sign cancellation)
            "solar_kwh": round(row["solar_kwh"] or 0, 3),
            "grid_import_kwh": round(row["grid_import_kwh"] or 0, 3),
            "grid_export_kwh": round(row["grid_export_kwh"] or 0, 3),
            "battery_discharge_kwh": round(row["battery_discharge_kwh"] or 0, 3),
            "battery_charge_kwh": round(row["battery_charge_kwh"] or 0, 3),
            "home_kwh": round(row["home_kwh"] or 0, 3),
        })
    return results


@router.get("/intervals")
async def intervals(
    request: Request,
    day: date = Query(alias="date", default=None),
    user: dict = Depends(get_current_user),
):
    """Raw 5-min interval data for a single day (no aggregation)."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    if not day:
        day = datetime.now(LOCAL_TZ).date()

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

    return [
        {
            "ts": row["ts"].astimezone(LOCAL_TZ).isoformat(),
            "solar_w": round(row["solar_w"] or 0, 0),
            "home_w": round(row["home_w"] or 0, 0),
            "grid_w": round(row["grid_w"] or 0, 0),
            "battery_w": round(row["battery_w"] or 0, 0),
            "battery_pct": round(row["battery_pct"] or 0, 1),
            "vehicle_w": round(row["vehicle_w"] or 0, 0),
        }
        for row in rows
    ]



@router.get("/sankey")
async def sankey(
    request: Request,
    date_param: Optional[str] = Query(default=None, alias="date"),
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date: Optional[str] = Query(default=None, alias="to"),
    user: dict = Depends(get_current_user),
):
    """Sankey flow allocations from polled interval data (single source of truth)."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])
    today = datetime.now(LOCAL_TZ).date()

    if date_param:
        start_day = date.fromisoformat(date_param)
        end_day = start_day
    elif from_date and to_date:
        start_day = date.fromisoformat(from_date)
        end_day = date.fromisoformat(to_date)
    else:
        start_day = today
        end_day = today

    # All charts use the same data source: tesla_intervals table
    flows = await _sankey_from_polled(pool, start_day, end_day + timedelta(days=1), account_id)

    return {
        "flows": {k: round(v, 2) for k, v in flows.items()},
        "from": str(start_day),
        "to": str(end_day),
    }


async def _sankey_from_polled(pool, start_day: date, end_day: date, account_id: Optional[UUID] = None) -> dict:
    """Fallback: compute Sankey flows from polled tesla_intervals data."""
    start = datetime.combine(start_day, time.min, tzinfo=LOCAL_TZ)
    end = datetime.combine(end_day, time.min, tzinfo=LOCAL_TZ)

    if account_id:
        rows = await pool.fetch(
            """
            SELECT solar_w, home_w, grid_w, battery_w, vehicle_w
            FROM tesla_intervals
            WHERE account_id = $1 AND ts >= $2 AND ts < $3
            ORDER BY ts
            """,
            account_id, start, end,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT solar_w, home_w, grid_w, battery_w, vehicle_w
            FROM tesla_intervals
            WHERE ts >= $1 AND ts < $2
            ORDER BY ts
            """,
            start, end,
        )

    flows = {
        "solar_to_home": 0.0,
        "solar_to_battery": 0.0,
        "solar_to_grid": 0.0,
        "battery_to_home": 0.0,
        "battery_to_grid": 0.0,
        "grid_to_home": 0.0,
        "grid_to_battery": 0.0,
    }

    for row in rows:
        solar = max(0, row["solar_w"]) * INTERVAL_HOURS / 1000
        grid_import = max(0, row["grid_w"]) * INTERVAL_HOURS / 1000
        grid_export = max(0, -row["grid_w"]) * INTERVAL_HOURS / 1000
        bat_discharge = max(0, row["battery_w"]) * INTERVAL_HOURS / 1000
        bat_charge = max(0, -row["battery_w"]) * INTERVAL_HOURS / 1000
        home = max(0, row["home_w"]) * INTERVAL_HOURS / 1000

        solar_to_home = min(solar, home)
        flows["solar_to_home"] += solar_to_home

        solar_left = solar - solar_to_home
        solar_to_bat = min(bat_charge, solar_left)
        flows["solar_to_battery"] += solar_to_bat
        solar_left -= solar_to_bat
        solar_to_exp = min(grid_export, solar_left)
        flows["solar_to_grid"] += solar_to_exp

        remain_home = max(0, home - solar_to_home)
        bat_to_home = min(bat_discharge, remain_home)
        flows["battery_to_home"] += bat_to_home
        bat_left = bat_discharge - bat_to_home
        remain_exp = max(0, grid_export - solar_to_exp)
        flows["battery_to_grid"] += min(bat_left, remain_exp)

        remain_home2 = max(0, remain_home - bat_to_home)
        flows["grid_to_home"] += remain_home2
        grid_left = grid_import - remain_home2
        remain_bat_chg = max(0, bat_charge - solar_to_bat)
        flows["grid_to_battery"] += min(grid_left, remain_bat_chg)

    # Sanity check flow conservation
    from backend.data_sanity_checks import validate_sankey_flows
    flow_issues = validate_sankey_flows(flows)
    if flow_issues:
        logger.warning("Sankey flow issues for %s (%s to %s):\n  %s",
                        account_id, start_day, end_day, "\n  ".join(flow_issues))

    return flows


@router.get("/alerts")
async def alerts(
    request: Request,
    limit: int = Query(default=50, le=200),
    alert_type: Optional[str] = Query(default=None, alias="type"),
    user: dict = Depends(get_current_user),
):
    """Alert history, newest first."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    if alert_type:
        rows = await pool.fetch(
            """
            SELECT id, fired_at, alert_type, message, metadata
            FROM alerts_log
            WHERE account_id = $1 AND alert_type = $2
            ORDER BY fired_at DESC LIMIT $3
            """,
            account_id, alert_type, limit,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, fired_at, alert_type, message, metadata
            FROM alerts_log
            WHERE account_id = $1
            ORDER BY fired_at DESC LIMIT $2
            """,
            account_id, limit,
        )

    return [
        {
            "id": row["id"],
            "fired_at": row["fired_at"].isoformat(),
            "alert_type": row["alert_type"],
            "message": row["message"],
            "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        }
        for row in rows
    ]


@router.get("/reports")
async def reports(
    request: Request,
    report_type: Optional[str] = Query(default=None, alias="type"),
    limit: int = Query(default=10, le=50),
    user: dict = Depends(get_current_user),
):
    """Report history."""
    pool = request.app.state.pool
    account_id = UUID(user["account_id"])

    if report_type:
        rows = await pool.fetch(
            """
            SELECT id, sent_at, report_type, covers_from, covers_to, subject, metadata
            FROM reports_log
            WHERE account_id = $1 AND report_type = $2
            ORDER BY sent_at DESC LIMIT $3
            """,
            account_id, report_type, limit,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, sent_at, report_type, covers_from, covers_to, subject, metadata
            FROM reports_log
            WHERE account_id = $1
            ORDER BY sent_at DESC LIMIT $2
            """,
            account_id, limit,
        )

    return [
        {
            "id": row["id"],
            "sent_at": row["sent_at"].isoformat(),
            "report_type": row["report_type"],
            "covers_from": row["covers_from"].isoformat(),
            "covers_to": row["covers_to"].isoformat(),
            "subject": row["subject"],
            "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        }
        for row in rows
    ]
