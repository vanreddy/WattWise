-- WattWise schema: Postgres + TimescaleDB
-- Run with: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Raw 5-minute interval data from Tesla API
CREATE TABLE tesla_intervals (
    ts          TIMESTAMPTZ NOT NULL,
    solar_w     REAL NOT NULL,        -- solar generation (watts)
    home_w      REAL NOT NULL,        -- total home load (watts)
    grid_w      REAL NOT NULL,        -- grid import (+) or export (-) (watts)
    battery_w   REAL NOT NULL,        -- Powerwall charge (+) or discharge (-) (watts)
    battery_pct REAL NOT NULL,        -- Powerwall state of charge (0-100)
    vehicle_w   REAL NOT NULL DEFAULT 0  -- EV charging draw (watts)
);

SELECT create_hypertable('tesla_intervals', 'ts');

-- Index for time-range queries used by aggregator
CREATE INDEX idx_tesla_intervals_ts ON tesla_intervals (ts DESC);

-- Daily summaries computed by aggregator each morning
CREATE TABLE daily_summaries (
    day                  DATE PRIMARY KEY,
    total_import_kwh     REAL NOT NULL,
    total_export_kwh     REAL NOT NULL,
    solar_generated_kwh  REAL NOT NULL,
    solar_self_consumed_kwh REAL NOT NULL,
    peak_import_kwh      REAL NOT NULL,
    part_peak_import_kwh REAL NOT NULL,
    off_peak_import_kwh  REAL NOT NULL,
    peak_cost            REAL NOT NULL,
    part_peak_cost       REAL NOT NULL,
    off_peak_cost        REAL NOT NULL,
    total_cost           REAL NOT NULL,
    export_credit        REAL NOT NULL,
    ev_kwh               REAL NOT NULL,
    ev_peak_kwh          REAL NOT NULL,
    ev_off_peak_kwh      REAL NOT NULL,
    ev_cost              REAL NOT NULL,
    battery_peak_coverage_pct REAL,   -- % of peak window hours covered by Powerwall
    battery_depletion_hour REAL,      -- hour (decimal) when battery hit reserve
    context_narrative    TEXT,        -- templated daily context sentence
    actions_json         JSONB        -- fired action rules as JSON array
);

-- Alert log for solar surplus and any future alerts
CREATE TABLE alerts_log (
    id         BIGSERIAL PRIMARY KEY,
    fired_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    alert_type TEXT NOT NULL,          -- e.g. 'solar_surplus'
    message    TEXT NOT NULL,
    metadata   JSONB                   -- extra context (export_kw, battery_pct, etc.)
);

CREATE INDEX idx_alerts_log_type_fired ON alerts_log (alert_type, fired_at DESC);

-- Report log for daily and weekly reports
CREATE TABLE reports_log (
    id          BIGSERIAL PRIMARY KEY,
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    report_type TEXT NOT NULL,          -- 'daily' or 'weekly'
    covers_from DATE NOT NULL,          -- start of reporting period
    covers_to   DATE NOT NULL,          -- end of reporting period
    subject     TEXT NOT NULL,
    body_html   TEXT NOT NULL,
    metadata    JSONB                   -- any extra context
);

CREATE INDEX idx_reports_log_type_sent ON reports_log (report_type, sent_at DESC);
