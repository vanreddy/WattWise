-- 005: Drop legacy single-tenant PK on tesla_intervals
-- The old PK was (ts) only, which blocks multi-tenant inserts
-- The unique index uq_tesla_intervals_account_ts on (account_id, ts) is the correct constraint

-- Drop old PK if it exists (idempotent)
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'tesla_intervals'::regclass
          AND conname = 'tesla_intervals_pkey'
    ) THEN
        ALTER TABLE tesla_intervals DROP CONSTRAINT tesla_intervals_pkey;
    END IF;
END $$;
