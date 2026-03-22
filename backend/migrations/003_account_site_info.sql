-- Add Tesla site metadata to accounts table.
-- Populated automatically on first successful poll.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS site_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS energy_site_id TEXT;
