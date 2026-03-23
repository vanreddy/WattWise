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

// NodeInfo kept for type compatibility — actual layout uses NodeLayout in renderSankey

const CHART_W = 700;
const CHART_H = 420;
const NODE_H = 14;
const TOP_Y = 60;
const BOTTOM_Y = CHART_H - 60;
const NODE_GAP = 12;
const MIN_NODE_W = 40;

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

interface NodeLayout {
  label: string;
  total: number;
  x: number;
  width: number;
  color: string;
  row: "top" | "bottom";
}

function renderSankey(flows: Flow[]) {
  if (flows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[320px] sm:h-[420px] text-gray-500 text-sm">
        No energy flow data for this period
      </div>
    );
  }

  // Compute node totals — sources (top) and consumption (bottom)
  const topNodes = new Map<string, number>();
  const bottomNodes = new Map<string, number>();

  for (const f of flows) {
    topNodes.set(f.from, (topNodes.get(f.from) || 0) + f.value);
    bottomNodes.set(f.to, (bottomNodes.get(f.to) || 0) + f.value);
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

  // Layout nodes horizontally at a given y
  const layoutNodes = (
    nodeMap: Map<string, number>,
    row: "top" | "bottom"
  ): Map<string, NodeLayout> => {
    const entries = [...nodeMap.entries()].sort(([, a], [, b]) => b - a);
    const totalValue = entries.reduce((s, [, v]) => s + v, 0);
    const totalGap = (entries.length - 1) * NODE_GAP;
    const availW = CHART_W - 80 - totalGap;
    const result = new Map<string, NodeLayout>();

    let x = 40;
    for (const [label, total] of entries) {
      const width = Math.max(MIN_NODE_W, (total / totalValue) * availW);
      result.set(label, {
        label,
        total,
        x,
        width,
        color: nodeColors[label] || "#6b7280",
        row,
      });
      x += width + NODE_GAP;
    }

    return result;
  };

  const topInfo = layoutNodes(topNodes, "top");
  const bottomInfo = layoutNodes(bottomNodes, "bottom");

  // Track cumulative x-offsets for stacking flows within each node
  const topOffsets = new Map<string, number>();
  const bottomOffsets = new Map<string, number>();
  for (const [k, v] of topInfo) topOffsets.set(k, v.x);
  for (const [k, v] of bottomInfo) bottomOffsets.set(k, v.x);

  // Build flow paths (top-to-bottom vertical curves)
  const flowPaths = flows.map((f, i) => {
    const top = topInfo.get(f.from)!;
    const bottom = bottomInfo.get(f.to)!;

    const topX = topOffsets.get(f.from)!;
    const bottomX = bottomOffsets.get(f.to)!;

    const topW = (f.value / top.total) * top.width;
    const bottomW = (f.value / bottom.total) * bottom.width;

    topOffsets.set(f.from, topX + topW);
    bottomOffsets.set(f.to, bottomX + bottomW);

    const y0 = TOP_Y + NODE_H;
    const y1 = BOTTOM_Y;
    const cy = (y0 + y1) / 2;

    const srcPct = Math.round((f.value / top.total) * 100);
    const destPct = Math.round((f.value / bottom.total) * 100);

    const d = `
      M ${topX} ${y0}
      C ${topX} ${cy}, ${bottomX} ${cy}, ${bottomX} ${y1}
      L ${bottomX + bottomW} ${y1}
      C ${bottomX + bottomW} ${cy}, ${topX + topW} ${cy}, ${topX + topW} ${y0}
      Z
    `;

    // Place % labels near source (top) and destination (bottom)
    const midTopX = topX + topW / 2;
    const midBottomX = bottomX + bottomW / 2;

    return (
      <g key={i}>
        <path
          d={d}
          fill={f.color}
          fillOpacity={0.3}
          stroke={f.color}
          strokeOpacity={0.4}
          strokeWidth={0.5}
        >
          <title>{`${f.from} → ${f.to}: ${formatKwh(f.value)}`}</title>
        </path>
        {/* Source % near top */}
        {topW > 20 && (
          <text
            x={midTopX}
            y={y0 + 18}
            textAnchor="middle"
            className="fill-gray-400 font-medium"
            fontSize={11}
          >
            {srcPct}%
          </text>
        )}
        {/* Destination % near bottom */}
        {bottomW > 20 && (
          <text
            x={midBottomX}
            y={y1 - 10}
            textAnchor="middle"
            className="fill-gray-400 font-medium"
            fontSize={11}
          >
            {destPct}%
          </text>
        )}
      </g>
    );
  });

  // Render nodes (horizontal bars)
  const renderNodes = (info: Map<string, NodeLayout>, y: number) =>
    [...info.values()].map((n) => (
      <g key={n.label}>
        <rect
          x={n.x}
          y={y}
          width={n.width}
          height={NODE_H}
          rx={4}
          fill={n.color}
          fillOpacity={0.8}
        />
        {/* Label above for top nodes, below for bottom nodes */}
        <text
          x={n.x + n.width / 2}
          y={n.row === "top" ? y - 16 : y + NODE_H + 16}
          textAnchor="middle"
          className="fill-gray-300 font-medium"
          fontSize={13}
        >
          {n.label}
        </text>
        <text
          x={n.x + n.width / 2}
          y={n.row === "top" ? y - 3 : y + NODE_H + 30}
          textAnchor="middle"
          className="fill-gray-500"
          fontSize={13}
        >
          {formatKwh(n.total)}
        </text>
      </g>
    ));

  return (
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[320px] sm:h-[420px]">
      {flowPaths}
      {renderNodes(topInfo, TOP_Y)}
      {renderNodes(bottomInfo, BOTTOM_Y)}
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
