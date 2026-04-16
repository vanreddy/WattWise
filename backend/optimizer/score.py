"""
Scoring and allocation: compute surplus, score devices, allocate energy.

Peak hours (4-9 PM): fixed behavior — PW discharge, no EV, no HVAC.
Off-peak: dynamic scoring with urgency + economic_value + time_sensitivity.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("America/Los_Angeles")

logger = logging.getLogger(__name__)

# ─── TOU Rate Schedule (E-TOU-D simplified) ───

PEAK_START = 16     # 4 PM
PEAK_END = 21       # 9 PM
PEAK_RATE = 0.356   # $/kWh
PARTIAL_PEAK_RATE = 0.290
OFF_PEAK_RATE = 0.168
EXPORT_RATE = 0.07  # NEM 3.0 average export credit

# Device max power draw (watts)
PW_MAX_W = 5000     # Powerwall max charge/discharge
EV_MAX_W = 7600     # Tesla Wall Connector (240V 32A)
AC_MAX_W = 3500     # Typical central AC draw

PW_CAPACITY_KWH = 13.5  # Powerwall usable capacity


def is_peak_hour(hour: int) -> bool:
    return PEAK_START <= hour < PEAK_END


def rate_at_hour(hour: int) -> float:
    if is_peak_hour(hour):
        return PEAK_RATE
    elif 15 <= hour < PEAK_START or PEAK_END <= hour < 22:
        return PARTIAL_PEAK_RATE
    else:
        return OFF_PEAK_RATE


# ─── Device State ───

@dataclass
class DeviceState:
    # Powerwall
    pw_soc_pct: float = 50.0
    pw_power_w: float = 0.0       # positive = charging

    # EV
    ev_soc_pct: float = 80.0
    ev_plugged_in: bool = False
    ev_charging: bool = False

    # HVAC (average across thermostats)
    indoor_temp_f: float = 74.0
    hvac_mode: str = "OFF"        # COOL, HEAT, ECO, OFF
    hvac_setpoint_f: float = 72.0

    # User controls
    pw_reserve_pct: float = 20.0
    comfort_min_f: float = 68.0
    comfort_max_f: float = 78.0
    ev_min_pct: float = 60.0
    ev_max_pct: float = 90.0


@dataclass
class HourPlan:
    """What to do in a specific hour."""
    hour: int
    is_peak: bool

    # Actions
    pw_action: str = "idle"       # "charge", "discharge", "idle"
    pw_target_w: float = 0.0

    ev_action: str = "idle"       # "charge", "idle"
    ev_target_w: float = 0.0

    hvac_action: str = "idle"     # "precool", "eco", "idle"
    hvac_setpoint_f: Optional[float] = None

    # Metadata
    surplus_w: float = 0.0
    solar_w: float = 0.0
    base_load_w: float = 0.0
    reason: str = ""


@dataclass
class DayPlan:
    """Full 24-hour optimization plan."""
    hours: list[HourPlan] = field(default_factory=list)
    generated_at: Optional[datetime] = None
    total_solar_kwh: float = 0.0
    total_savings_est: float = 0.0


# ─── PW Shuttle: can we refill? ───

def can_refill_pw(
    current_hour_offset: int,
    solar_predictions: dict[int, float],
    base_load_predictions: dict[int, float],
    pw_soc_pct: float,
    pw_reserve_pct: float,
) -> bool:
    """Check if enough future solar exists to refill PW after discharging now.

    The PW needs to reach ~90% by peak start (4 PM) for evening discharge.
    """
    # How much energy PW needs (kWh) to go from current to 90%
    needed_kwh = (90.0 - pw_soc_pct) / 100.0 * PW_CAPACITY_KWH
    if needed_kwh <= 0:
        return True  # Already full enough

    # Sum future surplus from now until peak
    future_surplus_kwh = 0.0
    for offset in range(current_hour_offset + 1, 24):
        hour = offset % 24
        if is_peak_hour(hour):
            break
        surplus_w = solar_predictions.get(offset, 0) - base_load_predictions.get(offset, 0)
        if surplus_w > 0:
            future_surplus_kwh += surplus_w / 1000.0  # W → kWh (1 hour)

    return future_surplus_kwh >= needed_kwh * 1.1  # 10% safety margin


# ─── Scoring ───

def score_device(
    device: str,
    state: DeviceState,
    hour: int,
    surplus_w: float,
    solar_predictions: dict[int, float],
    base_load_predictions: dict[int, float],
    current_offset: int,
) -> float:
    """Score a device for this hour. Higher = allocate surplus first."""

    # ── Urgency (0 or 100) ──
    urgency = 0.0

    if device == "powerwall":
        if state.pw_soc_pct < state.pw_reserve_pct:
            urgency = 100.0

    elif device == "ev":
        if state.ev_plugged_in and state.ev_soc_pct < state.ev_min_pct:
            urgency = 100.0

    elif device == "hvac":
        if state.indoor_temp_f > state.comfort_max_f:
            urgency = 100.0

    # ── Economic Value (0-50) ──
    economic = 0.0
    current_rate = rate_at_hour(hour)

    if device == "powerwall":
        # Value = what PW can save during peak discharge - energy cost now
        pw_value = PEAK_RATE * 0.9  # 90% round-trip efficiency
        energy_cost_now = 0.0 if surplus_w > 0 else current_rate  # Free if from solar
        economic = min(50.0, (pw_value - energy_cost_now) * 100)

        # Scarcity adjustment
        total_future_solar = sum(max(0, solar_predictions.get(o, 0)) for o in range(current_offset, 24))
        total_sink = PW_CAPACITY_KWH * 1000 + (EV_MAX_W if state.ev_plugged_in else 0) + AC_MAX_W
        scarcity = 1.0 - min(1.0, total_future_solar / max(1, total_sink))
        economic *= (0.5 + 0.5 * scarcity)

    elif device == "ev":
        # Value = cheapest future grid rate - cost now
        cheapest_future = min(rate_at_hour(h) for h in range(24) if not is_peak_hour(h))
        energy_cost_now = 0.0 if surplus_w > 0 else current_rate
        economic = min(50.0, (cheapest_future - energy_cost_now + 0.15) * 100)

    elif device == "hvac":
        # Value = peak AC hours avoided × peak rate / energy to precool now
        hours_to_peak = max(0, PEAK_START - hour)
        peak_hours = PEAK_END - PEAK_START  # 5 hours
        if hours_to_peak > 0 and state.indoor_temp_f < state.comfort_max_f:
            avoided_kwh = AC_MAX_W / 1000 * min(peak_hours, 3)  # Rough: 3 hours coast
            economic = min(50.0, avoided_kwh * PEAK_RATE * 10)

    # ── Time Sensitivity (0-30) ──
    time_sens = 0.0

    if device == "ev":
        # EV might unplug; higher if SoC low and sun fading
        if state.ev_soc_pct < state.ev_min_pct:
            time_sens = 30.0
        elif state.ev_soc_pct < state.ev_max_pct:
            hours_of_sun_left = sum(1 for o in range(current_offset, 24)
                                    if solar_predictions.get(o, 0) > 500)
            time_sens = min(30.0, max(0, 20.0 - hours_of_sun_left * 3))

    elif device == "hvac":
        # Pre-cool loses effectiveness as peak approaches
        hours_to_peak = max(0, PEAK_START - hour)
        if hours_to_peak > 0:
            time_sens = min(20.0, hours_to_peak * 4)

    elif device == "powerwall":
        time_sens = 5.0  # Always available, low urgency

    total = urgency + economic + time_sens
    return round(total, 1)


# ─── Plan Generation ───

def generate_plan(
    state: DeviceState,
    solar_predictions: dict[int, float],
    base_load_predictions: dict[int, float],
    temp_predictions: dict[int, float],
    now: Optional[datetime] = None,
) -> DayPlan:
    """Generate a 24-hour optimization plan.

    For each hour: compute surplus, score devices, allocate energy.
    Peak hours get fixed behavior (no scoring).
    """
    now = now or datetime.now(timezone.utc)
    local_hour = now.astimezone(LOCAL_TZ).hour
    plan = DayPlan(generated_at=now)
    total_savings = 0.0

    # Track PW SoC through the plan
    pw_soc = state.pw_soc_pct
    ev_soc = state.ev_soc_pct

    for offset in range(24):
        hour = (local_hour + offset) % 24
        solar_w = solar_predictions.get(offset, 0.0)
        base_w = base_load_predictions.get(offset, 0.0)
        surplus_w = solar_w - base_w

        hp = HourPlan(
            hour=hour,
            is_peak=is_peak_hour(hour),
            solar_w=solar_w,
            base_load_w=base_w,
            surplus_w=surplus_w,
        )

        plan.total_solar_kwh += solar_w / 1000.0

        # ─── PEAK HOURS: Fixed behavior ───
        if is_peak_hour(hour):
            hp.ev_action = "idle"
            hp.hvac_action = "eco"
            hp.hvac_setpoint_f = state.comfort_max_f

            # PW discharges to cover deficit
            deficit_w = max(0, base_w - solar_w)
            pw_available_w = max(0, (pw_soc - state.pw_reserve_pct) / 100.0 * PW_CAPACITY_KWH * 1000)
            discharge_w = min(deficit_w, PW_MAX_W, pw_available_w)

            if discharge_w > 0:
                hp.pw_action = "discharge"
                hp.pw_target_w = -discharge_w
                pw_soc -= (discharge_w / 1000.0) / PW_CAPACITY_KWH * 100
                savings = discharge_w / 1000.0 * PEAK_RATE
                total_savings += savings
                hp.reason = f"Peak: PW discharging {discharge_w/1000:.1f}kW to avoid ${savings:.2f} grid import"
            else:
                hp.pw_action = "idle"
                hp.reason = "Peak: PW at reserve, grid covering deficit"

            plan.hours.append(hp)
            continue

        # ─── OFF-PEAK / PARTIAL-PEAK: Dynamic scoring ───

        if surplus_w <= 0:
            # No surplus — check mandatory loads that need grid
            if state.ev_plugged_in and ev_soc < state.ev_min_pct:
                # Schedule EV charge during cheapest remaining off-peak hour
                cheapest_hour = min(
                    (h for h in range(24) if not is_peak_hour(h)),
                    key=lambda h: rate_at_hour(h)
                )
                if hour == cheapest_hour:
                    hp.ev_action = "charge"
                    hp.ev_target_w = EV_MAX_W
                    hp.reason = f"Mandatory: EV at {ev_soc:.0f}% < {state.ev_min_pct:.0f}% min, charging at cheapest rate"

            # PW discharges above reserve during off-peak+no-solar to cover base load
            if solar_w < 100 and pw_soc > state.pw_reserve_pct + 5:
                discharge_w = min(abs(surplus_w), PW_MAX_W,
                                  (pw_soc - state.pw_reserve_pct) / 100.0 * PW_CAPACITY_KWH * 1000)
                if discharge_w > 200:
                    hp.pw_action = "discharge"
                    hp.pw_target_w = -discharge_w
                    pw_soc -= (discharge_w / 1000.0) / PW_CAPACITY_KWH * 100
                    hp.reason = f"Off-peak no-solar: PW self-powering at {discharge_w/1000:.1f}kW"

            plan.hours.append(hp)
            continue

        # ─── SURPLUS: Score and allocate ───
        remaining_surplus = surplus_w

        # Score all devices
        scores = {}
        for device in ["powerwall", "ev", "hvac"]:
            # Skip devices that can't absorb
            if device == "ev" and (not state.ev_plugged_in or ev_soc >= state.ev_max_pct):
                continue
            if device == "powerwall" and pw_soc >= 99:
                continue
            if device == "hvac" and state.indoor_temp_f <= state.comfort_min_f:
                continue

            s = score_device(
                device, state, hour, surplus_w,
                solar_predictions, base_load_predictions, offset,
            )
            scores[device] = s

        # Allocate in score order
        reasons = []
        for device, score in sorted(scores.items(), key=lambda x: -x[1]):
            if remaining_surplus <= 100:  # <100W not worth allocating
                break

            if device == "powerwall":
                alloc = min(remaining_surplus, PW_MAX_W)
                hp.pw_action = "charge"
                hp.pw_target_w = alloc
                pw_soc += (alloc / 1000.0) / PW_CAPACITY_KWH * 100
                pw_soc = min(100.0, pw_soc)
                remaining_surplus -= alloc
                reasons.append(f"PW charge {alloc/1000:.1f}kW (score:{score:.0f})")

            elif device == "ev":
                alloc = min(remaining_surplus, EV_MAX_W)

                # Can PW shuttle boost this?
                if alloc < EV_MAX_W and can_refill_pw(
                    offset, solar_predictions, base_load_predictions,
                    pw_soc, state.pw_reserve_pct
                ):
                    pw_boost = min(PW_MAX_W, EV_MAX_W - alloc,
                                   (pw_soc - state.pw_reserve_pct) / 100.0 * PW_CAPACITY_KWH * 1000)
                    if pw_boost > 500:
                        alloc += pw_boost
                        pw_soc -= (pw_boost / 1000.0) / PW_CAPACITY_KWH * 100
                        reasons.append(f"PW shuttle +{pw_boost/1000:.1f}kW to EV")

                hp.ev_action = "charge"
                hp.ev_target_w = alloc
                ev_soc += (alloc / 1000.0) / 120.0 * 100  # ~120kWh BMW iX battery
                ev_soc = min(state.ev_max_pct, ev_soc)
                remaining_surplus -= min(remaining_surplus, alloc)
                reasons.append(f"EV charge {alloc/1000:.1f}kW (score:{score:.0f})")

            elif device == "hvac":
                # Pre-cool: set thermostat lower
                if state.indoor_temp_f > state.comfort_min_f + 2:
                    hp.hvac_action = "precool"
                    hp.hvac_setpoint_f = max(state.comfort_min_f, state.indoor_temp_f - 4)
                    alloc = min(remaining_surplus, AC_MAX_W)
                    remaining_surplus -= alloc
                    reasons.append(f"Pre-cool to {hp.hvac_setpoint_f:.0f}°F (score:{score:.0f})")

        if reasons:
            hp.reason = "Surplus: " + ", ".join(reasons)
        else:
            hp.reason = f"Surplus {surplus_w/1000:.1f}kW — exporting (no absorbers available)"

        plan.hours.append(hp)

    plan.total_savings_est = round(total_savings, 2)
    return plan


def plan_to_timeline(plan: DayPlan) -> list[dict]:
    """Convert a DayPlan into timeline segments for the frontend.

    Collapses consecutive same-action hours into segments:
    [{action: "pw_charge", start_hour: 6, end_hour: 12, color: "yellow", label: "Charge PW"}, ...]
    """
    ACTION_META = {
        "pw_charge":    {"color": "yellow",  "label": "Charge PW"},
        "pw_discharge": {"color": "green",   "label": "PW Discharge"},
        "ev_charge":    {"color": "purple",  "label": "Charge EV"},
        "hvac_precool": {"color": "blue",    "label": "Pre-cool"},
        "hvac_eco":     {"color": "gray",    "label": "Eco Mode"},
        "idle":         {"color": "neutral",  "label": ""},
    }

    segments: list[dict] = []
    current_action = None
    start_hour = 0

    for hp in plan.hours:
        # Determine primary action for this hour
        if hp.pw_action == "charge":
            action = "pw_charge"
        elif hp.pw_action == "discharge":
            action = "pw_discharge"
        elif hp.ev_action == "charge":
            action = "ev_charge"
        elif hp.hvac_action == "precool":
            action = "hvac_precool"
        elif hp.hvac_action == "eco":
            action = "hvac_eco"
        else:
            action = "idle"

        if action != current_action:
            if current_action and current_action != "idle":
                meta = ACTION_META.get(current_action, ACTION_META["idle"])
                segments.append({
                    "action": current_action,
                    "start_hour": start_hour,
                    "end_hour": hp.hour,
                    "color": meta["color"],
                    "label": meta["label"],
                })
            current_action = action
            start_hour = hp.hour

    # Close last segment
    if current_action and current_action != "idle" and plan.hours:
        meta = ACTION_META.get(current_action, ACTION_META["idle"])
        segments.append({
            "action": current_action,
            "start_hour": start_hour,
            "end_hour": (plan.hours[-1].hour + 1) % 24,
            "color": meta["color"],
            "label": meta["label"],
        })

    return segments
