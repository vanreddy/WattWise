-- WS4.T4: Auth + Data Isolation schema migration
-- Run BEFORE deploying new code. account_id is nullable initially;
-- 002_migrate_existing_data.py backfills then applies NOT NULL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Accounts: one per Tesla account
CREATE TABLE IF NOT EXISTS accounts (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tesla_email TEXT NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Users: up to 2 per account (primary + secondary)
CREATE TABLE IF NOT EXISTS users (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email            TEXT NOT NULL UNIQUE,
    password_hash    TEXT NOT NULL,
    role             TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'secondary')),
    telegram_chat_id TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_account ON users(account_id);

-- Invite tokens for secondary user registration
CREATE TABLE IF NOT EXISTS invites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id  UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email       TEXT NOT NULL,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    used_at     TIMESTAMPTZ
);

-- Refresh tokens (stored server-side for revocation)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked     BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);

-- Add account_id to existing data tables (nullable for now)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tesla_intervals' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE tesla_intervals ADD COLUMN account_id UUID REFERENCES accounts(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'daily_summaries' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE daily_summaries ADD COLUMN account_id UUID REFERENCES accounts(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'alerts_log' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE alerts_log ADD COLUMN account_id UUID REFERENCES accounts(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'reports_log' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE reports_log ADD COLUMN account_id UUID REFERENCES accounts(id);
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'kv_store' AND column_name = 'account_id'
    ) THEN
        ALTER TABLE kv_store ADD COLUMN account_id UUID REFERENCES accounts(id);
    END IF;
END $$;

-- New composite indexes for data isolation queries
CREATE INDEX IF NOT EXISTS idx_tesla_intervals_account_ts ON tesla_intervals(account_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_account_day ON daily_summaries(account_id, day);
CREATE INDEX IF NOT EXISTS idx_alerts_log_account ON alerts_log(account_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_log_account ON reports_log(account_id, sent_at DESC);

-- Update daily_summaries PK: (account_id, day) instead of just (day)
-- This runs after migration script backfills account_id and sets NOT NULL.
-- See 002_migrate_existing_data.py for the PK swap.
