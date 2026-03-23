"use client";

import { useMemo } from "react";
import { GitBranch } from "lucide-react";
import type { HourlyBucket, DailySummary, SankeyFlows } from "@/lib/api";

interface Flow {
  from: string;
  to: string;
  value: number;
  color: string;
}

interface NodeInfo {
  label: string;
  total: number;
  y: number;
  height: number;
  color: string;
  side: "left" | "right";
}

const CHART_W = 700;
const CHART_H = 380;
const NODE_W = 14;
const LEFT_X = 50;
const RIGHT_X = CHART_W - 50;
const NODE_GAP = 8;
const MIN_NODE_H = 18;

function formatKwh(v: number): string {
  if (v >= 100) return `${Math.round(v)} kWh`;
  if (v >= 10) return `${v.toFixed(1)} kWh`;
  return `${v.toFixed(2)} kWh`;
}

/**
 * Compute energy flow totals from hourly data.
 * Uses the sign conventions:
 *   solar_w > 0 = generating
 *   grid_w > 0 = importing, < 0 = exporting
 *   battery_w > 0 = discharging, < 0 = charging
 *   home_w > 0 = consuming
 *   vehicle_w > 0 = consuming (subset of home)
 */
function computeFlowsFromHourly(data: HourlyBucket[]): Flow[] {
  // Allocate flows PER-HOUR then sum — this avoids the problem of
  // mixed time periods (e.g. grid charges battery at night, battery
  // exports to grid in the evening) producing impossible aggregates.
  const flowTotals = new Map<string, number>();
  const addTo = (key: string, val: number) => {
    if (val > 0) flowTotals.set(key, (flowTotals.get(key) || 0) + val);
  };

  for (const d of data) {
    const solar = Math.max(0, d.solar_w_avg) / 1000;
    const imp = Math.max(0, d.grid_w_avg) / 1000;
    const exp = Math.max(0, -d.grid_w_avg) / 1000;
    const batDis = Math.max(0, d.battery_w_avg) / 1000;
    const batChg = Math.max(0, -d.battery_w_avg) / 1000;
    const home = Math.max(0, (d.home_w_avg - d.vehicle_w_avg)) / 1000;
    const ev = Math.max(0, d.vehicle_w_avg) / 1000;

    // Sources for this hour
    const totalSrc = solar + imp + batDis;
    if (totalSrc === 0) continue;

    // Solar allocation: home+EV first, then battery charge, then grid export
    const homePlusEv = home + ev;
    const solarToLoad = Math.min(solar, homePlusEv);
    const homeRatio = homePlusEv > 0 ? home / homePlusEv : 0;
    addTo("Solar→Home", solarToLoad * homeRatio);
    addTo("Solar→EV", solarToLoad * (1 - homeRatio));

    let solarLeft = solar - solarToLoad;
    const solarToBat = Math.min(batChg, solarLeft);
    addTo("Solar→Powerwall Charge", solarToBat);
    solarLeft -= solarToBat;
    addTo("Solar→Grid Export", Math.min(exp, solarLeft));
    const solarToExp = Math.min(exp, solarLeft);

    // Powerwall discharge: home+EV demand remaining, then grid export
    const remainHome = Math.max(0, home - solarToLoad * homeRatio);
    const remainEv = Math.max(0, ev - solarToLoad * (1 - homeRatio));
    const remainDemand = remainHome + remainEv;
    const batToLoad = Math.min(batDis, remainDemand);
    const demandRatio = remainDemand > 0 ? remainHome / remainDemand : 0;
    addTo("Powerwall Discharge→Home", batToLoad * demandRatio);
    addTo("Powerwall Discharge→EV", batToLoad * (1 - demandRatio));
    const batLeft = batDis - batToLoad;
    const remainExp = Math.max(0, exp - solarToExp);
    addTo("Powerwall Discharge→Grid Export", Math.min(batLeft, remainExp));

    // Grid import: home+EV remaining, then battery charge
    const remainHome2 = Math.max(0, remainHome - batToLoad * demandRatio);
    const remainEv2 = Math.max(0, remainEv - batToLoad * (1 - demandRatio));
    addTo("Grid Import→Home", remainHome2);
    addTo("Grid Import→EV", remainEv2);
    const gridToLoad = remainHome2 + remainEv2;
    const gridLeft = imp - gridToLoad;
    const remainBatChg = Math.max(0, batChg - solarToBat);
    addTo("Grid Import→Powerwall Charge", Math.min(gridLeft, remainBatChg));
  }

  const flows: Flow[] = [];
  const colorMap: Record<string, string> = {
    "Solar": "#facc15",
    "Grid Import": "#f87171",
    "Powerwall Discharge": "#34d399",
  };

  for (const [key, value] of flowTotals) {
    if (value < 0.01) continue;
    const [from, to] = key.split("→");
    flows.push({ from, to, value: Math.round(value * 100) / 100, color: colorMap[from] || "#6b7280" });
  }

  return flows;
}

function computeFlowsFromDaily(data: DailySummary[]): Flow[] {
  let solarTotal = 0;
  let importTotal = 0;
  let exportTotal = 0;
  let evTotal = 0;

  for (const d of data) {
    solarTotal += d.solar_generated_kwh;
    importTotal += d.total_import_kwh;
    exportTotal += d.total_export_kwh;
    evTotal += d.ev_kwh;
  }

  // Home consumption = solar self-consumed + import - export (approximate)
  const selfConsumed = data.reduce((s, d) => s + d.solar_self_consumed_kwh, 0);
  const homeTotal = selfConsumed + importTotal - evTotal;

  const flows: Flow[] = [];
  const addFlow = (from: string, to: string, value: number, color: string) => {
    if (value > 0.01) flows.push({ from, to, value: Math.round(value * 100) / 100, color });
  };

  // Solar → destinations
  const solarToExport = exportTotal;
  const solarToHome = Math.max(0, selfConsumed - evTotal);
  const solarToEv = Math.min(evTotal, selfConsumed);

  addFlow("Solar", "Home", solarToHome, "#facc15");
  addFlow("Solar", "EV", solarToEv, "#facc15");
  addFlow("Solar", "Grid Export", solarToExport, "#facc15");

  // Grid import → destinations
  const gridToEv = Math.max(0, evTotal - solarToEv);
  const gridToHome = Math.max(0, importTotal - gridToEv);
  addFlow("Grid Import", "Home", gridToHome, "#f87171");
  addFlow("Grid Import", "EV", gridToEv, "#f87171");

  return flows;
}

function convertSankeyFlowsToFlows(sf: SankeyFlows): Flow[] {
  const mapping: [keyof SankeyFlows, string, string, string][] = [
    ["solar_to_home", "Solar", "Home", "#facc15"],
    ["solar_to_battery", "Solar", "Powerwall Charge", "#facc15"],
    ["solar_to_grid", "Solar", "Grid Export", "#facc15"],
    ["battery_to_home", "Powerwall Discharge", "Home", "#34d399"],
    ["battery_to_grid", "Powerwall Discharge", "Grid Export", "#34d399"],
    ["grid_to_home", "Grid Import", "Home", "#f87171"],
    ["grid_to_battery", "Grid Import", "Powerwall Charge", "#f87171"],
  ];
  return mapping
    .filter(([key]) => sf[key] >= 0.01)
    .map(([key, from, to, color]) => ({ from, to, value: sf[key], color }));
}

function renderSankey(flows: Flow[]) {
  if (flows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[280px] sm:h-[380px] text-gray-500 text-sm">
        No energy flow data for this period
      </div>
    );
  }

  // Compute node totals
  const leftNodes = new Map<string, number>();
  const rightNodes = new Map<string, number>();

  for (const f of flows) {
    leftNodes.set(f.from, (leftNodes.get(f.from) || 0) + f.value);
    rightNodes.set(f.to, (rightNodes.get(f.to) || 0) + f.value);
  }

  // Color map
  const nodeColors: Record<string, string> = {
    Solar: "#facc15",
    "Grid Import": "#f87171",
    "Powerwall Discharge": "#34d399",
    Home: "#60a5fa",
    EV: "#a78bfa",
    "Powerwall Charge": "#2dd4bf",
    "Grid Export": "#fb923c",
  };

  // Layout nodes vertically
  const layoutNodes = (
    nodeMap: Map<string, number>,
    x: number,
    side: "left" | "right"
  ): Map<string, NodeInfo> => {
    const entries = [...nodeMap.entries()].sort(([, a], [, b]) => b - a);
    const totalValue = entries.reduce((s, [, v]) => s + v, 0);
    const totalGap = (entries.length - 1) * NODE_GAP;
    const availH = CHART_H - 60 - totalGap;
    const result = new Map<string, NodeInfo>();

    let y = 30;
    for (const [label, total] of entries) {
      const height = Math.max(MIN_NODE_H, (total / totalValue) * availH);
      result.set(label, {
        label,
        total,
        y,
        height,
        color: nodeColors[label] || "#6b7280",
        side,
      });
      y += height + NODE_GAP;
    }

    return result;
  };

  const leftInfo = layoutNodes(leftNodes, LEFT_X, "left");
  const rightInfo = layoutNodes(rightNodes, RIGHT_X, "right");

  // Track cumulative offsets for stacking flows within each node
  const leftOffsets = new Map<string, number>();
  const rightOffsets = new Map<string, number>();
  for (const [k, v] of leftInfo) leftOffsets.set(k, v.y);
  for (const [k, v] of rightInfo) rightOffsets.set(k, v.y);

  // Build flow paths
  const flowPaths = flows.map((f, i) => {
    const left = leftInfo.get(f.from)!;
    const right = rightInfo.get(f.to)!;

    const leftY = leftOffsets.get(f.from)!;
    const rightY = rightOffsets.get(f.to)!;

    const leftH = (f.value / left.total) * left.height;
    const rightH = (f.value / right.total) * right.height;

    leftOffsets.set(f.from, leftY + leftH);
    rightOffsets.set(f.to, rightY + rightH);

    const x0 = LEFT_X + NODE_W;
    const x1 = RIGHT_X;
    const cx = (x0 + x1) / 2;

    const d = `
      M ${x0} ${leftY}
      C ${cx} ${leftY}, ${cx} ${rightY}, ${x1} ${rightY}
      L ${x1} ${rightY + rightH}
      C ${cx} ${rightY + rightH}, ${cx} ${leftY + leftH}, ${x0} ${leftY + leftH}
      Z
    `;

    return (
      <path
        key={i}
        d={d}
        fill={f.color}
        fillOpacity={0.25}
        stroke={f.color}
        strokeOpacity={0.5}
        strokeWidth={0.5}
      >
        <title>{`${f.from} → ${f.to}: ${formatKwh(f.value)}`}</title>
      </path>
    );
  });

  // Render nodes
  const renderNodes = (info: Map<string, NodeInfo>, x: number) =>
    [...info.values()].map((n) => (
      <g key={n.label}>
        <rect
          x={x}
          y={n.y}
          width={NODE_W}
          height={n.height}
          rx={4}
          fill={n.color}
          fillOpacity={0.8}
        />
        <text
          x={n.side === "left" ? x - 6 : x + NODE_W + 6}
          y={n.y + n.height / 2}
          dy="0.35em"
          textAnchor={n.side === "left" ? "end" : "start"}
          className="text-[11px] fill-gray-300 font-medium"
        >
          {n.label}
        </text>
        <text
          x={n.side === "left" ? x - 6 : x + NODE_W + 6}
          y={n.y + n.height / 2 + 14}
          dy="0.35em"
          textAnchor={n.side === "left" ? "end" : "start"}
          className="text-[10px] fill-gray-500"
        >
          {formatKwh(n.total)}
        </text>
      </g>
    ));

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[280px] sm:h-[380px]">
      {flowPaths}
      {renderNodes(leftInfo, LEFT_X)}
      {renderNodes(rightInfo, RIGHT_X)}
    </svg>
  );
}

interface Props {
  hourlyData: HourlyBucket[];
  dailyData: DailySummary[];
  days: number;
  sankeyFlows?: SankeyFlows | null;
}

export default function SankeyChart({ hourlyData, dailyData, days, sankeyFlows }: Props) {
  // Compute total energy from RAW data (same formula as HourlyChart) so numbers match
  const totalEnergy = useMemo(() => {
    if (hourlyData.length > 0) {
      let total = 0;
      for (const d of hourlyData) {
        total += (Math.max(0, d.solar_w_avg) + Math.max(0, d.grid_w_avg) + Math.max(0, d.battery_w_avg)) / 1000;
      }
      return total;
    }
    if (dailyData.length > 0) {
      return dailyData.reduce((s, d) => s + d.solar_generated_kwh + d.total_import_kwh, 0);
    }
    return 0;
  }, [hourlyData, dailyData]);

  const flows = useMemo(() => {
    // Prefer server-computed 5-min interval flows (most accurate)
    if (sankeyFlows) {
      return convertSankeyFlowsToFlows(sankeyFlows);
    }
    // Fallback: client-side computation from hourly or daily data
    if (hourlyData.length > 0) {
      return computeFlowsFromHourly(hourlyData);
    }
    if (dailyData.length > 0) {
      return computeFlowsFromDaily(dailyData);
    }
    return [];
  }, [sankeyFlows, hourlyData, dailyData]);

  const title = days === 1 ? "Energy Flow" : `Energy Flow (${days} Days)`;

  return (
    <div className="bg-gray-900 rounded-xl p-3 sm:p-4 border border-gray-800">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-1 mb-3">
        <h2 className="text-sm font-semibold text-gray-400 flex items-center gap-1.5">
          <GitBranch size={14} className="text-purple-400" />
          {title}
        </h2>
        {flows.length > 0 && (
          <div className="flex gap-3 sm:gap-4 text-[10px]">
            <span className="text-emerald-400">Sources: {formatKwh(totalEnergy)}</span>
            <span className="text-blue-400">Consumption: {formatKwh(totalEnergy)}</span>
          </div>
        )}
      </div>
      {renderSankey(flows)}
    </div>
  );
}
