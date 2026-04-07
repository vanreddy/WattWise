# SelfPower Optimization Algorithm

## Overview

A predictive optimization engine that manages Powerwall, EV charging (BMW iX via Tesla Wall Connector), and HVAC (Nest Thermostat) to minimize electricity costs while maximizing self-powered consumption.

## Priorities (in order)

1. **Minimize Bill** — reduce grid import cost, especially during peak hours
2. **Maximize Self-Power** — use solar + Powerwall before grid whenever possible
3. **Minimize Grid Export** — on NEM 3.0, exported solar earns ~$0.04-0.08/kWh vs $0.30-0.55 import; absorb every kWh you can

## Architecture

```
Every 5 min:   POLL — read device states (Tesla API), store in DB (already exists)
Every 1 hour:  OPTIMIZE — predict → score → act → log
```

Single loop. Predictions are computed as the first step of the hourly optimize cycle, not a separate job.

## User Controls

Users set these once, adjust occasionally:

| Control | Default | Description |
|---------|---------|-------------|
| Auto Mode | ON | Master switch for all automation |
| Disable Until | Tomorrow 9 AM | When auto mode is off: Tonight 9 PM, Tomorrow 9 AM, or "I turn it back on" |
| PW Reserve | 20% | Minimum Powerwall SoC — algorithm never drains below this |
| Comfort Range | 68°F - 78°F | Algorithm never cools below min or lets temp exceed max |
| EV Min | 60% | Mandatory charge target — will use grid if needed during cheapest hours |
| EV Max | 90% | Upper limit — only charges beyond min% using solar/Powerwall |

### User Override Behavior

When user manually changes a device (e.g., adjusts Nest temp from the app):
- **That specific device's** automation pauses for **2 hours**
- Other devices continue optimizing normally
- After 2 hours, algorithm resumes control of the overridden device

## Constraints

### Hard Rules (never violated)
- **Never charge Powerwall from grid** — solar only
- **Never cool house above max°F** — comfort guarantee
- **Never cool house below min°F** — waste prevention
- **Never charge EV beyond max%** — battery health
- **Always reach EV min% by next departure** — will import from grid during cheapest hours if solar insufficient
- **Always maintain PW reserve%** — emergency buffer

### Peak Hours (4-9 PM) — Fixed Behavior
During peak TOU hours, behavior is hardcoded — the scorer does not run:

```
Solar     → Home load first, then top up Powerwall, then export (unavoidable)
Powerwall → DISCHARGE only (cover home load deficit, avoid grid import)
EV        → NEVER charge
HVAC      → NEVER cool (coast on pre-cool thermal mass)
Goal      → Zero grid import, zero controllable consumption
```

### Mandatory vs Opportunistic Loads

**Mandatory** — must be fulfilled, even if it means grid import during cheapest available hours:
- EV below min% and plugged in
- PW below reserve% (but only from solar — accept lower SoC if no solar)
- House temp above max°F

**Opportunistic** — only fulfilled from solar or Powerwall surplus, never from grid:
- Pre-cool house below max°F (thermal battery)
- Charge EV above min% toward max%
- Charge PW above reserve%

---

## Layer 1: Predict

Runs at the start of each hourly optimization cycle. Produces forecasts for the next 24 hours from the current hour.

### Solar Prediction

**Method:** Clear-sky normalized historical average with exponential decay weighting, scaled by weather forecast.

**Steps:**

1. **Fetch history:** Pull last 14 days of hourly solar production from `tesla_intervals`

2. **Fetch historical weather:** Get cloud cover for each historical day (cached from weather API)

3. **Normalize to clear-sky equivalent:**
   ```
   For each historical day, for each hour:
     weather_factor = 1.0 - (cloud_cover_pct × 0.8)
     clear_sky_equivalent[hour] = actual_solar[hour] / weather_factor
   ```
   This strips out weather effects, leaving only the seasonal baseline (sun angle, day length, panel orientation).

4. **Weighted average with exponential decay (factor = 0.85):**
   ```
   For each hour:
     weights = [0.85^0, 0.85^1, 0.85^2, ..., 0.85^13]  (yesterday=1.0, 14 days ago=0.10)
     baseline[hour] = weighted_avg(clear_sky_equivalents, weights)
   ```
   Recent days weighted more heavily — adapts to seasonal sun angle shift (~1° every 4 days).

5. **Apply today's weather forecast:**
   ```
   For each hour in next 24:
     today_factor = 1.0 - (forecast_cloud_cover_pct[hour] × 0.8)
     predicted_solar[hour] = baseline[hour] × today_factor
   ```

**Why 0.8 coefficient?** Even 100% overcast lets ~20% diffuse light through. Panels still produce on cloudy days.

### Base Load Prediction

**Method:** Average of last 7 same-weekday profiles, with HVAC and EV energy stripped out.

```
For each recent same-weekday:
  base_load[hour] = total_home[hour] - estimated_hvac[hour] - ev[hour]

predicted_base_load[hour] = avg(base_load across matching days)
```

HVAC and EV are excluded because the optimizer controls them — they're outputs of the algorithm, not inputs.

### Temperature Prediction

**Source:** Weather API hourly forecast (already available via `useWeather` hook).

```
predicted_outdoor_temp[hour] = weather_api_forecast[hour]
```

Used to estimate HVAC load — cooling from 78°F to 72°F costs more kW when it's 95°F outside vs 82°F.

### Backtest Validation

**Built into the prediction module.** Before trusting predictions, validate against historical actuals:

```
For each of the last 90 days:
  1. Simulate: run predict_solar() using ONLY data available before that day
     - Prior 14 days of solar history (weighted)
     - That day's actual weather (standing in for forecast)
  2. Compare: predicted kWh vs actual kWh for each hour
  3. Measure:
     - Mean absolute error per hour
     - Bias direction (over- or under-predict?)
     - Error by weather type (clear vs cloudy accuracy)
```

**Used to:**
- Tune the decay factor (sweep 0.7-0.95, pick lowest error)
- Validate that clear-sky normalization improves accuracy over naive averaging
- Establish confidence bounds on predictions
- Run periodically (monthly) to verify model isn't drifting

---

## Layer 2: Score & Act

For each hour in the optimization window (off-peak and partial-peak only — peak hours have fixed behavior), compute surplus and allocate to devices.

### Surplus Computation

```
surplus[h] = predicted_solar[h] - predicted_base_load[h]
```

Positive = excess solar available. Negative = deficit (need grid or Powerwall).

### Powerwall as Energy Shuttle

The Powerwall is unique — it's both source and sink. It cycles **multiple times per day**:

```
Morning:    Solar → PW (charge cycle 1)
Midday:     Solar + PW → EV/AC (discharge cycle 1, PW boosts EV charge rate)
Afternoon:  Solar → PW (charge cycle 2, refill for evening)
Evening:    PW → Home (discharge cycle 2, cover peak hours)
```

A 13.5 kWh battery can effectively move 25+ kWh per day through multiple cycles.

**Key decision:** Before discharging PW to support EV/AC:

```
remaining_solar = sum(predicted_surplus[h] for h in future_solar_hours)
pw_capacity_needed = kWh to refill PW to target before peak starts
can_refill = remaining_solar >= pw_capacity_needed

IF can_refill → safe to discharge PW now (it'll refill from later solar)
IF NOT can_refill → hold PW, only use direct solar for EV/AC
```

### Scoring Function

For each controllable load, compute a score. Highest score gets surplus first.

```
score(device, hour) = urgency + economic_value + time_sensitivity
```

#### Urgency (0 or 100) — binary, is device below mandatory minimum?

| Condition | Score |
|-----------|-------|
| PW below reserve% (solar available) | 100 |
| EV below min% AND plugged in | 100 |
| House temp above max°F | 100 |
| All minimums met | 0 |

Multiple devices at urgency=100 → split available power proportionally.

#### Economic Value (0-50) — how much does 1 kWh into this device save?

**Powerwall:**
```
pw_value = (peak_rate × 0.9) - cost_of_energy_now
           ^^^^^^^^           ^^^^^^^^^^^^^^^^^^^^
           future discharge    usually $0 (solar)
           value, minus 10%
           round-trip loss
```
Adjusted by scarcity:
```
scarcity = 1.0 - (remaining_solar / total_sink_capacity)
// 0 = abundant (PW will fill anyway), 1 = scarce (every kWh precious)
pw_value *= (0.5 + 0.5 × scarcity)
```

**EV:**
```
ev_value = cheapest_future_grid_rate - cost_of_energy_now
```
During solar hours: high (free now vs $0.17-0.32 later). At night: low.

**HVAC Pre-cool:**
```
hvac_value = estimated_peak_ac_kwh_avoided × peak_rate / energy_to_precool_now
```
High early afternoon (lots of peak hours to coast through). Drops to zero once peak starts.

#### Time Sensitivity (0-30) — use it or lose it?

| Device | Logic | Score |
|--------|-------|-------|
| EV | Might unplug; higher if SoC low and sun fading | 0-30 |
| HVAC | Pre-cool loses effectiveness as peak approaches | 20 at 11am → 0 by 5pm |
| Powerwall | Always available | 0-5 |

#### Ties broken by: EV > HVAC > Powerwall

EV might unplug, HVAC has diminishing returns into evening, PW is always available.

### Allocation Algorithm

```
every hour during off-peak/partial-peak:

  1. Compute surplus = solar - base_load

  2. Handle mandatory loads first (urgency = 100):
     - If surplus covers them → allocate from solar
     - If not → schedule grid import during cheapest remaining hour today

  3. Score remaining opportunistic loads

  4. Allocate remaining surplus to highest-scoring device
     - Respect device max rates (PW: 5kW, EV: 7.6kW, AC: ~3kW)
     - If surplus exceeds highest-scoring device's capacity, overflow to next

  5. If PW can shuttle (discharge now, refill later):
     - Allow PW discharge to boost EV/AC beyond direct solar
     - Only if can_refill check passes

  6. Any unallocated surplus → grid export (minimize this on NEM 3.0)
```

---

## Notifications

### EV Plug Reminder
```
Morning (7-9 AM):
  IF predicted_solar_surplus > 10 kWh today
  AND EV not plugged in (Smartcar status)
  → "Big solar day ahead (~Xh surplus). Plug in the BMW to soak up free energy."

Midday (11 AM):
  IF actual solar surplus > 3 kW right now
  AND EV not plugged in
  AND remaining surplus forecast > 8 kWh
  → "You're exporting X kW right now. Plug in the BMW to use it instead."
```

---

## Operating Modes by Time of Day

| Period | Solar | Behavior |
|--------|-------|----------|
| Off-peak + no solar (9pm-7am) | None | PW discharges above reserve to cover base load (maximize self-power). Grid only when PW hits reserve. EV charges to min% only if needed (cheapest hours). |
| Off-peak + solar (7am-4pm) | Active | **OPTIMIZE** — scorer runs, allocates surplus, PW shuttles |
| Peak (4pm-9pm) | Fading | **FIXED** — PW discharges, no EV, no AC, zero grid import goal |

---

## Data Flow

```
tesla_intervals (5-min polls, existing)
        ↓
predict.py → solar_forecast, load_forecast, temp_forecast (hourly, next 24h)
        ↓
score.py → score each device, allocate surplus, shuttle decisions
        ↓
act.py → send commands: Tesla API (PW), Nest SDM API (HVAC), Smartcar (EV SoC read)
        ↓
optimizer_log (new table) → every decision logged for transparency + activity feed
```

## File Structure

```
backend/
  optimizer/
    __init__.py
    predict.py      — solar_forecast(), load_forecast(), temp_forecast()
    backtest.py     — validate predictions against 90 days of actuals
    score.py        — score_loads(), allocate_surplus(), can_refill_pw()
    act.py          — send_commands() to Powerwall / Nest / Smartcar
    engine.py       — run_optimization() — the hourly loop
```

## Database Changes

New table: `optimizer_log`
```sql
CREATE TABLE optimizer_log (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id),
  ts TIMESTAMPTZ NOT NULL,
  action TEXT NOT NULL,           -- 'pw_charge', 'pw_discharge', 'ev_start', 'ev_pause', 'hvac_setpoint', 'hvac_eco'
  device TEXT NOT NULL,           -- 'powerwall', 'ev', 'nest'
  reason TEXT NOT NULL,           -- human-readable: "Solar surplus 4.2kW, PW can refill by 3pm"
  details JSONB,                  -- scores, predictions, state snapshot
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

New table: `optimizer_state`
```sql
CREATE TABLE optimizer_state (
  account_id INT PRIMARY KEY REFERENCES accounts(id),
  auto_mode BOOLEAN DEFAULT true,
  disabled_until TIMESTAMPTZ,     -- null = not disabled, timestamp = re-enable time
  pw_reserve_pct INT DEFAULT 20,
  comfort_min_f INT DEFAULT 68,
  comfort_max_f INT DEFAULT 78,
  ev_min_pct INT DEFAULT 60,
  ev_max_pct INT DEFAULT 90,
  device_overrides JSONB DEFAULT '{}',  -- {"nest": "2026-04-06T16:00:00Z", "ev": null, "powerwall": null}
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

New table: `weather_history`
```sql
CREATE TABLE weather_history (
  id SERIAL PRIMARY KEY,
  account_id INT REFERENCES accounts(id),
  ts TIMESTAMPTZ NOT NULL,
  cloud_cover_pct FLOAT,
  temp_f FLOAT,
  conditions TEXT,
  UNIQUE(account_id, ts)
);
```

Stores hourly weather observations for backtest validation and clear-sky normalization.
