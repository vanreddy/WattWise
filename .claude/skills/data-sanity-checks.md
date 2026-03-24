# Data Sanity Checks Skill

## When to use
Use this skill whenever working on:
- Data pipeline changes (poller, backfill, aggregator)
- Dashboard charts or analytics features
- API endpoints that serve data to the frontend
- Debugging data discrepancies or accuracy issues
- Any task involving data accuracy, computed values, or derived metrics

## Key module
`backend/data_sanity_checks.py` — the single source of truth for all validation logic.

## Three validation layers

### Layer 1: Interval-level (`validate_interval`)
- Called in `poller.py` before each INSERT
- Checks: NaN/Inf, solar non-negative, power range caps, battery % bounds, energy conservation, timestamp alignment
- **Threshold**: solar < 25kW, home < 50kW, battery < 15kW, energy balance within 5%

### Layer 2: Daily aggregate (`validate_daily_summary`)
- Called in `aggregator.py` after computing summary
- Checks: interval count (270-290), TOU import consistency, cost consistency, rate bounds ($0.05-$1.00/kWh), solar cap (200 kWh/day)
- **Key invariant**: peak + part_peak + off_peak = total_import (within 0.5 kWh)

### Layer 3: Flow conservation (`validate_sankey_flows`)
- Called in `api.py` after computing Sankey flows
- Checks: all flows non-negative, total sources ≈ total sinks (within 5%)
- `validate_cross_chart_consistency` — ensures Sankey and hourly chart totals agree (within 2%)

### Database checks (`run_daily_sanity_check`)
- Checks for duplicate timestamps, gaps > 10 min, and all Layer 2 checks
- Can be run on-demand per account per day

## When modifying data code, always:
1. Run existing sanity checks mentally against your changes
2. Add new checks if introducing new computed values
3. Ensure energy conservation: sources = sinks at every level
4. Verify cross-chart consistency if changing how any chart queries data
5. Log warnings (never silently swallow data issues)

## Constants to remember
- 288 intervals per day (24h × 12)
- INTERVAL_HOURS = 5/60 (5 minutes)
- Energy conservation tolerance: 5%
- Cross-chart tolerance: 2%
- All energy data flows from `tesla_intervals` table (single source of truth)
