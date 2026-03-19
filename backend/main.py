"""
WattWise backend entry point.

Starts the FastAPI server with APScheduler jobs:
  - Tesla poller: every 5 minutes
  - Daily aggregation: 6:50am daily
  - Weekly summary: 5:50pm every Sunday
"""

import logging
import os
from contextlib import asynccontextmanager

import asyncpg
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.aggregator import run_daily_aggregation
from backend.api import router as api_router
from backend.poller import poll_and_check, _load_cache_from_db
from backend.weekly_summary import run_weekly_summary

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    pool = await asyncpg.create_pool(os.environ["DATABASE_URL"])
    app.state.pool = pool

    # Ensure kv_store table exists (for Tesla token persistence)
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # Load Tesla token cache from DB before poller starts
    await _load_cache_from_db(pool)

    scheduler = AsyncIOScheduler()

    # Tesla poller — every 5 minutes
    scheduler.add_job(
        poll_and_check, "interval", minutes=5, args=[pool], id="poller",
    )

    # Daily aggregation — 6:50am
    scheduler.add_job(
        run_daily_aggregation, "cron", hour=6, minute=50, args=[pool], id="daily",
    )

    # Weekly summary — Sunday 5:50pm
    scheduler.add_job(
        run_weekly_summary, "cron", day_of_week="sun", hour=17, minute=50,
        args=[pool], id="weekly",
    )

    scheduler.start()
    logger.info("WattWise started — poller, daily, and weekly jobs scheduled")

    yield

    # Shutdown
    scheduler.shutdown()
    await pool.close()


app = FastAPI(title="WattWise", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET"],
    allow_headers=["*"],
)
app.include_router(api_router)


@app.get("/health")
async def health():
    pool = app.state.pool
    last_poll = await pool.fetchval(
        "SELECT MAX(ts) FROM tesla_intervals"
    )
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    stale = False
    minutes_ago = None
    if last_poll:
        delta = now - last_poll
        minutes_ago = round(delta.total_seconds() / 60, 1)
        stale = minutes_ago > 15  # no data in 15+ minutes = likely poller issue

    # Check token cache status
    from backend.poller import _token_cache
    cache_status = "empty"
    if _token_cache:
        for email, data in _token_cache.items():
            sso = data.get("sso", {})
            if sso.get("refresh_token"):
                cache_status = "ok"
            elif sso.get("access_token"):
                cache_status = "no_refresh_token"
            else:
                cache_status = "no_tokens"

    return {
        "status": "degraded" if stale else "ok",
        "last_poll": last_poll.isoformat() if last_poll else None,
        "minutes_since_poll": minutes_ago,
        "poller_stale": stale,
        "token_cache": cache_status,
    }
