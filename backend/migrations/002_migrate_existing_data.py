"""
Migrate existing single-tenant data to multi-tenant schema.

Run ONCE after deploying 001_auth_tables.sql and the new code.

Steps:
  1. Create an `accounts` row from TESLA_EMAIL env var
  2. Prompt for primary user email + password → create `users` row
  3. Backfill account_id on all existing data rows
  4. Copy TELEGRAM_CHAT_ID env var → users.telegram_chat_id (if set)
  5. Apply NOT NULL constraints on account_id columns
  6. Swap daily_summaries PK to (account_id, day)
"""

from __future__ import annotations

import asyncio
import getpass
import os
import sys

import asyncpg

# Add parent to path so we can import backend modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.auth import hash_password


async def migrate():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    tesla_email = os.environ.get("TESLA_EMAIL")
    if not tesla_email:
        print("ERROR: TESLA_EMAIL not set (needed to create account)")
        sys.exit(1)

    pool = await asyncpg.create_pool(database_url)

    # --- Step 1: Create account ---
    existing = await pool.fetchval(
        "SELECT id FROM accounts WHERE tesla_email = $1", tesla_email
    )
    if existing:
        account_id = existing
        print(f"Account already exists for {tesla_email}: {account_id}")
    else:
        account_id = await pool.fetchval(
            "INSERT INTO accounts (tesla_email) VALUES ($1) RETURNING id",
            tesla_email,
        )
        print(f"Created account for {tesla_email}: {account_id}")

    # --- Step 2: Create primary user ---
    existing_user = await pool.fetchval(
        "SELECT id FROM users WHERE account_id = $1 AND role = 'primary'",
        account_id,
    )
    if existing_user:
        print(f"Primary user already exists: {existing_user}")
    else:
        print("\nCreate primary user for this account:")
        user_email = input("  Email: ").strip()
        if not user_email:
            print("ERROR: email required")
            sys.exit(1)
        password = getpass.getpass("  Password: ")
        if len(password) < 8:
            print("ERROR: password must be at least 8 characters")
            sys.exit(1)

        pw_hash = hash_password(password)
        user_id = await pool.fetchval(
            """INSERT INTO users (account_id, email, password_hash, role)
               VALUES ($1, $2, $3, 'primary') RETURNING id""",
            account_id, user_email, pw_hash,
        )
        print(f"Created primary user {user_email}: {user_id}")

        # Step 4: Copy TELEGRAM_CHAT_ID if set
        telegram_chat_id = os.environ.get("TELEGRAM_CHAT_ID")
        if telegram_chat_id:
            await pool.execute(
                "UPDATE users SET telegram_chat_id = $1 WHERE id = $2",
                telegram_chat_id, user_id,
            )
            print(f"Set telegram_chat_id from env: {telegram_chat_id}")

    # --- Step 3: Backfill account_id on existing data ---
    tables = ["tesla_intervals", "daily_summaries", "alerts_log", "reports_log", "kv_store"]
    for table in tables:
        result = await pool.execute(
            f"UPDATE {table} SET account_id = $1 WHERE account_id IS NULL",  # noqa: S608
            account_id,
        )
        count = int(result.split()[-1]) if result else 0
        if count:
            print(f"Backfilled {count} rows in {table}")

    # --- Step 5: Apply NOT NULL constraints ---
    for table in tables:
        try:
            await pool.execute(
                f"ALTER TABLE {table} ALTER COLUMN account_id SET NOT NULL"  # noqa: S608
            )
        except asyncpg.exceptions.NotNullViolationError:
            print(f"WARNING: {table} still has NULL account_id rows")
    print("Applied NOT NULL constraints on account_id columns")

    # --- Step 6: Swap daily_summaries PK to (account_id, day) ---
    try:
        # Drop old PK if it's just (day)
        await pool.execute(
            "ALTER TABLE daily_summaries DROP CONSTRAINT IF EXISTS daily_summaries_pkey"
        )
        await pool.execute(
            "ALTER TABLE daily_summaries ADD PRIMARY KEY (account_id, day)"
        )
        print("Updated daily_summaries PK to (account_id, day)")
    except Exception as e:
        print(f"PK swap note: {e}")

    # --- Step 7: Add unique index on kv_store for per-account keys ---
    try:
        await pool.execute(
            """CREATE UNIQUE INDEX IF NOT EXISTS idx_kv_store_account_key
               ON kv_store(key, account_id)"""
        )
        print("Created unique index on kv_store(key, account_id)")
    except Exception as e:
        print(f"kv_store index note: {e}")

    await pool.close()
    print("\nMigration complete!")


if __name__ == "__main__":
    asyncio.run(migrate())
