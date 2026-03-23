"use client";

import { TrendingUp, TrendingDown } from "lucide-react";

interface Props {
  solarSavings: number;
  gridCosts: number;
  exportCredits: number;
}

function fmt(v: number): string {
  if (v >= 100) return `$${Math.round(v)}`;
  return `$${v.toFixed(2)}`;
}

export default function OuraCostSummary({ solarSavings, gridCosts, exportCredits }: Props) {
  const netSavings = solarSavings - gridCosts;

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
        Financial Summary
      </p>

      <div
        className="overflow-hidden"
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "16px",
          border: "1px solid rgba(235, 235, 235, 0.8)",
          boxShadow: "0 6px 24px rgba(74, 71, 65, 0.06)",
        }}
      >
        {/* Net savings hero */}
        <div
          className="px-6 py-5 text-center"
          style={{
            background:
              netSavings >= 0
                ? "linear-gradient(135deg, rgba(125, 211, 192, 0.08) 0%, rgba(81, 183, 224, 0.06) 100%)"
                : "linear-gradient(135deg, rgba(224, 120, 81, 0.08) 0%, rgba(224, 81, 81, 0.06) 100%)",
          }}
        >
          <p
            className="uppercase tracking-wider mb-1"
            style={{ fontSize: "10px", color: "#aaaaaa", letterSpacing: "0.12em" }}
          >
            Net Savings Today
          </p>
          <p
            className="flex items-center justify-center gap-2"
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: "36px",
              color: netSavings >= 0 ? "#4A9E85" : "#c75a3a",
              fontWeight: 400,
              lineHeight: 1.1,
            }}
          >
            {netSavings >= 0 ? (
              <TrendingUp size={24} style={{ color: "#4A9E85" }} />
            ) : (
              <TrendingDown size={24} style={{ color: "#c75a3a" }} />
            )}
            {fmt(Math.abs(netSavings))}
          </p>
        </div>

        {/* Line items */}
        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#f5a623" }}
              />
              <span style={{ fontSize: "14px", color: "#8a8680" }}>Solar Savings</span>
            </div>
            <span
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: "16px",
                color: "#4A4741",
              }}
            >
              {fmt(solarSavings)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ background: "#7dd3c0" }}
              />
              <span style={{ fontSize: "14px", color: "#8a8680" }}>Export Credits</span>
            </div>
            <span
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: "16px",
                color: "#4A4741",
              }}
            >
              {fmt(exportCredits)}
            </span>
          </div>

          <div
            className="pt-3"
            style={{ borderTop: "1px solid #ebebeb" }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: "#e07851" }}
                />
                <span style={{ fontSize: "14px", color: "#8a8680" }}>Grid Costs</span>
              </div>
              <span
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontSize: "16px",
                  color: "#c75a3a",
                }}
              >
                -{fmt(gridCosts)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
