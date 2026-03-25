# SelfPower — Data Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL DATA SOURCES                     │
├──────────────┬──────────────┬─────────────┬─────────────────┤
│  Tesla API   │  Open-Meteo  │  Claude AI  │  Telegram Bot   │
│  (power,     │  (weather,   │  (narrative │  (alerts,       │
│   history,   │   temp,      │   generation│   link codes)   │
│   battery)   │   forecast)  │   )         │                 │
└──────┬───────┴──────┬───────┴──────┬──────┴────────┬────────┘
       │              │              │               │
       ▼              │              │               │
┌──────────────┐      │              │               │
│   INGESTION  │      │              │               │
├──────────────┤      │              │               │
│ poller.py    │      │              │               │
│  every 5min  │      │              │               │
│  ↓           │      │              │               │
│ backfill.py  │      │              │               │
│  on-demand   │      │              │               │
└──────┬───────┘      │              │               │
       │              │              │               │
       ▼              │              ▼               │
┌─────────────────────┴──────────────────────────────┴────────┐
│                      DATABASE (PostgreSQL)                    │
├─────────────────┬──────────────────┬────────────────────────┤
│ tesla_intervals │ daily_summaries  │ accounts, users,       │
│ (5-min raw      │ (aggregated      │ kv_store, alerts_log,  │
│  power data)    │  daily totals    │ reports_log, invites,  │
│ ~288 rows/day   │  + costs + AI    │ refresh_tokens         │
│                 │  narrative)      │                        │
└────────┬────────┴────────┬─────────┴────────────────────────┘
         │                 │
         ▼                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    BACKEND API (FastAPI)                      │
├─────────────────────────────┬───────────────────────────────┤
│ GET /summary                │ POST /auth/login,register     │
│ GET /daily?from=&to=        │ POST /auth/tesla/start|complete│
│ GET /hourly?date=|from=&to= │ GET  /auth/me                │
│ GET /intervals?date=|from=  │ GET  /auth/account/backfill/* │
│ GET /sankey?date=|from=&to= │ GET  /rates?date=            │
│ GET /sankey/live             │                               │
│ GET /alerts                 │                               │
└─────────────┬───────────────┴───────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                         │
├──────────────────┬──────────────────────────────────────────┤
│ useDashboardData │ useWeather (→ Open-Meteo direct)         │
│  fetchLive: /summary + /alerts (every 5min)                  │
│  fetchRange: /hourly + /intervals + /daily + /sankey         │
├──────────┬───────┴──────┬───────────────┬───────────────────┤
│ FlowTab  │  ImpactTab   │  OptimizeTab  │  SettingsPage     │
│ Now/Day/ │  Savings +   │  AI insights  │  Tesla reconnect  │
│ Week/Mo/ │  Grid costs  │  + suggestions│                   │
│ Year     │  by period   │  + alerts     │                   │
└──────────┴──────────────┴───────────────┴───────────────────┘
```

## Data Sources

| Source | Protocol | Used By | Purpose |
|--------|----------|---------|---------|
| Tesla Energy API | REST via `teslapy` | poller, backfill, auth | Live power, history, battery SOC |
| Open-Meteo | REST (client-side) | useWeather hook | Temperature, conditions, wind |
| Claude AI (Anthropic) | REST | aggregator, weekly_summary | Daily/weekly narrative generation |
| Telegram Bot API | REST | notifier, telegram_bot | Alert delivery, account linking |

## Data Ingestion

### Poller (`backend/poller.py`)
- **Schedule**: Every 5 minutes (APScheduler), fires immediately on startup
- **Flow**: Tesla API → `poll_once()` → upsert `tesla_intervals` → check solar surplus alert
- **Token management**: Per-account caches in `kv_store`, in-memory `_token_caches`

### Backfill (`backend/backfill.py`)
- **Trigger**: After Tesla OAuth completes (365 days), or via API
- **Flow**: Tesla calendar_history API → `_insert_intervals_for_account()` → `aggregate_day()` per day
- **Dedup**: `ON CONFLICT (account_id, ts) DO NOTHING`

### Daily Aggregator (`backend/aggregator.py`)
- **Schedule**: 6:50 AM daily
- **Flow**: `tesla_intervals` → aggregate → `daily_summaries` → evaluate actions → AI narrative → Telegram report

### Weekly Summary (`backend/weekly_summary.py`)
- **Schedule**: Sunday 5:50 PM
- **Flow**: 7 days of `daily_summaries` → aggregate → AI narrative → Telegram report

## Database Tables

### Core Data
| Table | Purpose | Key | Write Source |
|-------|---------|-----|-------------|
| `tesla_intervals` | Raw 5-min power readings | `(account_id, ts)` UNIQUE | poller, backfill |
| `daily_summaries` | Aggregated daily metrics + costs | `(account_id, day)` | aggregator, backfill |
| `alerts_log` | Alert history | id, account_id, fired_at | poller (solar surplus) |
| `reports_log` | Sent report records | id, account_id | aggregator, weekly_summary |
| `kv_store` | Key-value config (Tesla tokens) | `(key, account_id)` UNIQUE | poller (token refresh) |

### Auth
| Table | Purpose | Key |
|-------|---------|-----|
| `accounts` | One per Tesla account | id (UUID), tesla_email UNIQUE |
| `users` | Up to 2 per account | id (UUID), email UNIQUE, role |
| `invites` | Secondary user invitations | id (UUID), expires_at |
| `refresh_tokens` | JWT refresh token storage | id (UUID), token_hash UNIQUE |

## API Endpoints

### Data (`backend/api.py`)
| Endpoint | Source Table | Returns |
|----------|-------------|---------|
| `GET /summary` | `tesla_intervals` (latest + today) | Current power + today's running totals |
| `GET /daily?from=&to=` | `daily_summaries` | Array of daily summaries |
| `GET /hourly?date=` or `?from=&to=` | `tesla_intervals` (GROUP BY hour) | Hourly averages + cumulative kWh |
| `GET /intervals?date=` or `?from=&to=` | `tesla_intervals` (raw) | Raw 5-min interval points |
| `GET /sankey?date=` or `?from=&to=` | `tesla_intervals` (flow allocation) | Sankey flow allocations (kWh) |
| `GET /sankey/live` | `tesla_intervals` (latest row) | Live Sankey flows (kW) |
| `GET /rates?date=` | `backend/rates.py` (no DB) | TOU rate schedule + season |
| `GET /alerts` | `alerts_log` | Alert history |
| `GET /reports` | `reports_log` | Report history |
| `GET /health` | `tesla_intervals` + memory | System health status |

### Auth (`backend/auth_api.py`)
| Endpoint | Purpose |
|----------|---------|
| `POST /auth/login` | JWT + refresh token |
| `POST /auth/register` | Create account or join via invite |
| `POST /auth/tesla/start` | Generate Tesla OAuth URL |
| `POST /auth/tesla/complete` | Exchange code for tokens, start backfill |
| `GET /auth/me` | User profile + tesla_connected status |
| `GET /auth/account/backfill/status` | Backfill progress |

## Frontend Data Flow

### Hooks
- **`useDashboardData`**: Central data hook. `fetchLive` (every 5min): `/summary` + `/alerts`. `fetchRange` (on period change): `/hourly` + `/intervals` + `/daily` + `/sankey`.
- **`useWeather`**: Client-side Open-Meteo fetch every 15min.

### Component → Data Mapping
| Component | Data Props | API Dependency |
|-----------|-----------|----------------|
| FlowTab (Now) | summary, weather | `/summary`, `/sankey/live`, Open-Meteo |
| FlowTab (Historical) | daily, hourly, intervalData, sankeyFlows | `/daily`, `/hourly`, `/intervals`, `/sankey` |
| ImpactTab | daily, hourly, sankeyFlows | `/daily`, `/hourly`, `/sankey` |
| OptimizeTab | summary, daily, alerts | `/summary`, `/daily`, `/alerts` |

## Rate Engine (`backend/rates.py`)

- **Plan**: MCE + PG&E E-TOU-D
- **Winter (Oct–May)**: Peak $0.356 (4–9pm), Part-Peak $0.333 (3–4pm, 9pm–12am), Off-Peak $0.319
- **Summer (Jun–Sep)**: Peak $0.796 (5–8pm weekdays), Off-Peak $0.561
- **Export (NEM 3.0)**: Flat $0.068/kWh
- **Single source of truth**: Backend `/rates` endpoint serves to frontend

## Data Integrity

- **Unique constraint**: `tesla_intervals(account_id, ts)` prevents duplicate intervals
- **Upsert everywhere**: Poller uses `ON CONFLICT DO UPDATE`, backfill uses `ON CONFLICT DO NOTHING`
- **Sanity checks** (`backend/data_sanity_checks.py`): Interval validation, aggregate validation, flow conservation
- **Timestamp rounding**: Poller rounds to 5-min marks to align with backfill data
