"use client";

import OuraHeader from "@/components/prototype/OuraHeader";
import OuraHeroCard from "@/components/prototype/OuraHeroCard";
import OuraMetricPills from "@/components/prototype/OuraMetricPills";
import OuraCostSummary from "@/components/prototype/OuraCostSummary";
import OuraEnergyFlow from "@/components/prototype/OuraEnergyFlow";
import OuraHourlyChart from "@/components/prototype/OuraHourlyChart";
import OuraAlerts from "@/components/prototype/OuraAlerts";

// ── Mock Data ────────────────────────────────────────────────────────
const MOCK_LIVE = {
  solarW: 4850,
  homeW: 2100,
  gridW: -1200,
  batteryPct: 87,
  batteryW: 1550,
};

const MOCK_FLOW = {
  solarToHome: 14.2,
  solarToBattery: 6.8,
  solarToGrid: 5.3,
  batteryToHome: 4.1,
  gridToHome: 2.8,
  gridToBattery: 0.3,
  totalSolar: 26.3,
  totalConsumption: 21.1,
  evConsumption: 8.2,
};

const MOCK_HOURLY = Array.from({ length: 24 }, (_, i) => {
  const hour = i;
  // Solar bell curve peaking at noon
  const solarBase = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI) * 5.5);
  const solar = hour >= 6 && hour <= 18 ? solarBase : 0;
  // Home consumption: base + morning/evening peaks
  const homeBase = 0.8;
  const morningPeak = hour >= 7 && hour <= 9 ? 1.2 : 0;
  const eveningPeak = hour >= 17 && hour <= 21 ? 2.0 : 0;
  const evCharge = hour >= 22 || hour <= 5 ? 1.5 : 0;
  const home = homeBase + morningPeak + eveningPeak + evCharge;
  // Grid: import when solar < home, export when excess
  const surplus = solar - home;
  const grid = surplus < 0 ? Math.abs(surplus) * 0.6 : 0;
  // Battery: charge during solar peak, discharge evening
  const battery =
    hour >= 10 && hour <= 15
      ? solar * 0.25
      : hour >= 17 && hour <= 21
        ? -1.2
        : 0;

  return {
    hour: `${hour.toString().padStart(2, "0")}:00`,
    solar: Math.round(solar * 10) / 10,
    home: Math.round(home * 10) / 10,
    grid: Math.round(grid * 10) / 10,
    battery: Math.round(Math.abs(battery) * 10) / 10,
  };
});

const MOCK_ALERTS = [
  {
    id: 1,
    message: "Solar production peaked at 6.2 kW at 12:34 PM",
    timestamp: "Today, 12:34 PM",
    severity: "success" as const,
  },
  {
    id: 2,
    message: "Battery fully charged, exporting excess to grid",
    timestamp: "Today, 1:15 PM",
    severity: "info" as const,
  },
  {
    id: 3,
    message: "Grid import detected during cloud cover (2.1 kW)",
    timestamp: "Today, 10:42 AM",
    severity: "warning" as const,
  },
  {
    id: 4,
    message: "EV charging session started via Wall Connector",
    timestamp: "Today, 6:30 AM",
    severity: "info" as const,
  },
];

// ── Page Component ───────────────────────────────────────────────────
export default function PrototypePage() {
  const selfPowered =
    MOCK_FLOW.totalConsumption > 0
      ? ((1 - (MOCK_FLOW.gridToHome + MOCK_FLOW.gridToBattery) / MOCK_FLOW.totalConsumption) * 100)
      : 0;

  return (
    <>
      {/* Google Fonts for Raleway */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;600&display=swap"
        rel="stylesheet"
      />

      {/* Override the dark layout for this prototype */}
      <style>{`
        html.dark body {
          background: #f6f3ef !important;
          color: #4A4741 !important;
        }
        .prototype-page * {
          font-family: 'Raleway', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .prototype-page h1,
        .prototype-page h2,
        .prototype-page h3 {
          font-family: Georgia, 'Times New Roman', serif;
        }

        /* Hide the default AppHeader when viewing prototype */
        header:has(+ main .prototype-page) {
          display: none;
        }

        /* Subtle animated background pattern */
        .oura-bg-pattern {
          background-image:
            radial-gradient(ellipse at 20% 0%, rgba(81, 183, 224, 0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 100%, rgba(245, 166, 35, 0.04) 0%, transparent 50%),
            radial-gradient(ellipse at 50% 50%, rgba(155, 125, 224, 0.02) 0%, transparent 60%);
        }

        /* Smooth fade-in for sections */
        .oura-section {
          animation: ouraFadeUp 0.6s ease-out both;
        }
        .oura-section:nth-child(1) { animation-delay: 0s; }
        .oura-section:nth-child(2) { animation-delay: 0.08s; }
        .oura-section:nth-child(3) { animation-delay: 0.16s; }
        .oura-section:nth-child(4) { animation-delay: 0.24s; }
        .oura-section:nth-child(5) { animation-delay: 0.32s; }
        .oura-section:nth-child(6) { animation-delay: 0.40s; }
        .oura-section:nth-child(7) { animation-delay: 0.48s; }

        @keyframes ouraFadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>

      <div className="prototype-page oura-bg-pattern min-h-screen">
        {/* Custom prototype header */}
        <OuraHeader />

        {/* Main content */}
        <main
          className="max-w-2xl mx-auto px-4 sm:px-6 pb-12"
          style={{ paddingTop: "1rem" }}
        >
          {/* Date & greeting */}
          <div className="oura-section mb-6">
            <p
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: "14px",
                color: "#aaaaaa",
                marginBottom: "4px",
              }}
            >
              {new Date().toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })}
            </p>
            <h1
              style={{
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: "28px",
                fontWeight: 400,
                color: "#4A4741",
                lineHeight: 1.2,
              }}
            >
              Your Energy Day
            </h1>
          </div>

          {/* Hero: Self-Powered Ring */}
          <div className="oura-section mb-8">
            <OuraHeroCard selfPoweredPct={selfPowered} />
          </div>

          {/* Live Metric Pills */}
          <div className="oura-section mb-8">
            <OuraMetricPills data={MOCK_LIVE} />
          </div>

          {/* Cost Summary */}
          <div className="oura-section mb-8">
            <OuraCostSummary
              solarSavings={12.47}
              gridCosts={3.21}
              exportCredits={2.83}
            />
          </div>

          {/* Energy Flow */}
          <div className="oura-section mb-8">
            <OuraEnergyFlow data={MOCK_FLOW} />
          </div>

          {/* Hourly Chart */}
          <div className="oura-section mb-8">
            <OuraHourlyChart data={MOCK_HOURLY} />
          </div>

          {/* Alerts */}
          <div className="oura-section mb-8">
            <OuraAlerts alerts={MOCK_ALERTS} />
          </div>

          {/* Footer note */}
          <div className="oura-section text-center" style={{ paddingTop: "1rem" }}>
            <p
              style={{
                fontSize: "11px",
                color: "#d4d0cb",
                textTransform: "uppercase",
                letterSpacing: "0.15em",
              }}
            >
              SelfPower Prototype &middot; Oura-Inspired Design
            </p>
          </div>
        </main>
      </div>
    </>
  );
}
