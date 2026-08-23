import React from "react";
import { CandleChart } from "@/components/CandleChart";

export function ChartSection() {
  return (
    <section className="flex-1 flex flex-col min-h-[500px] lg:min-h-0 bg-slate-900/40 rounded-xl border border-slate-800 p-4 sm:p-5 relative overflow-hidden">
      <CandleChart symbolName="XAU/USD" intervalName="15m" autoRefreshIntervalSeconds={60} />
    </section>
  );
}
