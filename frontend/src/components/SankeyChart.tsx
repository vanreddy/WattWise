"use client";

import { useMemo } from "react";
import { GitBranch } from "lucide-react";
import type { HourlyBucket, DailySummary } from "@/lib/api";

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
  let solarTotal = 0;
  let gridImport = 0;
  let gridExport = 0;
  let batteryCharge = 0;
  let batteryDischarge = 0;
  let homeTotal = 0;
  let evTotal = 0;

  for (const d of data) {
    solarTotal += Math.max(0, d.solar_w_avg);
    gridImport += Math.max(0, d.grid_w_avg);
    gridExport += Math.max(0, -d.grid_w_avg);
    batteryDischarge += Math.max(0, d.battery_w_avg);
    batteryCharge += Math.max(0, -d.battery_w_avg);
    homeTotal += Math.max(0, d.home_w_avg - d.vehicle_w_avg);
    evTotal += Math.max(0, d.vehicle_w_avg);
  }

  // Convert to kWh (avg watts * interval_hours / 1000)
  // Each hourly bucket represents 1 hour of data
  const toKwh = (w: number) => w / 1000;

  const solar = toKwh(solarTotal);
  const imp = toKwh(gridImport);
  const exp = toKwh(gridExport);
  const batChg = toKwh(batteryCharge);
  const batDis = toKwh(batteryDischarge);
  const home = toKwh(homeTotal);
  const ev = toKwh(evTotal);

  // Total sources = solar + grid import + battery discharge
  const totalSources = solar + imp + batDis;
  // Total sinks = home + ev + grid export + battery charge
  const totalSinks = home + ev + exp + batChg;

  if (totalSources === 0) return [];

  // Estimate flow allocations proportionally
  // Solar feeds: home, ev, battery charge, grid export
  const solarToHome = totalSinks > 0 ? solar * (home / totalSinks) : 0;
  const solarToEv = totalSinks > 0 ? solar * (ev / totalSinks) : 0;
  const solarToBattery = Math.min(batChg, solar * (batChg / totalSinks));
  const solarToGrid = Math.min(exp, solar * (exp / totalSinks));

  // Grid import feeds: home, ev
  const gridToHome = totalSinks > 0 ? imp * (home / (home + ev || 1)) : 0;
  const gridToEv = imp - gridToHome;

  // Battery discharge feeds: home, ev
  const batToHome = totalSinks > 0 ? batDis * (home / (home + ev || 1)) : 0;
  const batToEv = batDis - batToHome;

  const flows: Flow[] = [];
  const addFlow = (from: string, to: string, value: number, color: string) => {
    if (value > 0.01) flows.push({ from, to, value: Math.round(value * 100) / 100, color });
  };

  addFlow("Solar", "Home", solarToHome, "#facc15");
  addFlow("Solar", "EV", solarToEv, "#facc15");
  addFlow("Solar", "Battery", solarToBattery, "#facc15");
  addFlow("Solar", "Grid Export", solarToGrid, "#facc15");
  addFlow("Grid Import", "Home", gridToHome, "#f87171");
  addFlow("Grid Import", "EV", gridToEv, "#f87171");
  addFlow("Powerwall", "Home", batToHome, "#34d399");
  addFlow("Powerwall", "EV", batToEv, "#34d399");

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

function renderSankey(flows: Flow[]) {
  if (flows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[380px] text-gray-500 text-sm">
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
    Powerwall: "#34d399",
    Home: "#60a5fa",
    EV: "#a78bfa",
    Battery: "#2dd4bf",
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
    <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-[380px]">
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
}

export default function SankeyChart({ hourlyData, dailyData, days }: Props) {
  const flows = useMemo(() => {
    // Use hourly data for accuracy when available, fall back to daily
    if (hourlyData.length > 0) {
      return computeFlowsFromHourly(hourlyData);
    }
    if (dailyData.length > 0) {
      return computeFlowsFromDaily(dailyData);
    }
    return [];
  }, [hourlyData, dailyData]);

  const title = days === 1 ? "Energy Flow" : `Energy Flow (${days} Days)`;

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-1.5">
        <GitBranch size={14} className="text-purple-400" />
        {title}
      </h2>
      {renderSankey(flows)}
    </div>
  );
}
