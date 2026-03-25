-- 005: Store site metadata from Tesla SITE_CONFIG
-- Zip code, lat/lon, solar capacity, rate plan, and full tariff content

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS zip_code TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS solar_capacity_kw DOUBLE PRECISION;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS rate_plan_name TEXT;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS tariff_content JSONB;
