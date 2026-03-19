"""
WattWise rate engine for MCE + PG&E TOU rates.

Rate plan: E-TOU-D (MCE generation + PG&E delivery combined rates).

Winter (Oct 1 – May 31):
  Peak:      4pm–9pm every day        $0.356/kWh
  Part Peak: 3pm–4pm and 9pm–12am     $0.333/kWh
  Off Peak:  12am–3pm                 $0.319/kWh

Summer (Jun 1 – Sep 30):
  Peak:      5pm–8pm weekdays only    $0.796/kWh
  Off Peak:  all other hours          $0.561/kWh

Export (NEM 3.0): flat $0.068/kWh estimate.
"""

from datetime import datetime

# --- Rate constants ---

WINTER_RATES = {
    "peak": 0.356,
    "part_peak": 0.333,
    "off_peak": 0.319,
}

SUMMER_RATES = {
    "peak": 0.796,
    "off_peak": 0.561,
}

EXPORT_RATE = 0.068

# Fixed monthly charges
BASE_SERVICE_CHARGE = 24.00
PCIA_ESTIMATE = 24.00
CLIMATE_CREDIT = 58.00
CLIMATE_CREDIT_MONTHS = {4, 10}  # April and October


def is_summer(dt: datetime) -> bool:
    """True for June 1 through September 30."""
    return 6 <= dt.month <= 9


def get_tou_period(dt: datetime) -> str:
    """Return 'peak', 'part_peak', or 'off_peak' for a given datetime."""
    hour = dt.hour

    if is_summer(dt):
        # Summer: peak 5pm–8pm weekdays only (hour 17, 18, 19)
        if dt.weekday() < 5 and 17 <= hour < 20:
            return "peak"
        return "off_peak"
    else:
        # Winter: peak 4pm–9pm every day (hour 16–20)
        if 16 <= hour < 21:
            return "peak"
        # Part peak: 3pm–4pm (hour 15) and 9pm–12am (hour 21, 22, 23)
        if hour == 15 or 21 <= hour <= 23:
            return "part_peak"
        # Off peak: 12am–3pm (hour 0–14)
        return "off_peak"


def get_import_rate(dt: datetime) -> float:
    """Return the combined $/kWh import rate for a given datetime."""
    period = get_tou_period(dt)
    if is_summer(dt):
        return SUMMER_RATES[period]
    return WINTER_RATES[period]


def is_peak_window(dt: datetime) -> bool:
    """True if the given datetime falls in a peak TOU period."""
    return get_tou_period(dt) == "peak"


def get_export_rate() -> float:
    """Return the flat NEM 3.0 export credit rate."""
    return EXPORT_RATE


def get_fixed_monthly_charges(month: int) -> float:
    """Return total fixed charges for a given month (1–12)."""
    total = BASE_SERVICE_CHARGE + PCIA_ESTIMATE
    if month in CLIMATE_CREDIT_MONTHS:
        total -= CLIMATE_CREDIT
    return total
