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
from backend.nest_api import router as nest_router
from backend.smartcar_api import router as smartcar_router
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

    # Ensure kv_store table exists (for Tesla token persistence)
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS kv_store (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # 005: Add site metadata columns (idempotent)
    for col_sql in [
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS zip_code TEXT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS solar_capacity_kw DOUBLE PRECISION",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS rate_plan_name TEXT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tariff_content JSONB",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nest_connected BOOLEAN DEFAULT FALSE",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS smartcar_connected BOOLEAN DEFAULT FALSE",
    ]:
        await pool.execute(col_sql)

    # Optimizer state — stores the hourly forecast plan (advisory only)
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS optimizer_state (
            account_id UUID PRIMARY KEY REFERENCES accounts(id),
            current_plan JSONB,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    await pool.execute("""
        CREATE TABLE IF NOT EXISTS weather_history (
            id SERIAL PRIMARY KEY,
            account_id UUID REFERENCES accounts(id),
            ts TIMESTAMPTZ NOT NULL,
            cloud_cover_pct FLOAT,
            temp_f FLOAT,
            conditions TEXT,
            UNIQUE(account_id, ts)
        )
    """)

    # Fix kv_store: replace single-column PK with composite (key, account_id)
    try:
        pk_col_count = await pool.fetchval("""
            SELECT COUNT(*) FROM information_schema.key_column_usage
            WHERE table_name = 'kv_store'
              AND constraint_name = 'kv_store_pkey'
        """)
        if pk_col_count == 1:
            logger.info("Fixing kv_store PK: key-only -> (key, account_id)")
            await pool.execute("ALTER TABLE kv_store DROP CONSTRAINT kv_store_pkey")
            # account_id can be NULL for legacy global keys, so we use a unique index instead
            await pool.execute("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_kv_store_key_account
                ON kv_store(key, account_id)
            """)
            logger.info("kv_store PK fix complete")
    except Exception:
        logger.exception("kv_store PK fix failed — continuing")

    # Dedup tesla_intervals and add unique constraint (idempotent)
    try:
        from datetime import date, timedelta
        from backend.aggregator import aggregate_day

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

    # Fix legacy PK on tesla_intervals (ts only → should be account_id, ts)
    try:
        has_old_pk = await pool.fetchval("""
            SELECT 1 FROM pg_constraint
            WHERE conrelid = 'tesla_intervals'::regclass
              AND conname = 'tesla_intervals_pkey'
        """)
        if has_old_pk:
            await pool.execute("ALTER TABLE tesla_intervals DROP CONSTRAINT tesla_intervals_pkey")
            logger.info("Dropped legacy tesla_intervals_pkey (ts only)")
    except Exception:
        logger.exception("PK fix check failed — continuing")

    from datetime import datetime as dt_cls
    scheduler = AsyncIOScheduler()

    # Tesla poller — every 5 minutes, fire immediately on startup
    scheduler.add_job(
        poll_and_check, "interval", minutes=5, args=[pool], id="poller",
        next_run_time=dt_cls.now(),
    )

    # Daily aggregation — 6:50am
    scheduler.add_job(
        run_daily_aggregation, "cron", hour=6, minute=50, args=[pool], id="daily",
    )

    # Optimizer — every hour at :05 (after poller has fresh data)
    from backend.optimizer.engine import run_all_accounts as run_optimizer
    scheduler.add_job(
        run_optimizer, "interval", hours=1, minutes=0, args=[pool], id="optimizer",
        next_run_time=dt_cls.now() + __import__("datetime").timedelta(minutes=2),
    )

    scheduler.start()

    logger.info("WattWise started — poller, daily, optimizer jobs")

    yield

    # Shutdown
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
app.include_router(nest_router)
app.include_router(smartcar_router)

from backend.optimizer.api import router as optimizer_router
app.include_router(optimizer_router)


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
