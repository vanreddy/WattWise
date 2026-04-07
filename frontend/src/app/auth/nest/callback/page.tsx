"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { completeNestAuth } from "@/lib/auth";

function NestCallbackInner() {
  const searchParams = useSearchParams();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<unknown[]>([]);

  useEffect(() => {
    const code = searchParams.get("code");
    const errorParam = searchParams.get("error");

    if (errorParam) {
      setStatus("error");
      setError(`Google denied access: ${errorParam}`);
      return;
    }

    if (!code) {
      setStatus("error");
      setError("No authorization code received from Google");
      return;
    }

    completeNestAuth(code)
      .then((result) => {
        setStatus("success");
        setDevices(result.devices || []);
        setTimeout(() => {
          window.location.href = "/settings";
        }, 2000);
      })
      .catch((err) => {
        setStatus("error");
        setError(err.message);
      });
  }, [searchParams]);

  return (
    <div className="max-w-sm w-full text-center space-y-4">
      {status === "loading" && (
        <>
          <span className="inline-block w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Connecting Nest thermostat...</p>
        </>
      )}
      {status === "success" && (
        <>
          <div className="text-4xl">🌡️</div>
          <h2 className="text-lg font-semibold text-green-400">Nest Connected</h2>
          <p className="text-sm text-gray-400">
            Found {devices.length} thermostat{devices.length !== 1 ? "s" : ""}. Redirecting to settings...
          </p>
        </>
      )}
      {status === "error" && (
        <>
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-semibold text-red-400">Connection Failed</h2>
          <p className="text-sm text-gray-400">{error}</p>
          <a href="/settings" className="inline-block mt-4 text-yellow-500 hover:text-yellow-400 text-sm">
            Back to Settings
          </a>
        </>
      )}
    </div>
  );
}

export default function NestCallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 px-4">
      <Suspense fallback={
        <div className="text-center">
          <span className="inline-block w-8 h-8 border-2 border-yellow-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 mt-4">Loading...</p>
        </div>
      }>
        <NestCallbackInner />
      </Suspense>
    </div>
  );
}
