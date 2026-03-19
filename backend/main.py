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
from backend.poller import poll_and_check
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
    return {"status": "ok"}
