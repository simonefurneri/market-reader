"use client";

import React, { useEffect, useState } from "react";
import { Activity, BarChart2, Moon, LogOut } from "lucide-react";
import { getMarketHoursStatus } from "@/lib/marketHours";
import { logoutAction } from "@/app/login/actions";

export function Header() {
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    const updateStatus = () => {
      setIsOpen(getMarketHoursStatus().isOpen);
    };
    updateStatus();
    const interval = setInterval(updateStatus, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur px-4 py-3 sm:px-6 flex items-center justify-between sticky top-0 z-10">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-blue-600/20 text-blue-400 rounded-lg border border-blue-500/30">
          <BarChart2 className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
            MarketReader
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 font-medium">
              v0.1
            </span>
          </h1>
          <p className="text-xs text-slate-400">Analisi Tecnica & Grafici Finanziari (XAU/USD)</p>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        {mounted && (
          <div
            className={`hidden sm:flex items-center gap-2 text-xs px-3 py-1.5 rounded-md border ${
              isOpen
                ? "text-emerald-300 bg-emerald-950/30 border-emerald-500/30"
                : "text-amber-300 bg-amber-950/30 border-amber-500/30"
            }`}
          >
            {isOpen ? (
              <>
                <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span>Mercati Aperti</span>
              </>
            ) : (
              <>
                <Moon className="w-3.5 h-3.5 text-amber-400" />
                <span>Mercato Chiuso (Weekend/Pausa)</span>
              </>
            )}
          </div>
        )}

        <form action={logoutAction}>
          <button
            type="submit"
            className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700 transition-colors flex items-center gap-1.5 text-xs"
            title="Disconnetti"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Esci</span>
          </button>
        </form>
      </div>
    </header>
  );
}
