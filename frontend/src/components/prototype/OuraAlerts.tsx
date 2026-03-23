"use client";

import { useState } from "react";
import { Bell, ChevronDown, ChevronUp, AlertTriangle, Info, CheckCircle } from "lucide-react";

interface AlertItem {
  id: number;
  message: string;
  timestamp: string;
  severity: "info" | "warning" | "success";
}

interface Props {
  alerts: AlertItem[];
}

function getSeverityStyles(severity: AlertItem["severity"]) {
  switch (severity) {
    case "warning":
      return { color: "#e07851", icon: <AlertTriangle size={14} /> };
    case "success":
      return { color: "#4A9E85", icon: <CheckCircle size={14} /> };
    default:
      return { color: "#51b7e0", icon: <Info size={14} /> };
  }
}

export default function OuraAlerts({ alerts }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visibleAlerts = expanded ? alerts : alerts.slice(0, 2);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p
          className="uppercase tracking-widest"
          style={{
            fontSize: "11px",
            color: "#aaaaaa",
            letterSpacing: "0.15em",
          }}
        >
          Recent Alerts
        </p>
        {alerts.length > 0 && (
          <div
            className="flex items-center justify-center w-5 h-5 rounded-full"
            style={{
              background: "#e0785120",
            }}
          >
            <span style={{ fontSize: "10px", color: "#e07851", fontWeight: 600 }}>
              {alerts.length}
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          background: "rgba(255, 255, 255, 0.7)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "16px",
          border: "1px solid rgba(235, 235, 235, 0.8)",
          boxShadow: "0 6px 24px rgba(74, 71, 65, 0.06)",
          overflow: "hidden",
        }}
      >
        {alerts.length === 0 ? (
          <div className="px-5 py-6 text-center">
            <Bell size={20} style={{ color: "#d4d0cb", margin: "0 auto 8px" }} />
            <p style={{ fontSize: "13px", color: "#aaaaaa" }}>
              No alerts today. All systems running smoothly.
            </p>
          </div>
        ) : (
          <>
            <div className="divide-y" style={{ borderColor: "#f0edea" }}>
              {visibleAlerts.map((alert) => {
                const severity = getSeverityStyles(alert.severity);
                return (
                  <div
                    key={alert.id}
                    className="flex items-start gap-3 px-5 py-3.5"
                  >
                    <div
                      className="mt-0.5 flex-shrink-0"
                      style={{ color: severity.color }}
                    >
                      {severity.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: "13px", color: "#4A4741", lineHeight: 1.5 }}>
                        {alert.message}
                      </p>
                      <p
                        className="mt-1"
                        style={{ fontSize: "11px", color: "#aaaaaa" }}
                      >
                        {alert.timestamp}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {alerts.length > 2 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-center gap-1.5 py-3 transition-colors"
                style={{
                  borderTop: "1px solid #f0edea",
                  fontSize: "12px",
                  color: "#51b7e0",
                  background: "transparent",
                }}
              >
                {expanded ? (
                  <>
                    Show less <ChevronUp size={14} />
                  </>
                ) : (
                  <>
                    Show {alerts.length - 2} more <ChevronDown size={14} />
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
