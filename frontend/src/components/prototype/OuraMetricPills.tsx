"use client";

import { Sun, Home, Zap, BatteryMedium } from "lucide-react";

interface MetricData {
  solarW: number;
  homeW: number;
  gridW: number; // positive = import, negative = export
  batteryPct: number;
  batteryW: number; // positive = charging, negative = discharging
}

function formatPower(watts: number): string {
  const abs = Math.abs(watts);
  if (abs >= 1000) return `${(abs / 1000).toFixed(1)} kW`;
  return `${Math.round(abs)} W`;
}

interface PillProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subLabel?: string;
  accentColor: string;
}

function MetricPill({ icon, label, value, subLabel, accentColor }: PillProps) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3"
      style={{
        background: "rgba(255, 255, 255, 0.7)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderRadius: "12px",
        border: "1px solid rgba(235, 235, 235, 0.8)",
        boxShadow: "0 2px 8px rgba(74, 71, 65, 0.04)",
      }}
    >
      <div
        className="flex items-center justify-center w-9 h-9 rounded-lg"
        style={{
          background: `${accentColor}15`,
        }}
      >
        <span style={{ color: accentColor }}>{icon}</span>
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="uppercase tracking-wider"
          style={{
            fontSize: "10px",
            color: "#aaaaaa",
            letterSpacing: "0.1em",
          }}
        >
          {label}
        </p>
        <p
          className="font-medium"
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: "18px",
            color: "#4A4741",
            lineHeight: 1.2,
          }}
        >
          {value}
        </p>
      </div>
      {subLabel && (
        <span
          className="text-right"
          style={{
            fontSize: "11px",
            color: "#aaaaaa",
          }}
        >
          {subLabel}
        </span>
      )}
    </div>
  );
}

interface Props {
  data: MetricData;
}

export default function OuraMetricPills({ data }: Props) {
  const gridDirection = data.gridW < 0 ? "exporting" : data.gridW > 0 ? "importing" : "idle";
  const batteryDirection =
    data.batteryW > 0 ? "charging" : data.batteryW < 0 ? "discharging" : "idle";

  return (
    <div className="space-y-3">
      <p
        className="uppercase tracking-widest px-1"
        style={{
          fontSize: "11px",
          color: "#aaaaaa",
          letterSpacing: "0.15em",
        }}
      >
        Live Power Flow
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MetricPill
          icon={<Sun size={18} />}
          label="Solar"
          value={formatPower(data.solarW)}
          subLabel="generating"
          accentColor="#f5a623"
        />
        <MetricPill
          icon={<Home size={18} />}
          label="Home"
          value={formatPower(data.homeW)}
          subLabel="consuming"
          accentColor="#51b7e0"
        />
        <MetricPill
          icon={<Zap size={18} />}
          label="Grid"
          value={formatPower(data.gridW)}
          subLabel={gridDirection}
          accentColor={data.gridW < 0 ? "#7dd3c0" : "#e07851"}
        />
        <MetricPill
          icon={<BatteryMedium size={18} />}
          label="Battery"
          value={`${data.batteryPct}%`}
          subLabel={batteryDirection}
          accentColor="#9b7de0"
        />
      </div>
    </div>
  );
}
