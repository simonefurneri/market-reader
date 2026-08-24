"use client";

import React, { useState, useEffect, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  RefreshCw,
  Clock,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Send,
  Radio,
  TrendingUp,
  Database,
  ArrowLeft,
  ShieldCheck,
  Moon,
  Info,
} from "lucide-react";
import { MarketCheckLog } from "@/lib/kv";

interface StatusDashboardProps {
  initialLog: MarketCheckLog | null;
}

const STATUS_REFRESH_INTERVAL_SECONDS = 30;

export function StatusDashboard({ initialLog }: StatusDashboardProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [countdown, setCountdown] = useState<number>(STATUS_REFRESH_INTERVAL_SECONDS);
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    setCountdown(STATUS_REFRESH_INTERVAL_SECONDS);
    startTransition(() => {
      router.refresh();
      setTimeout(() => setIsRefreshing(false), 500);
    });
  }, [router]);

  // Countdown timer e auto-refresh ogni 30 secondi
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
      setCountdown((prev) => {
        if (prev <= 1) {
          handleRefresh();
          return STATUS_REFRESH_INTERVAL_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [handleRefresh]);

  const formatDateTime = (timestamp: number) => {
    if (!timestamp || timestamp === 0) return "Nessun dato registrato";
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat("it-IT", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Europe/Rome",
    }).format(date);
  };

  const getTimeAgo = (timestamp: number) => {
    if (!timestamp || timestamp === 0) return "";
    const diffSec = Math.max(0, Math.floor((currentTime - timestamp) / 1000));
    if (diffSec < 60) return `${diffSec} sec fa`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min fa`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours} ore fa`;
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Torna al Grafico
            </Link>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
            <Radio className="w-6 h-6 text-blue-500 animate-pulse" />
            Stato Monitoraggio Mercato
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            Registro in tempo reale dell&apos;ultimo controllo automatico eseguito via QStash / CRON.
          </p>
        </div>

        <button
          onClick={handleRefresh}
          disabled={isRefreshing || isPending}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-all active:scale-95 font-mono"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${
              isRefreshing || isPending ? "animate-spin" : ""
            }`}
          />
          {isRefreshing || isPending
            ? "Aggiornamento..."
            : `Aggiorna (${countdown}s)`}
        </button>
      </div>

      {/* Main Status Cards */}
      {!initialLog ? (
        <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-8 text-center">
          <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-300">
            Nessun log recente trovato in Redis
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            Il primo controllo schedulato da QStash o eseguito manualmente su
            <code className="mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-slate-300">
              /api/check-market
            </code>
            salverà automaticamente lo stato.
          </p>
        </div>
      ) : (
        <>
          {/* Top Metric Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Card 1: Orario Ultimo Controllo */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">
                  Ultimo Controllo
                </span>
                <Clock className="w-4 h-4 text-blue-400" />
              </div>
              <div>
                <div className="text-base font-bold text-white font-mono">
                  {getTimeAgo(initialLog.timestamp)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {formatDateTime(initialLog.timestamp)}
                </div>
              </div>
            </div>

            {/* Card 2: Stato Mercato */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">
                  Stato Mercato
                </span>
                {initialLog.marketOpen ? (
                  <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                ) : (
                  <Moon className="w-4 h-4 text-amber-400" />
                )}
              </div>
              <div>
                <div
                  className={`text-base font-bold flex items-center gap-1.5 ${
                    initialLog.marketOpen ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      initialLog.marketOpen
                        ? "bg-emerald-400"
                        : "bg-amber-400"
                    }`}
                  />
                  {initialLog.marketOpen ? "Aperto (24h)" : "Chiuso"}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                  XAU/USD Forex Session
                </div>
              </div>
            </div>

            {/* Card 3: Segnale Rilevato & Persistenza */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">
                  Segnale Persistente
                </span>
                <TrendingUp className="w-4 h-4 text-purple-400" />
              </div>
              <div>
                <div className="text-base font-bold text-white flex items-center gap-2 font-mono">
                  <span>{initialLog.consecutiveSignalCount} / 3</span>
                  <span className="text-xs font-normal text-slate-400">
                    controlli
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      initialLog.consecutiveSignalCount >= 3
                        ? "bg-emerald-500"
                        : initialLog.consecutiveSignalCount > 0
                        ? "bg-blue-500"
                        : "bg-slate-700"
                    }`}
                    style={{
                      width: `${Math.min(
                        (initialLog.consecutiveSignalCount / 3) * 100,
                        100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Card 4: Notifica Telegram */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">
                  Alert Telegram
                </span>
                <Send className="w-4 h-4 text-sky-400" />
              </div>
              <div>
                <div
                  className={`text-base font-bold flex items-center gap-1.5 ${
                    initialLog.alertSent ? "text-emerald-400" : "text-slate-300"
                  }`}
                >
                  {initialLog.alertSent ? (
                    <>
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      Inviato
                    </>
                  ) : (
                    "In attesa / Non inviato"
                  )}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Cooldown: 60 min
                </div>
              </div>
            </div>
          </div>

          {/* Outcome Detail Panel */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-400" />
                Dettaglio Ultimo Esito
              </h2>
              {initialLog.currentPrice && (
                <div className="text-xs text-slate-400 font-mono bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
                  Prezzo XAU/USD:{" "}
                  <span className="text-emerald-400 font-semibold">
                    ${initialLog.currentPrice.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {/* Main Outcome Message Box */}
            <div
              className={`p-4 rounded-lg border text-sm flex items-start gap-3 ${
                initialLog.alertSent
                  ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-200"
                  : initialLog.signalDetected
                  ? "bg-blue-950/30 border-blue-500/30 text-blue-200"
                  : "bg-slate-800/40 border-slate-700/60 text-slate-300"
              }`}
            >
              {initialLog.alertSent ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : initialLog.signalDetected ? (
                <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-semibold text-white">
                  {initialLog.message}
                </div>
                {initialLog.motivi && initialLog.motivi.length > 0 && (
                  <div className="pt-2 text-xs space-y-1 text-slate-300">
                    <div className="font-medium text-slate-400">
                      Condizioni Rilevate (
                      {initialLog.condizioniSoddisfatte ?? 0}/3):
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 pl-1">
                      {initialLog.motivi.map((m, idx) => (
                        <li key={idx}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Technical Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs text-slate-400 border-t border-slate-800/60">
              <div>
                <span className="text-slate-500">Metodo Autenticazione:</span>{" "}
                <span className="text-slate-300 font-mono">
                  {initialLog.authType?.toUpperCase() || "CRON_SECRET / QSTASH"}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Conservazione Redis:</span>{" "}
                <span className="text-slate-300">TTL 24 Ore (lastCheckLog)</span>
              </div>
              <div>
                <span className="text-slate-500">Soglia Attivazione:</span>{" "}
                <span className="text-slate-300">
                  3 verifiche consecutive
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
