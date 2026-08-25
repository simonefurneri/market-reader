import React from "react";
import { CandleChart } from "@/components/CandleChart";

export interface ChartSectionProps {
  symbol?: string;
  timeframe?: string;
}

export function ChartSection({
  symbol = "XAU/USD",
  timeframe = "15M",
}: ChartSectionProps) {
  return (
    <section className="flex-1 flex flex-col min-h-[500px] lg:min-h-0 bg-slate-900/40 rounded-xl border border-slate-800 p-4 sm:p-5 relative overflow-hidden">
      <CandleChart
        symbolName={symbol}
        intervalName={timeframe}
        autoRefreshIntervalSeconds={60}
      />
    </section>
  );
}

