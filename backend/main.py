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
from backend.auth_api import router as auth_router
from backend.poller import poll_and_check, _load_cache_from_db
from backend.telegram_bot import run_bot_polling
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

    # Dedup tesla_intervals and add unique constraint (idempotent)
    try:
        from datetime import date, timedelta
        from aggregator import aggregate_day

        # Check if unique index already exists
        idx_exists = await pool.fetchval("""
            SELECT 1 FROM pg_indexes
            WHERE indexname = 'uq_tesla_intervals_account_ts'
        """)

        if not idx_exists:
            logger.info("Dedup: removing duplicate tesla_intervals rows...")
            await pool.execute("""
                DELETE FROM tesla_intervals a
                USING tesla_intervals b
                WHERE a.account_id = b.account_id
                  AND a.ts = b.ts
                  AND a.ctid > b.ctid
            """)
            await pool.execute("""
                CREATE UNIQUE INDEX uq_tesla_intervals_account_ts
                ON tesla_intervals(account_id, ts)
            """)
            logger.info("Dedup migration complete — unique constraint added")

            # Re-aggregate last 7 days for all accounts after dedup
            accounts = await pool.fetch("SELECT id FROM accounts")
            for acct in accounts:
                for day_offset in range(7):
                    day = date.today() - timedelta(days=day_offset)
                    try:
                        await aggregate_day(pool, day, acct["id"])
                    except Exception:
                        logger.warning("Re-aggregate failed for %s day %s", acct["id"], day)
            logger.info("Re-aggregated last 7 days for %d accounts", len(accounts))
        else:
            logger.info("Dedup: unique index already exists, skipping")
    except Exception:
        logger.exception("Dedup migration failed — app will continue without it")

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

    # Backfill any gaps from downtime — fetch last 2 days for all accounts in background
    import asyncio
    from backfill import backfill_account

    async def _fill_gaps():
        try:
            accounts = await pool.fetch("SELECT id FROM accounts")
            for acct in accounts:
                try:
                    await backfill_account(pool, acct["id"], days=2)
                    logger.info("Gap-fill complete for account %s", acct["id"])
                except Exception:
                    logger.exception("Gap-fill failed for account %s", acct["id"])
        except Exception:
            logger.exception("Gap-fill startup task failed")

    asyncio.create_task(_fill_gaps())

    # Telegram bot listener (long-polling for /start commands)
    bot_task = asyncio.create_task(run_bot_polling(pool))

    logger.info("WattWise started — poller, daily, weekly jobs + Telegram bot listener")

    yield

    # Shutdown
    bot_task.cancel()
    try:
        await bot_task
    except asyncio.CancelledError:
        pass
    scheduler.shutdown()
    await pool.close()


app = FastAPI(title="WattWise", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:3000").split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)
app.include_router(api_router)
app.include_router(auth_router)


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
    from backend.poller import _token_caches
    cache_status = "empty"
    if _token_caches:
        for email, data in _token_caches.items():
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
