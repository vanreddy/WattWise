"use client";

import { Sun, Settings, ArrowLeft } from "lucide-react";

export default function OuraHeader() {
  return (
    <header
      className="sticky top-0 z-30 px-5 py-4 flex items-center justify-between"
      style={{
        background: "rgba(246, 243, 239, 0.85)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <a
        href="/"
        className="flex items-center gap-2 text-sm tracking-wide"
        style={{ color: "#aaaaaa" }}
      >
        <ArrowLeft size={16} />
        <span className="uppercase" style={{ letterSpacing: "0.08em", fontSize: "11px" }}>
          Back to Dashboard
        </span>
      </a>

      <div className="flex items-center gap-2">
        <Sun size={20} style={{ color: "#51b7e0" }} />
        <span
          className="text-lg font-bold tracking-tight"
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            color: "#4A4741",
          }}
        >
          Watt<span style={{ color: "#51b7e0" }}>Wise</span>
        </span>
      </div>

      <a
        href="/settings"
        className="p-2 rounded-lg transition-colors"
        style={{ color: "#aaaaaa" }}
      >
        <Settings size={18} />
      </a>
    </header>
  );
}
