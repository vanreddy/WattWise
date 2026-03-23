"use client";

import { Lightbulb } from "lucide-react";

export default function OptimizeTab() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="bg-gray-800/50 rounded-full p-6 mb-4">
        <Lightbulb size={40} className="text-yellow-400/60" />
      </div>
      <h2 className="text-lg font-semibold text-gray-300 mb-2">
        Optimization Insights
      </h2>
      <p className="text-sm text-gray-500 max-w-xs">
        Smart recommendations to reduce your grid costs and maximize solar usage — coming soon.
      </p>
    </div>
  );
}
