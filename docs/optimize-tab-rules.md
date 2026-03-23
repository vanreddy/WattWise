# Optimize Tab — Suggestion Rules

This document defines all suggestions shown on the Optimize tab, organized by type.

---

## 1. AI-Generated Daily Insight

**Source:** Backend (`aggregator.py` → `generate_daily_narrative()`)
**Trigger:** Runs daily at 6:50 AM Pacific via APScheduler
**Model:** Claude Sonnet (`claude-sonnet-4-20250514`), max 200 tokens
**Storage:** `daily_summaries.context_narrative` (TEXT) + `daily_summaries.actions_json` (JSONB)
**Fallback:** Templated narrative (`_pick_context_narrative_fallback()`) if API fails

**Prompt context includes:**
- Grid import by TOU period (peak/part-peak/off-peak) with costs
- Solar generation, self-consumption, export with dollar values
- EV charging breakdown (peak vs off-peak kWh and cost)
- Powerwall peak coverage % and depletion time
- Current season and rate schedule

**Display:** Purple "Daily Insight" card at top of Optimize tab, with any backend action rules shown as sub-items.

---

## 2. Rules-Based Recommendations

Strategic, configuration-level suggestions based on the user's setup and usage patterns. These analyze multi-day data and user profile.

### 2a. Enable Real-Time Solar Alerts

| Field | Value |
|-------|-------|
| **ID** | `enable-alerts` |
| **Trigger** | User has no Telegram linked (`telegram_chat_id === null`) AND average daily export > 5 kWh |
| **Rationale** | On NEM 3.0, export earns $0.07/kWh but self-consumption offsets $0.32/kWh. Real-time alerts let users shift loads during surplus windows. |
| **Savings** | `avgExportKwh × $0.25 × 30 days` |
| **Priority** | HIGH |
| **Action** | Link Telegram in Settings |

### 2b. Charge EV During Solar Hours (Not Overnight)

| Field | Value |
|-------|-------|
| **ID** | `ev-solar-charging` |
| **Trigger** | Average daily export > 5 kWh AND EV charged on 2+ of last 7 days AND >60% of EV charging was off-peak (overnight) |
| **Rationale** | On NEM 3.0, overnight charging costs $0.319/kWh. Solar-hour charging (9 AM–3 PM) uses free solar. |
| **Savings** | `avgEvKwh × $0.319 × 15 charge days/mo` |
| **Priority** | HIGH |
| **Action** | Set Tesla charging schedule to start at 9 AM |

### 2c. Run Appliances During Solar Hours

| Field | Value |
|-------|-------|
| **ID** | `shift-loads-solar` |
| **Trigger** | Average daily export > 8 kWh |
| **Rationale** | Dishwasher, laundry, dryer running overnight use grid at $0.319/kWh. Running them 9 AM–3 PM uses free solar instead of exporting at $0.07/kWh. 5× value difference. |
| **Savings** | None shown (behavioral change, hard to quantify) |
| **Priority** | MEDIUM |
| **Action** | Shift dishwasher/laundry to morning |

### 2d. Set Powerwall to Self-Powered Mode

| Field | Value |
|-------|-------|
| **ID** | `powerwall-self-powered` |
| **Trigger** | Battery peak coverage < 30% on 3+ of last 7 days AND battery never depleted (still had charge) AND peak import > 2 kWh/day |
| **Rationale** | If battery has charge but isn't discharging during peak, it may not be set to Self-Powered mode. In backup-only mode, the Powerwall reserves for outages instead of offsetting peak costs. |
| **Savings** | None shown (depends on configuration) |
| **Priority** | HIGH |
| **Action** | Open Tesla app → Powerwall → Set to "Self-Powered" |

---

## 3. Real-Time / Single-Day Suggestions

Reactive suggestions based on live data (`summary`) or yesterday's daily summary.

### 3a. Use Your Solar Surplus (Live)

| Field | Value |
|-------|-------|
| **ID** | `solar-surplus` |
| **Trigger** | Currently exporting > 2 kW (`summary.current.grid_w < -2000`) |
| **Rationale** | Real-time opportunity to use solar instead of exporting at $0.07/kWh. |
| **Savings** | `exportKw × $0.25/hr` |
| **Priority** | HIGH |

### 3b. Pre-Cool Before Peak Pricing (Live)

| Field | Value |
|-------|-------|
| **ID** | `pre-cool` |
| **Trigger** | Home draw > 3 kW (`summary.current.home_w > 3000`) |
| **Rationale** | High home draw suggests AC is running. Pre-cooling before 3 PM avoids running AC during peak (4-9 PM) when rates are 12% higher. |
| **Savings** | None shown |
| **Priority** | LOW |

### 3c. EV Charged During Peak Yesterday

| Field | Value |
|-------|-------|
| **ID** | `ev-off-peak` |
| **Trigger** | Yesterday's `ev_peak_kwh > 0.5` |
| **Rationale** | EV charged during peak at $0.356/kWh instead of off-peak $0.319/kWh or free solar hours. |
| **Savings** | `ev_peak_kwh × ($0.356 - $0.319)` per day |
| **Priority** | HIGH |

### 3d. Powerwall Ran Out Early Yesterday

| Field | Value |
|-------|-------|
| **ID** | `battery-depletion` |
| **Trigger** | Yesterday's `battery_depletion_hour < 21` (before 9 PM) |
| **Rationale** | Battery depleted before peak window ended, forcing grid import during most expensive hours. |
| **Savings** | None shown |
| **Priority** | MEDIUM |

### 3e. Low Solar Self-Consumption Yesterday

| Field | Value |
|-------|-------|
| **ID** | `self-consumption` |
| **Trigger** | Yesterday's `solar_generated_kwh > 10` AND `self_consumed / generated < 50%` |
| **Rationale** | More than half of solar was exported at $0.07/kWh instead of offsetting $0.32/kWh grid. |
| **Savings** | `exported_kwh × ($0.32 - $0.07)` per day |
| **Priority** | MEDIUM |

---

## 4. Backend Action Rules (7-Day Patterns)

These are computed in `aggregator.py` → `evaluate_actions()` and stored in `daily_summaries.actions_json`. Displayed as sub-items under the AI Daily Insight.

### 4a. Repeated EV Peak Charging

- **Trigger:** EV charged during peak on ≥ 3 of last 7 days AND estimated monthly saving > $5
- **Output:** "Shift EV charging to solar hours (9am–3pm) — your EV charged during peak rates on X of the last Y days."

### 4b. Consistent High Grid Draw Window

- **Trigger:** Grid import > 2 kW in the same hour on ≥ 3 of last 7 days
- **Output:** "You consistently draw heavily from the grid between Xam–Ypm (N of the last M days)."

### 4c. Powerwall Depleting Before Peak Closes

- **Trigger:** Battery depleted (< 10%) during peak on ≥ 3 of last 7 days
- **Output:** "Your battery is running out before 9pm — average depletion at X:XXpm. Consider adjusting your Powerwall reserve setting."

---

## 5. Periodic Deep Analysis (Onboarding + Monthly)

LLM-generated recommendations based on multi-week patterns. Runs on two schedules:

### Onboarding Analysis (after first 7-14 days)

**Trigger:** `days_in_db >= 14` for a new account (check during daily aggregation)
**Model:** Claude Sonnet, higher token budget (~500 tokens)
**Storage:** New `optimization_reports` table or `reports_log` with `report_type = 'onboarding_optimize'`

Analyzes the user's baseline patterns to generate initial setup recommendations:

| Analysis | What It Checks | Example Recommendation |
|----------|----------------|----------------------|
| **EV charging schedule** | When does the EV typically charge? Peak, off-peak, or solar hours? | "Your EV charges overnight 80% of the time. Switching to 9 AM start would use free solar." |
| **Export vs self-consumption** | What % of solar is exported vs used at home? | "You export 60% of solar at $0.07/kWh. Shifting loads to 9 AM–3 PM could save ~$45/mo." |
| **Peak cost exposure** | How much of total cost comes from peak hours? | "42% of your grid cost is from peak. Your Powerwall covers only 55% of peak — consider Self-Powered mode." |
| **Powerwall utilization** | Is the battery cycling effectively? Depleting too early? | "Your Powerwall runs out at ~7 PM on average, leaving 2 hours of peak uncovered." |
| **Baseline cost profile** | What's the user's daily/monthly cost baseline? | "Your average daily grid cost is $3.20. We'll track this and alert you if it rises." |

### Monthly Review (1st of each month)

**Schedule:** 1st of the month, 6:00 AM Pacific (via APScheduler)
**Input:** Full prior month of daily summaries + comparison to month before
**Model:** Claude Sonnet (~500 tokens)

Compares month-over-month patterns to surface trends and seasonal changes:

| Analysis | What It Checks | Example Recommendation |
|----------|----------------|----------------------|
| **Cost trend** | Total grid cost this month vs last month | "Grid costs rose 23% ($68 → $84). Peak usage increased — likely AC." |
| **Solar production shift** | Generation this month vs last month or same month last year | "Solar dropped 18% vs last month — seasonal change, or check panels for dirt/shading." |
| **Self-consumption trend** | Is the user capturing more or less of their solar? | "Self-consumption improved from 38% to 52% — nice work shifting loads." |
| **EV cost audit** | Total EV charging cost and how much was avoidable | "EV charging cost $32 this month. $12 was during peak — shifting to solar saves ~$8/mo." |
| **Seasonal rate preview** | Warn about upcoming rate changes | "Summer rates start June 1 — peak jumps from $0.356 to $0.796/kWh. Pre-cooling and battery strategy become critical." |
| **Powerwall effectiveness** | Month-over-month coverage trend | "Powerwall covered 72% of peak this month (up from 65%). Average depletion moved from 7:15 PM to 8:30 PM." |

### Display

Monthly and onboarding insights appear as a separate card in the Optimize tab — visually distinct from daily suggestions, with a "Monthly Review" or "Getting Started" header and the month/date range.

### Implementation Plan

**Backend:**
1. New `generate_monthly_optimization()` in a new file `backend/monthly_optimize.py`
2. Queries all `daily_summaries` for the prior month + month before for comparison
3. Calls Claude with a monthly optimization prompt (similar pattern to `weekly_summary.py`)
4. Stores result in `reports_log` with `report_type = 'monthly_optimize'`
5. APScheduler job: 1st of month, 6:00 AM Pacific

**Backend (onboarding):**
1. Check `days_in_db` during daily aggregation
2. On first crossing 14 days, trigger `generate_onboarding_optimization()`
3. Store result in `reports_log` with `report_type = 'onboarding_optimize'`
4. Only runs once per account

**Frontend:**
1. New API call: `api.getOptimizationReport()` → fetches latest monthly/onboarding report
2. Display in OptimizeTab as a card above the rules-based recommendations
3. Show the month it covers and a "last generated" timestamp

**API:**
1. New endpoint: `GET /optimization/latest` → returns most recent optimization report for the account

---

## Rate Context

All suggestions reference these rates (MCE + PG&E E-TOU-D):

| Season | Period | Rate |
|--------|--------|------|
| **Winter** (Oct–May) | Peak (4-9 PM) | $0.356/kWh |
| | Part-peak (3-4 PM, 9 PM-12 AM) | $0.333/kWh |
| | Off-peak (12 AM-3 PM) | $0.319/kWh |
| **Summer** (Jun–Sep) | Peak (5-8 PM weekdays) | $0.796/kWh |
| | Off-peak (all other) | $0.561/kWh |
| **NEM 3.0 Export** | All | $0.068/kWh |

---

## Adding New Rules

To add a new suggestion:

1. **Rules-based (strategic):** Add to `generateRulesBasedSuggestions()` in `frontend/src/components/tabs/OptimizeTab.tsx`
2. **Real-time/daily:** Add to `generateRealtimeSuggestions()` in the same file
3. **Backend pattern (7-day):** Add to `evaluate_actions()` in `backend/aggregator.py`
4. **Monthly/onboarding:** Add to the LLM prompt in `backend/monthly_optimize.py` (TBD)
5. **Update this document** with the trigger, rationale, and savings formula
