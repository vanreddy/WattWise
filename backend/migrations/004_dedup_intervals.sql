-- 004: Deduplicate tesla_intervals and add unique constraint
-- This prevents double-counting energy when backfill runs twice or overlaps with poller

-- Step 1: Remove duplicate rows, keeping only the first inserted (lowest ctid)
DELETE FROM tesla_intervals a
USING tesla_intervals b
WHERE a.account_id = b.account_id
  AND a.ts = b.ts
  AND a.ctid > b.ctid;

-- Step 2: Add unique constraint so duplicates can never happen again
CREATE UNIQUE INDEX IF NOT EXISTS uq_tesla_intervals_account_ts
ON tesla_intervals(account_id, ts);
