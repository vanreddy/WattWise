"use client";

import { useState, useEffect } from "react";
import { api, type DailySummary } from "@/lib/api";

/* ─── Types ──────────────────────────────────── */

export type ReportStatus = "fetching" | "insufficient" | "ready";

export interface ReportChip {
  dotColor: "red" | "amber" | "green";
  name: string;
  saving: string;
  savingLow: number;
  savingHigh: number;
  finding: string;
  action: string;
}

export interface HealthReport {
  generatedAt: string;       // ISO timestamp
  isWeeklyUpdate: boolean;
  days: number;
  periodLabel: string;
  narrative: string;
  chips: ReportChip[];
  potentialLow: number;
  potentialHigh: number;
}

interface StoredPayload {
  version: number;
  reports: HealthReport[]; // newest first — never shrinks
}

const STORE_KEY = "wattwise_health_report_v3";
const STORE_VERSION = 3;
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // add a new entry weekly

/* ─── Analysis ───────────────────────────────── */

function buildReport(daily: DailySummary[], prevReport: HealthReport | null): HealthReport {
  const days = daily.length;
  const isWeeklyUpdate = prevReport !== null;

  // Aggregate totals
  const totalCost    = daily.reduce((s, d) => s + d.total_cost, 0);
  const totalCredit  = daily.reduce((s, d) => s + d.export_credit, 0);
  const totalEvCost  = daily.reduce((s, d) => s + d.ev_cost, 0);
  const totalEvKwh   = daily.reduce((s, d) => s + d.ev_kwh, 0);
  const totalEvPeak  = daily.reduce((s, d) => s + d.ev_peak_kwh, 0);
  const totalSolarGen  = daily.reduce((s, d) => s + d.solar_generated_kwh, 0);
  const totalSolarSelf = daily.reduce((s, d) => s + d.solar_self_consumed_kwh, 0);
  const totalExport    = daily.reduce((s, d) => s + d.total_export_kwh, 0);
  const totalPeakImport = daily.reduce((s, d) => s + d.peak_import_kwh, 0);

  const avgDailyCost   = (totalCost - totalCredit) / days;
  const selfConsumePct = totalSolarGen > 0 ? (totalSolarSelf / totalSolarGen) * 100 : 0;
  const evBillPct      = totalCost > 0 ? (totalEvCost / totalCost) * 100 : 0;

  const daysWithBatt = daily.filter(d => d.battery_peak_coverage_pct !== null);
  const battAvgCoverage = daysWithBatt.length > 0
    ? daysWithBatt.reduce((s, d) => s + (d.battery_peak_coverage_pct ?? 0), 0) / daysWithBatt.length
    : 0;
  const daysWithPoorCoverage = daily.filter(d => (d.battery_peak_coverage_pct ?? 0) < 40).length;

  // Period label
  const oldest = daily[daily.length - 1]?.day;
  const newest = daily[0]?.day;
  const periodLabel = oldest && newest
    ? `${new Date(oldest + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${new Date(newest + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
    : `${days} days`;

  /* ── Build chips ── */
  const chips: ReportChip[] = [];

  // 1. EV charging timing
  const evDays = daily.filter(d => d.ev_kwh > 5);
  const avgEvKwh = evDays.length > 0 ? totalEvKwh / evDays.length : 0;
  const evDaysPerMonth = Math.round((evDays.length / days) * 30);
  const evSavingLow  = Math.round(evDaysPerMonth * avgEvKwh * 0.20);
  const evSavingHigh = Math.round(evDaysPerMonth * avgEvKwh * 0.30);

  if (evBillPct > 10 || totalEvPeak > 5) {
    chips.push({
      dotColor: "red",
      name: "Charge EV during solar hours",
      saving: evSavingLow > 0 ? `$${evSavingLow}–${evSavingHigh}/mo` : "Significant",
      savingLow: evSavingLow,
      savingHigh: evSavingHigh,
      finding: evBillPct > 5
        ? `EV charging is ${evBillPct.toFixed(0)}% of your electricity bill — averaging ${avgEvKwh.toFixed(1)} kWh per session, mostly overnight at $0.32/kWh. Solar between 10 am–2 pm is effectively free.`
        : `Your EV charged ${totalEvKwh.toFixed(0)} kWh total over ${days} days. Shifting to solar hours saves ~$0.25 per kWh versus overnight grid charging.`,
      action: "Tesla app → Charging → Schedule: set departure time to 9 am. The car tops up during peak solar, not overnight.",
    });
  }

  // 2. Powerwall peak coverage
  const battSavingLow  = Math.round(totalPeakImport / days * 0.356 * 0.5 * 30);
  const battSavingHigh = Math.round(totalPeakImport / days * 0.356 * 0.8 * 30);

  if (battAvgCoverage < 70 || daysWithPoorCoverage > days * 0.3) {
    chips.push({
      dotColor: battAvgCoverage < 40 ? "red" : "amber",
      name: "Maximize Powerwall peak coverage",
      saving: battSavingLow > 0 ? `$${battSavingLow}–${battSavingHigh}/mo` : "~$15–25/mo",
      savingLow: battSavingLow,
      savingHigh: battSavingHigh,
      finding: `Powerwall covered ${battAvgCoverage.toFixed(0)}% of peak hours on average across ${days} days. On ${daysWithPoorCoverage} days it fell short of the full 4–9 pm window, leaving you on grid at $0.356/kWh.`,
      action: "Tesla app → Powerwall → Time-Based Control. Lower reserve to 10% — frees ~1.4 kWh of extra peak dispatch capacity.",
    });
  }

  // 3. Flexible loads / self-consumption
  const avgExportKwh = totalExport / days;
  const loadSavingLow  = Math.round(avgExportKwh * (0.319 - 0.068) * 0.12 * 30);
  const loadSavingHigh = loadSavingLow + 6;

  if (selfConsumePct < 70 && avgExportKwh > 3) {
    chips.push({
      dotColor: "green",
      name: "Shift flexible loads to solar hours",
      saving: loadSavingLow > 3 ? `~$${loadSavingLow}/mo` : "~$5–10/mo",
      savingLow: loadSavingLow,
      savingHigh: loadSavingHigh,
      finding: `Only ${selfConsumePct.toFixed(0)}% of solar was consumed on-site. You exported ${avgExportKwh.toFixed(1)} kWh/day at $0.07 — power that could have offset $0.32/kWh imports (a 5× value difference).`,
      action: "Set dishwasher, washer/dryer, and pool pump timers to 10 am. No app needed — appliance timer schedules.",
    });
  }

  // Fallback third chip if needed
  if (chips.length < 3) {
    chips.push({
      dotColor: "green",
      name: "Lower Powerwall reserve to 10%",
      saving: "~$5–10/mo",
      savingLow: 5,
      savingHigh: 10,
      finding: `Each percent of reserve locks away ~0.14 kWh. At 20% reserve, ~1.4 kWh never dispatches during peak. Reducing to 10% extends your evening coverage window.`,
      action: "Tesla app → Powerwall → Energy Reserve: drag slider to 10%.",
    });
  }

  const finalChips = chips.slice(0, 3);
  const potentialLow  = finalChips.reduce((s, c) => s + c.savingLow, 0);
  const potentialHigh = finalChips.reduce((s, c) => s + c.savingHigh, 0);

  /* ── Narrative ── */
  let narrative: string;

  if (isWeeklyUpdate) {
    const recentWeek = daily.slice(0, 7);
    const weekNet = recentWeek.reduce((s, d) => s + d.total_cost - d.export_credit, 0) / 7;
    const trend = weekNet < avgDailyCost - 0.25 ? "down" : weekNet > avgDailyCost + 0.25 ? "up" : "steady";
    const trendDesc = trend === "down"
      ? `down from your ${days}-day average of $${avgDailyCost.toFixed(2)}`
      : trend === "up"
        ? `up from your ${days}-day average of $${avgDailyCost.toFixed(2)}`
        : `on par with your ${days}-day average`;
    narrative = `This week averaged $${weekNet.toFixed(2)}/day net — ${trendDesc}. ${evBillPct > 25
      ? `EV charging is still ${evBillPct.toFixed(0)}% of your bill — the biggest lever remains timing your charges.`
      : `Solar self-consumption is at ${selfConsumePct.toFixed(0)}% — shifting a few loads to midday could push that above 70%.`}`;
  } else if (evBillPct > 30) {
    narrative = `Your solar is strong, but ${(100 - selfConsumePct).toFixed(0)}% leaves at $0.07/kWh while you import at nearly 5× that rate. EV charging alone drives ${evBillPct.toFixed(0)}% of your electricity bill — and it's happening overnight when solar can't help.`;
  } else if (selfConsumePct < 50) {
    narrative = `Only ${selfConsumePct.toFixed(0)}% of your solar is consumed on-site under NEM 3.0. The Powerwall and EV are your best tools to capture the rest — but both need to run at the right time to avoid exporting at $0.07/kWh.`;
  } else if (battAvgCoverage < 45) {
    narrative = `Your solar utilization is solid at ${selfConsumePct.toFixed(0)}%, but the Powerwall covers only ${battAvgCoverage.toFixed(0)}% of peak hours on average. Getting that above 80% on non-EV days would eliminate most peak grid costs.`;
  } else {
    narrative = `Your system is performing well — ${selfConsumePct.toFixed(0)}% solar self-consumption and ${battAvgCoverage.toFixed(0)}% average peak coverage. The clearest remaining opportunity is timing EV charges to solar hours.`;
  }

  return {
    generatedAt: new Date().toISOString(),
    isWeeklyUpdate,
    days,
    periodLabel,
    narrative,
    chips: finalChips,
    potentialLow,
    potentialHigh,
  };
}

/* ─── Hook ───────────────────────────────────── */

export function useHealthReport(): { status: ReportStatus; reports: HealthReport[] } {
  const [status, setStatus] = useState<ReportStatus>("fetching");
  const [reports, setReports] = useState<HealthReport[]>([]);

  useEffect(() => {
    const run = async () => {
      // Load stored timeline
      let stored: HealthReport[] = [];
      try {
        const payload = JSON.parse(localStorage.getItem(STORE_KEY) || "null") as StoredPayload | null;
        if (payload?.version === STORE_VERSION && Array.isArray(payload.reports)) {
          stored = payload.reports;
        }
      } catch { /* ignore */ }

      // If we have reports and the newest is still fresh, return as-is
      if (stored.length > 0) {
        const newest = new Date(stored[0].generatedAt).getTime();
        if (Date.now() - newest < REFRESH_MS) {
          setReports(stored);
          setStatus("ready");
          return;
        }
      }

      // Need a new entry — fetch 90 days
      const to   = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 90);

      let daily: DailySummary[] = [];
      try {
        daily = await api.getDaily(from.toISOString().split("T")[0], to.toISOString().split("T")[0]);
      } catch {
        // If fetch fails but we have old reports, still show them
        if (stored.length > 0) {
          setReports(stored);
          setStatus("ready");
        }
        return;
      }

      if (daily.length < 7) {
        setStatus("insufficient");
        return;
      }

      // Build and prepend — old entries stay intact
      const prevReport = stored.length > 0 ? stored[0] : null;
      const newReport  = buildReport(daily, prevReport);
      const updated    = [newReport, ...stored];

      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ version: STORE_VERSION, reports: updated } satisfies StoredPayload));
      } catch { /* ignore */ }

      setReports(updated);
      setStatus("ready");
    };

    run();
  }, []);

  return { status, reports };
}
