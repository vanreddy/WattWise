"use client";

import { useMemo } from "react";

interface Props {
  selfPoweredPct: number;
}

export default function OuraHeroCard({ selfPoweredPct }: Props) {
  const pct = Math.max(0, Math.min(100, selfPoweredPct));

  const { arcLength, offset } = useMemo(() => {
    const radius = 100;
    const halfCirc = Math.PI * radius;
    const off = halfCirc * (1 - pct / 100);
    return { arcLength: halfCirc, offset: off };
  }, [pct]);

  // Color gradient stops based on performance
  const gradientId = "hero-arc-gradient";

  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: "linear-gradient(145deg, #ffffff 0%, #f0edea 50%, #e8e4df 100%)",
        borderRadius: "16px",
        padding: "2rem 1.5rem 1.5rem",
        boxShadow: "0 12px 50px rgba(74, 71, 65, 0.08), 0 2px 8px rgba(74, 71, 65, 0.04)",
      }}
    >
      {/* Subtle radial gradient background accent */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 50% 20%, rgba(81, 183, 224, 0.06) 0%, transparent 60%)",
        }}
      />

      {/* Title */}
      <div className="text-center mb-2 relative z-10">
        <p
          className="uppercase tracking-widest mb-1"
          style={{
            fontSize: "11px",
            color: "#aaaaaa",
            letterSpacing: "0.15em",
          }}
        >
          Energy Independence
        </p>
        <h2
          style={{
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontSize: "16px",
            color: "#4A4741",
            fontWeight: 400,
          }}
        >
          Self-Powered Today
        </h2>
      </div>

      {/* Ring visualization */}
      <div className="relative w-full max-w-[280px] mx-auto" style={{ aspectRatio: "280/180" }}>
        <svg viewBox="0 0 240 140" className="w-full h-full">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#51b7e0" />
              <stop offset="50%" stopColor="#7dd3c0" />
              <stop offset="100%" stopColor="#51b7e0" />
            </linearGradient>
            {/* Glow filter */}
            <filter id="arc-glow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Background track */}
          <path
            d="M 20 120 A 100 100 0 0 1 220 120"
            fill="none"
            stroke="#ebebeb"
            strokeWidth="10"
            strokeLinecap="round"
          />

          {/* Progress arc */}
          <path
            d="M 20 120 A 100 100 0 0 1 220 120"
            fill="none"
            stroke={`url(#${gradientId})`}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            strokeDashoffset={offset}
            filter="url(#arc-glow)"
            style={{
              transition: "stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)",
            }}
          />

          {/* Tick marks at 0, 25, 50, 75, 100 */}
          {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
            const angle = Math.PI * (1 - frac);
            const cx = 120 + 100 * Math.cos(angle);
            const cy = 120 - 100 * Math.sin(angle);
            const outerX = 120 + 112 * Math.cos(angle);
            const outerY = 120 - 112 * Math.sin(angle);
            return (
              <line
                key={frac}
                x1={cx}
                y1={cy}
                x2={outerX}
                y2={outerY}
                stroke="#d4d0cb"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            );
          })}
        </svg>

        {/* Center number */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
          <span
            style={{
              fontFamily: 'Georgia, "Times New Roman", serif',
              fontSize: "52px",
              fontWeight: 400,
              color: "#4A4741",
              lineHeight: 1,
            }}
          >
            {Math.round(pct)}
            <span
              style={{
                fontSize: "24px",
                color: "#aaaaaa",
                fontWeight: 300,
              }}
            >
              %
            </span>
          </span>
          <span
            style={{
              fontSize: "11px",
              color: "#aaaaaa",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginTop: "4px",
            }}
          >
            solar + battery
          </span>
        </div>
      </div>

      {/* Summary text */}
      <p
        className="text-center mt-3 relative z-10"
        style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: "14px",
          color: "#8a8680",
          lineHeight: "1.6",
          fontStyle: "italic",
        }}
      >
        {pct >= 80
          ? "Excellent energy independence today"
          : pct >= 50
            ? "Good solar coverage, battery helping bridge gaps"
            : "Grid supplementing your solar today"}
      </p>
    </div>
  );
}
