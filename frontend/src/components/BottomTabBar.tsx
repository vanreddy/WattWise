"use client";

import { Radio, GitBranch, DollarSign, Lightbulb } from "lucide-react";

export type TabId = "now" | "flow" | "savings" | "optimize";

const TABS: { id: TabId; label: string; icon: typeof Radio }[] = [
  { id: "now", label: "Now", icon: Radio },
  { id: "flow", label: "Flow", icon: GitBranch },
  { id: "savings", label: "Savings", icon: DollarSign },
  { id: "optimize", label: "Optimize", icon: Lightbulb },
];

interface Props {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export default function BottomTabBar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/95 backdrop-blur-md border-t border-gray-800 pb-[env(safe-area-inset-bottom)]">
      <div className="flex justify-around items-center h-16 max-w-lg mx-auto">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors ${
                active ? "text-blue-400" : "text-gray-500"
              }`}
            >
              <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
              <span className={`text-[10px] font-medium ${active ? "text-blue-400" : "text-gray-500"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
