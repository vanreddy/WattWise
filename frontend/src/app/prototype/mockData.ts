import type {
  CurrentPower,
  HourlyBucket,
  DailySummary,
  SankeyFlows,
  Alert,
} from "@/lib/api";

// ── Real-time power snapshot (midday, solar producing well) ─────────
export const MOCK_CURRENT: CurrentPower = {
  ts: new Date().toISOString(),
  solar_w: 4850,
  home_w: 2100,
  grid_w: -1200, // negative = exporting
  battery_w: -1550, // negative = charging
  battery_pct: 87,
  vehicle_w: 0,
};

// ── Sankey flows (kWh totals for the day so far) ────────────────────
export const MOCK_SANKEY: SankeyFlows = {
  solar_to_home: 14.2,
  solar_to_battery: 6.8,
  solar_to_grid: 5.3,
  battery_to_home: 4.1,
  battery_to_grid: 0.2,
  grid_to_home: 2.8,
  grid_to_battery: 0.3,
};

// ── 24-hour buckets ─────────────────────────────────────────────────
export const MOCK_HOURLY: HourlyBucket[] = Array.from({ length: 24 }, (_, i) => {
  const hour = i;
  // Solar bell curve peaking at noon
  const solarBase = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI) * 5500);
  const solarW = hour >= 6 && hour <= 18 ? solarBase : 0;

  // Home consumption: base + morning/evening peaks + EV overnight
  const homeBase = 800;
  const morningPeak = hour >= 7 && hour <= 9 ? 1200 : 0;
  const eveningPeak = hour >= 17 && hour <= 21 ? 2000 : 0;
  const evCharge = hour >= 22 || hour <= 5 ? 1500 : 0;
  const homeW = homeBase + morningPeak + eveningPeak + evCharge;
  const vehicleW = evCharge;

  // Grid: import when solar < home, export when excess
  const surplus = solarW - homeW;
  const gridW = surplus < 0 ? Math.abs(surplus) * 0.6 : -surplus * 0.4;

  // Battery: charge during solar peak, discharge evening
  const batteryW =
    hour >= 10 && hour <= 15
      ? -(solarW * 0.25) // charging
      : hour >= 17 && hour <= 21
        ? 1200 // discharging
        : 0;

  const batteryPct =
    hour <= 6 ? 40 :
    hour <= 15 ? 40 + (hour - 6) * 6.5 :
    hour <= 21 ? 98 - (hour - 15) * 10 :
    38;

  // Energy sums (kWh per hour ≈ watts / 1000)
  const solarKwh = solarW / 1000;
  const gridImportKwh = gridW > 0 ? gridW / 1000 : 0;
  const gridExportKwh = gridW < 0 ? Math.abs(gridW) / 1000 : 0;
  const batteryDischargeKwh = batteryW > 0 ? batteryW / 1000 : 0;
  const batteryChargeKwh = batteryW < 0 ? Math.abs(batteryW) / 1000 : 0;
  const homeKwh = homeW / 1000;

  const today = new Date().toISOString().slice(0, 10);

  return {
    hour: `${today}T${hour.toString().padStart(2, "0")}:00:00`,
    solar_w_avg: Math.round(solarW),
    home_w_avg: Math.round(homeW),
    grid_w_avg: Math.round(gridW),
    battery_w_avg: Math.round(batteryW),
    battery_pct_avg: Math.round(batteryPct),
    vehicle_w_avg: Math.round(vehicleW),
    solar_kwh: Math.round(solarKwh * 100) / 100,
    grid_import_kwh: Math.round(gridImportKwh * 100) / 100,
    grid_export_kwh: Math.round(gridExportKwh * 100) / 100,
    battery_discharge_kwh: Math.round(batteryDischargeKwh * 100) / 100,
    battery_charge_kwh: Math.round(batteryChargeKwh * 100) / 100,
    home_kwh: Math.round(homeKwh * 100) / 100,
  };
});

// ── Daily summary (today) ───────────────────────────────────────────
export const MOCK_DAILY: DailySummary[] = [
  {
    day: new Date().toISOString().slice(0, 10),
    total_import_kwh: 3.1,
    total_export_kwh: 5.3,
    solar_generated_kwh: 26.3,
    solar_self_consumed_kwh: 21.0,
    peak_import_kwh: 0.8,
    part_peak_import_kwh: 1.2,
    off_peak_import_kwh: 1.1,
    peak_cost: 0.42,
    part_peak_cost: 0.48,
    off_peak_cost: 0.31,
    total_cost: 1.21,
    export_credit: 2.83,
    ev_kwh: 8.2,
    ev_peak_kwh: 0,
    ev_off_peak_kwh: 8.2,
    ev_cost: 0,
    battery_peak_coverage_pct: 92,
    battery_depletion_hour: null,
    context_narrative: "Excellent solar day with 26.3 kWh generated. Battery covered 92% of peak hours.",
    actions: [],
  },
];

// ── Alerts ───────────────────────────────────────────────────────────
export const MOCK_ALERTS: Alert[] = [
  {
    id: 1,
    fired_at: new Date(Date.now() - 3 * 3600000).toISOString(),
    alert_type: "solar_peak",
    message: "Solar production peaked at 6.2 kW at 12:34 PM",
    metadata: null,
  },
  {
    id: 2,
    fired_at: new Date(Date.now() - 2.5 * 3600000).toISOString(),
    alert_type: "battery_full",
    message: "Battery fully charged, exporting excess to grid",
    metadata: null,
  },
  {
    id: 3,
    fired_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    alert_type: "grid_import",
    message: "Grid import detected during cloud cover (2.1 kW)",
    metadata: null,
  },
  {
    id: 4,
    fired_at: new Date(Date.now() - 9 * 3600000).toISOString(),
    alert_type: "ev_charging",
    message: "EV charging session started via Wall Connector",
    metadata: null,
  },
];
