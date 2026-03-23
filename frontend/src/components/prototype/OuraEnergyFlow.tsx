"use client";

import { Sun, Home, Zap, BatteryMedium, Car } from "lucide-react";

interface FlowData {
  solarToHome: number;
  solarToBattery: number;
  solarToGrid: number;
  batteryToHome: number;
  gridToHome: number;
  gridToBattery: number;
  totalSolar: number;
  totalConsumption: number;
  evConsumption: number;
}

function fmtKwh(v: number): string {
  if (v < 0.1) return "0 kWh";
  if (v < 10) return `${v.toFixed(1)} kWh`;
  return `${Math.round(v)} kWh`;
}

interface FlowNodeProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  position: "left" | "right";
}

function FlowNode({ icon, label, value, color, position }: FlowNodeProps) {
  return (
    <div
      className={`flex items-center gap-2 ${position === "right" ? "flex-row-reverse text-right" : ""}`}
    >
      <div
        className="flex items-center justify-center w-10 h-10 rounded-xl"
        style={{
          background: `${color}12`,
          border: `1px solid ${color}25`,
        }}
      >
        <span style={{ color }}>{icon}</span>
      </div>
      <div>
        <p
          className="uppercase tracking-wider"
          style={{ fontSize: "9px", color: "#aaaaaa", letterSpacing: "0.1em" }}
        >
          {label}
        </p>
        <p
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: "15px",
            color: "#4A4741",
            lineHeight: 1.2,
          }}
        >
          {value}
        </p>
      </div>
    </div>
  );
}

interface FlowLineProps {
  value: number;
  color: string;
  maxValue: number;
}

function FlowLine({ value, color, maxValue }: FlowLineProps) {
  const width = maxValue > 0 ? Math.max(8, (value / maxValue) * 100) : 0;

  if (value < 0.05) return null;

  return (
    <div className="flex items-center gap-1 py-0.5">
      <div
        className="h-1.5 rounded-full"
        style={{
          width: `${width}%`,
          background: `linear-gradient(90deg, ${color}60, ${color})`,
          minWidth: "8px",
          transition: "width 0.6s ease",
        }}
      />
      <span style={{ fontSize: "10px", color: "#aaaaaa", whiteSpace: "nowrap" }}>
        {fmtKwh(value)}
      </span>
    </div>
  );
}

interface Props {
  data: FlowData;
}

export default function OuraEnergyFlow({ data }: Props) {
  const maxFlow = Math.max(
    data.solarToHome,
    data.solarToBattery,
    data.solarToGrid,
    data.batteryToHome,
    data.gridToHome,
    data.gridToBattery,
    1
  );

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
        Energy Flow
      </p>

      <div
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "16px",
          border: "1px solid rgba(235, 235, 235, 0.8)",
          boxShadow: "0 6px 24px rgba(74, 71, 65, 0.06)",
          padding: "1.25rem",
        }}
      >
        {/* Sources */}
        <div className="space-y-4">
          {/* Solar section */}
          <div>
            <FlowNode
              icon={<Sun size={18} />}
              label="Solar Generated"
              value={fmtKwh(data.totalSolar)}
              color="#f5a623"
              position="left"
            />
            <div className="ml-12 mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <Home size={10} style={{ color: "#51b7e0" }} />
                <FlowLine value={data.solarToHome} color="#f5a623" maxValue={maxFlow} />
              </div>
              <div className="flex items-center gap-2">
                <BatteryMedium size={10} style={{ color: "#9b7de0" }} />
                <FlowLine value={data.solarToBattery} color="#f5a623" maxValue={maxFlow} />
              </div>
              <div className="flex items-center gap-2">
                <Zap size={10} style={{ color: "#7dd3c0" }} />
                <FlowLine value={data.solarToGrid} color="#f5a623" maxValue={maxFlow} />
              </div>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid #ebebeb" }} />

          {/* Grid section */}
          <div>
            <FlowNode
              icon={<Zap size={18} />}
              label="Grid Import"
              value={fmtKwh(data.gridToHome + data.gridToBattery)}
              color="#e07851"
              position="left"
            />
            <div className="ml-12 mt-2 space-y-1">
              <div className="flex items-center gap-2">
                <Home size={10} style={{ color: "#51b7e0" }} />
                <FlowLine value={data.gridToHome} color="#e07851" maxValue={maxFlow} />
              </div>
              {data.gridToBattery > 0.05 && (
                <div className="flex items-center gap-2">
                  <BatteryMedium size={10} style={{ color: "#9b7de0" }} />
                  <FlowLine value={data.gridToBattery} color="#e07851" maxValue={maxFlow} />
                </div>
              )}
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: "1px solid #ebebeb" }} />

          {/* Consumption summary */}
          <div className="flex items-center justify-between">
            <FlowNode
              icon={<Home size={18} />}
              label="Total Consumption"
              value={fmtKwh(data.totalConsumption)}
              color="#51b7e0"
              position="left"
            />
            {data.evConsumption > 0.1 && (
              <div className="flex items-center gap-1.5">
                <Car size={14} style={{ color: "#9b7de0" }} />
                <span style={{ fontSize: "12px", color: "#8a8680" }}>
                  EV: {fmtKwh(data.evConsumption)}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
