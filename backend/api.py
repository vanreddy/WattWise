"""
WattWise REST API endpoints.

GET /summary  — real-time power flows + today's running totals
GET /daily    — daily summaries for a date range
GET /hourly   — hourly aggregates for a single day
GET /alerts   — alert history
GET /reports  — report history
"""

import json
from datetime import date, datetime, time, timedelta, timezone

from zoneinfo import ZoneInfo
from fastapi import APIRouter, Query, Request

LOCAL_TZ = ZoneInfo("America/Los_Angeles")

from backend.rates import get_import_rate, get_tou_period, get_export_rate

router = APIRouter()

INTERVAL_HOURS = 5 / 60  # 5-minute interval


@router.get("/summary")
async def summary(request: Request):
    """Real-time snapshot: latest readings + today's running totals."""
    pool = request.app.state.pool

    # Latest interval
    latest = await pool.fetchrow(
        "SELECT * FROM tesla_intervals ORDER BY ts DESC LIMIT 1"
    )

    # Today's running totals (Pacific time)
    today_start = datetime.combine(
        datetime.now(LOCAL_TZ).date(), time.min, tzinfo=LOCAL_TZ
    )
    today_rows = await pool.fetch(
        """
        SELECT ts, solar_w, home_w, grid_w, battery_w, battery_pct, vehicle_w
        FROM tesla_intervals WHERE ts >= $1 ORDER BY ts
        """,
        today_start,
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

    return {
        "current": {
            "ts": latest["ts"].isoformat() if latest else None,
            "solar_w": latest["solar_w"] if latest else 0,
            "home_w": latest["home_w"] if latest else 0,
            "grid_w": latest["grid_w"] if latest else 0,
            "battery_w": latest["battery_w"] if latest else 0,
            "battery_pct": latest["battery_pct"] if latest else 0,
            "vehicle_w": latest["vehicle_w"] if latest else 0,
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
):
    """Daily summaries for a date range. Default: last 30 days."""
    pool = request.app.state.pool
    if not end:
        end = date.today() - timedelta(days=1)
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
        WHERE day >= $1 AND day <= $2
        ORDER BY day DESC
        """,
        start, end,
    )

    return [
        {
            **{k: (v.isoformat() if isinstance(v, date) else v) for k, v in dict(row).items() if k != "actions_json"},
            "actions": json.loads(row["actions_json"]) if row["actions_json"] else [],
        }
        for row in rows
    ]


@router.get("/hourly")
async def hourly(
    request: Request,
    day: date = Query(alias="date", default=None),
):
    """Hourly aggregates from tesla_intervals for a single day."""
    pool = request.app.state.pool
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
            SUM(CASE WHEN grid_w > 0 THEN grid_w * $3 / 1000 ELSE 0 END) AS grid_import_kwh,
            SUM(CASE WHEN grid_w < 0 THEN ABS(grid_w) * $3 / 1000 ELSE 0 END) AS grid_export_kwh,
            SUM(GREATEST(solar_w, 0) * $3 / 1000) AS solar_kwh
        FROM tesla_intervals
        WHERE ts >= $1 AND ts < $2
        GROUP BY hour
        ORDER BY hour
        """,
        start, end, INTERVAL_HOURS,
    )

    return [
        {
            "hour": row["hour"].isoformat(),
            "solar_w_avg": round(row["solar_w_avg"] or 0, 0),
            "home_w_avg": round(row["home_w_avg"] or 0, 0),
            "grid_w_avg": round(row["grid_w_avg"] or 0, 0),
            "battery_w_avg": round(row["battery_w_avg"] or 0, 0),
            "battery_pct_avg": round(row["battery_pct_avg"] or 0, 1),
            "vehicle_w_avg": round(row["vehicle_w_avg"] or 0, 0),
            "grid_import_kwh": round(row["grid_import_kwh"] or 0, 2),
            "grid_export_kwh": round(row["grid_export_kwh"] or 0, 2),
            "solar_kwh": round(row["solar_kwh"] or 0, 2),
        }
        for row in rows
    ]


@router.get("/alerts")
async def alerts(
    request: Request,
    limit: int = Query(default=50, le=200),
    alert_type: str | None = Query(default=None, alias="type"),
):
    """Alert history, newest first."""
    pool = request.app.state.pool

    if alert_type:
        rows = await pool.fetch(
            """
            SELECT id, fired_at, alert_type, message, metadata
            FROM alerts_log
            WHERE alert_type = $1
            ORDER BY fired_at DESC LIMIT $2
            """,
            alert_type, limit,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, fired_at, alert_type, message, metadata
            FROM alerts_log
            ORDER BY fired_at DESC LIMIT $1
            """,
            limit,
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
    report_type: str | None = Query(default=None, alias="type"),
    limit: int = Query(default=10, le=50),
):
    """Report history."""
    pool = request.app.state.pool

    if report_type:
        rows = await pool.fetch(
            """
            SELECT id, sent_at, report_type, covers_from, covers_to, subject, metadata
            FROM reports_log
            WHERE report_type = $1
            ORDER BY sent_at DESC LIMIT $2
            """,
            report_type, limit,
        )
    else:
        rows = await pool.fetch(
            """
            SELECT id, sent_at, report_type, covers_from, covers_to, subject, metadata
            FROM reports_log
            ORDER BY sent_at DESC LIMIT $1
            """,
            limit,
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
