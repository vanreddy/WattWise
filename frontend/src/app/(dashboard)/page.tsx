"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { useDashboardData } from "@/hooks/useDashboardData";
import { useWeather } from "@/hooks/useWeather";
import BottomTabBar, { type TabId } from "@/components/BottomTabBar";
import NowTab from "@/components/tabs/NowTab";
import FlowTab from "@/components/tabs/FlowTab";
import SavingsTab from "@/components/tabs/SavingsTab";
import OptimizeTab from "@/components/tabs/OptimizeTab";

export default function Dashboard() {
  const { user, isLoading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>("now");
  const data = useDashboardData();
  const weather = useWeather();

  useEffect(() => {
    if (!authLoading && !user) {
      window.location.href = "/login";
    }
  }, [authLoading, user]);

  if (authLoading || !user) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (data.error && !data.summary) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400 text-lg mb-2">Unable to connect to API</p>
        <p className="text-gray-500 text-sm">{data.error}</p>
      </div>
    );
  }

  if (!data.summary) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <>
      {/* Backfill banner */}
      {data.backfillActive && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-3 flex items-center gap-3 mb-4">
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
          <p className="text-sm text-yellow-400">
            Loading historical data ({data.backfillDays} of 30 days)
            &mdash; 30-day view will unlock when complete
          </p>
        </div>
      )}

      {/* Tab content */}
      <div className="min-h-[calc(100vh-10rem)]">
        {activeTab === "now" && (
          <NowTab
            summary={data.summary}
            lastUpdated={data.lastUpdated}
            error={data.error}
            weather={weather}
          />
        )}

        {activeTab === "flow" && (
          <FlowTab
            daily={data.daily}
            hourly={data.hourly}
            alerts={data.alerts}
            intervalData={data.intervalData}
            sankeyFlows={data.sankeyFlows}
            dateRange={data.dateRange}
            setDateRange={data.setDateRange}
            backfillActive={data.backfillActive}
          />
        )}

        {activeTab === "savings" && (
          <SavingsTab
            daily={data.daily}
            hourly={data.hourly}
            dateRange={data.dateRange}
            setDateRange={data.setDateRange}
          />
        )}

        {activeTab === "optimize" && (
          <OptimizeTab
            summary={data.summary}
            daily={data.daily}
            alerts={data.alerts}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <BottomTabBar activeTab={activeTab} onTabChange={setActiveTab} />
    </>
  );
}
