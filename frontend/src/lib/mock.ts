import type {
  SummaryResponse,
  DailySummary,
  HourlyBucket,
  Alert,
} from "./api";

export const mockSummary: SummaryResponse = {
  current: {
    ts: new Date().toISOString(),
    solar_w: 4200,
    home_w: 1800,
    grid_w: -2100,
    battery_w: -300,
    battery_pct: 87,
    vehicle_w: 0,
  },
  today: {
    solar_generated_kwh: 28.4,
    total_import_kwh: 6.2,
    total_export_kwh: 12.8,
    total_cost: 2.14,
    peak_cost: 0.0,
    part_peak_cost: 0.0,
    off_peak_cost: 2.14,
    export_credit: 0.87,
  },
};

function makeDailySummary(daysAgo: number): DailySummary {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const base = 8 + Math.random() * 12;
  const peak = 1.5 + Math.random() * 4;
  const partPeak = 0.5 + Math.random() * 2;
  const offPeak = base - peak - partPeak;
  return {
    day: d.toISOString().split("T")[0],
    total_import_kwh: base,
    total_export_kwh: 8 + Math.random() * 10,
    solar_generated_kwh: 20 + Math.random() * 15,
    solar_self_consumed_kwh: 12 + Math.random() * 8,
    peak_import_kwh: peak,
    part_peak_import_kwh: partPeak,
    off_peak_import_kwh: offPeak,
    peak_cost: peak * 0.356,
    part_peak_cost: partPeak * 0.333,
    off_peak_cost: offPeak * 0.319,
    total_cost: peak * 0.356 + partPeak * 0.333 + offPeak * 0.319,
    export_credit: (8 + Math.random() * 10) * 0.068,
    ev_kwh: Math.random() > 0.5 ? 8 + Math.random() * 6 : 0,
    ev_peak_kwh: Math.random() > 0.7 ? 2 + Math.random() * 3 : 0,
    ev_off_peak_kwh: Math.random() > 0.5 ? 5 + Math.random() * 5 : 0,
    ev_cost: Math.random() * 3,
    battery_peak_coverage_pct: 60 + Math.random() * 40,
    battery_depletion_hour: Math.random() > 0.6 ? 19 + Math.random() * 2 : null,
    context_narrative: "Strong solar day with good battery coverage.",
    actions: [],
  };
}

export const mockDaily: DailySummary[] = Array.from({ length: 7 }, (_, i) =>
  makeDailySummary(i + 1)
);

export const mockHourly: HourlyBucket[] = Array.from({ length: 24 }, (_, h) => {
  const hour = new Date();
  hour.setHours(h, 0, 0, 0);
  const isSunny = h >= 7 && h <= 18;
  const solarPeak = h >= 10 && h <= 14;
  return {
    hour: hour.toISOString(),
    solar_w_avg: isSunny ? (solarPeak ? 4000 + Math.random() * 2000 : 1500 + Math.random() * 1500) : 0,
    home_w_avg: 800 + Math.random() * 1200 + (h >= 17 && h <= 21 ? 1500 : 0),
    grid_w_avg: isSunny ? -500 - Math.random() * 2000 : 500 + Math.random() * 1500,
    battery_w_avg: solarPeak ? 500 + Math.random() * 1000 : (h >= 17 ? -800 - Math.random() * 1200 : 0),
    battery_pct_avg: Math.min(100, 30 + (isSunny ? h * 5 : 100 - h * 3)),
    vehicle_w_avg: h >= 10 && h <= 12 ? 7000 : 0,
    grid_import_kwh: isSunny ? 0 : 0.5 + Math.random(),
    grid_export_kwh: isSunny ? 1 + Math.random() * 2 : 0,
    solar_kwh: isSunny ? (solarPeak ? 4 + Math.random() * 2 : 1 + Math.random() * 2) : 0,
  };
});

export const mockAlerts: Alert[] = [
  {
    id: 1,
    fired_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    alert_type: "solar_surplus",
    message:
      "You're exporting 4.2kW to the grid right now, earning ~$0.068/kWh. That same energy used at home is worth $0.319/kWh — 5x more valuable. Good time to run appliances or charge your EV.",
    metadata: { export_kw: 4.2, battery_pct: 98, import_rate: 0.319 },
  },
  {
    id: 2,
    fired_at: new Date(Date.now() - 86400000).toISOString(),
    alert_type: "solar_surplus",
    message:
      "You're exporting 3.8kW to the grid right now, earning ~$0.068/kWh. That same energy used at home is worth $0.319/kWh — 5x more valuable. Good time to run appliances or charge your EV.",
    metadata: { export_kw: 3.8, battery_pct: 96, import_rate: 0.319 },
  },
];
