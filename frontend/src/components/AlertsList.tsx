"use client";

import type { Alert } from "@/lib/api";

export default function AlertsList({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h2 className="text-sm font-semibold text-gray-400 mb-2">
          Recent Alerts
        </h2>
        <p className="text-sm text-gray-500">No alerts yet</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
      <h2 className="text-sm font-semibold text-gray-400 mb-3">
        Recent Alerts
      </h2>
      <div className="space-y-3">
        {alerts.slice(0, 5).map((alert) => (
          <div
            key={alert.id}
            className="border-l-2 border-yellow-500 pl-3 py-1"
          >
            <div className="text-sm text-gray-300">{alert.message}</div>
            <div className="text-xs text-gray-500 mt-1">
              {new Date(alert.fired_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
