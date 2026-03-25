"use client";

import { useEffect, useState, useRef } from "react";
import { getAccessToken } from "@/lib/auth";

const API_BASE = (
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
).replace(/\/+$/, "");

interface BackfillStatus {
  days_fetched: number;
  days_total: number;
  status: "not_started" | "fetching" | "done" | "error";
  error: string | null;
  days_in_db: number;
}

const TIPS = [
  "Pulling your solar production history...",
  "Analyzing battery charge cycles...",
  "Calculating grid import & export patterns...",
  "Crunching time-of-use cost breakdowns...",
  "Building your energy flow insights...",
  "Mapping peak vs off-peak usage...",
  "Discovering your self-powered percentage...",
  "Almost there — finalizing daily summaries...",
];

export default function SetupPage() {
  const [status, setStatus] = useState<BackfillStatus | null>(null);
  const [tipIndex, setTipIndex] = useState(0);
  const [redirecting, setRedirecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tipRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll backfill status every 3 seconds
  useEffect(() => {
    async function poll() {
      const token = getAccessToken();
      if (!token) {
        window.location.href = "/login";
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/auth/account/backfill/status`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data: BackfillStatus = await res.json();
          setStatus(data);
        }
      } catch {
        // ignore transient errors
      }
    }

    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Rotate tips every 4 seconds
  useEffect(() => {
    tipRef.current = setInterval(() => {
      setTipIndex((i) => (i + 1) % TIPS.length);
    }, 4000);
    return () => {
      if (tipRef.current) clearInterval(tipRef.current);
    };
  }, []);

  // Redirect to dashboard once 7+ days are in the DB
  useEffect(() => {
    if (status && status.days_in_db >= 7 && !redirecting) {
      setRedirecting(true);
      // Brief delay so user sees the progress complete
      setTimeout(() => {
        window.location.href = "/?backfill=active";
      }, 1500);
    }
  }, [status, redirecting]);

  const daysInDb = status?.days_in_db ?? 0;
  const target = 7;
  const pct = Math.min(100, Math.round((daysInDb / target) * 100));
  const isError = status?.status === "error";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        {/* Logo */}
        <div className="space-y-4">
          <img
            src="/icon.svg"
            alt="SelfPower"
            className="h-20 w-20 mx-auto rounded-xl"
            style={{
              animation: redirecting
                ? "none"
                : "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
            }}
          />
          <h2 className="text-lg font-semibold text-gray-300">
            {redirecting ? "You\u2019re all set!" : "Loading your energy history"}
          </h2>
        </div>

        {/* Single progress bar: days ready out of 7 */}
        <div className="space-y-3">
          <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${pct}%`,
                background: "linear-gradient(90deg, #F5B700, #86C840)",
              }}
            />
          </div>

          <p className="text-sm text-gray-400">
            <span className="text-green-400 font-semibold">{daysInDb}</span>
            <span className="text-gray-600"> / {target} days ready</span>
          </p>
        </div>

        {/* Rotating tip text */}
        <p
          className="text-sm text-gray-400 h-6 transition-opacity duration-500"
          key={tipIndex}
          style={{ animation: "fadeIn 0.5s ease-in" }}
        >
          {redirecting
            ? "Ready! Taking you to your dashboard..."
            : isError
              ? status?.error || "Something went wrong"
              : TIPS[tipIndex]}
        </p>

        <p className="text-[11px] text-gray-600">
          Dashboard unlocks once 7 days of data are loaded.
          {"\n"}Historical data will continue loading in the background.
        </p>

        {/* Error retry */}
        {isError && (
          <button
            onClick={() => window.location.reload()}
            className="text-yellow-500 hover:text-yellow-400 text-sm underline"
          >
            Retry
          </button>
        )}
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(4px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
