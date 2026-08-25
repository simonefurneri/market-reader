"use client";

import React, { useState } from "react";
import { ChartSection } from "@/components/ChartSection";
import { AnalysisPanel } from "@/components/AnalysisPanel";
import { Clock, TrendingUp } from "lucide-react";

export default function Home() {
  const [selectedSymbol, setSelectedSymbol] = useState<string>("XAU/USD");
  const [selectedTimeframe, setSelectedTimeframe] = useState<string>("15M");

  const symbols = ["XAU/USD", "EUR/USD"];
  const timeframes = ["15M", "1H"];

  return (
    <main className="flex-1 p-3 sm:p-5 lg:p-6 max-w-7xl mx-auto w-full flex flex-col space-y-4">
      {/* Top Control Bar: Selettori Symbol & Timeframe condivisi */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 border border-slate-800 rounded-xl px-4 py-2.5 backdrop-blur-sm shadow-sm">
        <div className="flex items-center gap-4 sm:gap-6 flex-wrap">
          {/* 1. Selettore Simbolo (Condiviso tra Grafico e Analisi AI) */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
              Simbolo:
            </span>
            <div className="flex items-center rounded-lg bg-slate-950/80 p-0.5 border border-slate-800">
              {symbols.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSelectedSymbol(sym)}
                  className={`px-3 py-1 rounded-md text-xs font-mono font-semibold transition-all cursor-pointer ${
                    selectedSymbol === sym
                      ? "bg-blue-600 text-white shadow-sm ring-1 ring-blue-400/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Selettore Timeframe Grafico (Riguarda solo il grafico) */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-purple-400" />
              Timeframe Grafico:
            </span>
            <div className="flex items-center rounded-lg bg-slate-950/80 p-0.5 border border-slate-800">
              {timeframes.map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setSelectedTimeframe(tf)}
                  className={`px-2.5 py-1 rounded-md text-xs font-mono font-semibold transition-all cursor-pointer ${
                    selectedTimeframe === tf
                      ? "bg-purple-600 text-white shadow-sm ring-1 ring-purple-400/30"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-slate-500 font-mono hidden md:block">
          Analisi AI: 15M primario + 1H conferma ({selectedSymbol})
        </div>
      </div>

      {/* 2-column responsive layout: Desktop = side-by-side, Mobile = stacked */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 sm:gap-6 min-h-[calc(100vh-11rem)]">
        {/* Left Column: Candlestick Chart */}
        <ChartSection symbol={selectedSymbol} timeframe={selectedTimeframe} />

        {/* Right Column (stacks below on mobile): Analysis Panel */}
        <AnalysisPanel selectedSymbol={selectedSymbol} />
      </div>
    </main>
  );
}

