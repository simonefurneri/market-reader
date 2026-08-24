"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
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
  Filter,
  History,
  Check,
  X,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { MarketCheckLog } from "@/lib/kv";

interface StatusDashboardProps {
  initialLog: MarketCheckLog | null;
  initialHistory?: MarketCheckLog[];
}

const STATUS_REFRESH_INTERVAL_SECONDS = 30;

export function StatusDashboard({
  initialLog,
  initialHistory = [],
}: StatusDashboardProps) {
  const [log, setLog] = useState<MarketCheckLog | null>(initialLog);
  const [history, setHistory] = useState<MarketCheckLog[]>(initialHistory);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [countdown, setCountdown] = useState<number>(
    STATUS_REFRESH_INTERVAL_SECONDS
  );
  const [currentTime, setCurrentTime] = useState<number>(() => Date.now());

  // Filtri tabella storico
  const [onlyMarketOpen, setOnlyMarketOpen] = useState(false);
  const [onlySignals, setOnlySignals] = useState(false);
  const [displayLimit, setDisplayLimit] = useState<number>(50);

  const fetchLatestLog = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/status-log");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          if (data.log) {
            setLog(data.log);
          }
          if (Array.isArray(data.history)) {
            setHistory(data.history);
          }
        }
      }
    } catch (err) {
      console.warn("[StatusDashboard] Errore aggiornamento log:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const handleManualRefresh = () => {
    setCountdown(STATUS_REFRESH_INTERVAL_SECONDS);
    fetchLatestLog();
  };

  // Timer per il countdown decrescente e aggiornamento del tempo relativo
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
      setCountdown((prev) => {
        if (prev <= 1) {
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Quando il countdown raggiunge 0, esegue il fetch fuori dalla pipeline di rendering
  useEffect(() => {
    if (countdown === 0) {
      setCountdown(STATUS_REFRESH_INTERVAL_SECONDS);
      fetchLatestLog();
    }
  }, [countdown, fetchLatestLog]);

  const formatDateTime = (timestamp: number) => {
    if (!timestamp || timestamp === 0) return "-";
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat("it-IT", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Europe/Rome",
    }).format(date);
  };

  const formatTimeOnly = (timestamp: number) => {
    if (!timestamp || timestamp === 0) return "-";
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Europe/Rome",
    }).format(date);
  };

  const getTimeAgo = (timestamp: number) => {
    if (!timestamp || timestamp === 0) return "";
    const diffSec = Math.max(0, Math.floor((currentTime - timestamp) / 1000));
    if (diffSec < 60) return `${diffSec}s fa`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m fa`;
    const diffHours = Math.floor(diffMin / 60);
    return `${diffHours}h fa`;
  };

  // Statistiche calcolate sulla cronologia complessiva
  const historyStats = useMemo(() => {
    const total = history.length;
    const marketOpenCount = history.filter((h) => h.marketOpen).length;
    const signalsDetectedCount = history.filter((h) => h.signalDetected).length;
    const alertsSentCount = history.filter((h) => h.alertSent).length;

    return {
      total,
      marketOpenCount,
      signalsDetectedCount,
      alertsSentCount,
    };
  }, [history]);

  // Lista filtrata in base alle preferenze dell'utente
  const filteredHistory = useMemo(() => {
    return history
      .filter((item) => {
        if (onlyMarketOpen && !item.marketOpen) return false;
        if (onlySignals && !item.signalDetected) return false;
        return true;
      })
      .slice(0, displayLimit);
  }, [history, onlyMarketOpen, onlySignals, displayLimit]);

  return (
    <div className="space-y-8">
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
            Registro in tempo reale dell&apos;ultimo controllo automatico e storico verifiche (24h) via Redis.
          </p>
        </div>

        <button
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="self-start sm:self-auto inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-all active:scale-95 font-mono"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing ? "Aggiornamento..." : `Aggiorna (${countdown}s)`}
        </button>
      </div>

      {/* Main Status Cards */}
      {!log ? (
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
        <div className="space-y-6">
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
                  {getTimeAgo(log.timestamp)}
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {formatDateTime(log.timestamp)}
                </div>
              </div>
            </div>

            {/* Card 2: Stato Mercato */}
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-slate-400 mb-2">
                <span className="text-xs font-medium uppercase tracking-wider">
                  Stato Mercato
                </span>
                {log.marketOpen ? (
                  <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                ) : (
                  <Moon className="w-4 h-4 text-amber-400" />
                )}
              </div>
              <div>
                <div
                  className={`text-base font-bold flex items-center gap-1.5 ${
                    log.marketOpen ? "text-emerald-400" : "text-amber-400"
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      log.marketOpen ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                  {log.marketOpen ? "Aperto (24h)" : "Chiuso"}
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
                  <span>{log.consecutiveSignalCount} / 3</span>
                  <span className="text-xs font-normal text-slate-400">
                    controlli
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      log.consecutiveSignalCount >= 3
                        ? "bg-emerald-500"
                        : log.consecutiveSignalCount > 0
                        ? "bg-blue-500"
                        : "bg-slate-700"
                    }`}
                    style={{
                      width: `${Math.min(
                        (log.consecutiveSignalCount / 3) * 100,
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
                    log.alertSent ? "text-emerald-400" : "text-slate-300"
                  }`}
                >
                  {log.alertSent ? (
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
              {log.currentPrice && (
                <div className="text-xs text-slate-400 font-mono bg-slate-800/80 px-2.5 py-1 rounded-md border border-slate-700">
                  Prezzo XAU/USD:{" "}
                  <span className="text-emerald-400 font-semibold">
                    ${log.currentPrice.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            {/* Main Outcome Message Box */}
            <div
              className={`p-4 rounded-lg border text-sm flex items-start gap-3 ${
                log.alertSent
                  ? "bg-emerald-950/30 border-emerald-500/30 text-emerald-200"
                  : log.signalDetected
                  ? "bg-blue-950/30 border-blue-500/30 text-blue-200"
                  : "bg-slate-800/40 border-slate-700/60 text-slate-300"
              }`}
            >
              {log.alertSent ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              ) : log.signalDetected ? (
                <AlertTriangle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              ) : (
                <ShieldCheck className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <div className="font-semibold text-white">{log.message}</div>
                {log.motivi && log.motivi.length > 0 && (
                  <div className="pt-2 text-xs space-y-1 text-slate-300">
                    <div className="font-medium text-slate-400">
                      Condizioni Rilevate ({log.condizioniSoddisfatte ?? 0}/3):
                    </div>
                    <ul className="list-disc list-inside space-y-0.5 pl-1">
                      {log.motivi.map((m, idx) => (
                        <li key={idx}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Technical Indicators Row for Last Check */}
            {(log.rsi !== undefined || log.atr !== undefined) && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">RSI (14)</div>
                  <div className="text-sm font-bold font-mono text-white mt-0.5">
                    {typeof log.rsi === "number" ? log.rsi.toFixed(2) : "-"}
                  </div>
                </div>
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">ATR Corrente</div>
                  <div className="text-sm font-bold font-mono text-white mt-0.5">
                    {typeof log.atr === "number" ? `$${log.atr.toFixed(2)}` : "-"}
                  </div>
                </div>
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">ATR Media (20p)</div>
                  <div className="text-sm font-bold font-mono text-white mt-0.5">
                    {typeof log.atrAvg === "number"
                      ? `$${log.atrAvg.toFixed(2)}`
                      : "-"}
                  </div>
                </div>
                <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3">
                  <div className="text-[11px] text-slate-400">Rottura Livello</div>
                  <div className="text-sm font-bold text-white mt-0.5 flex items-center gap-1.5">
                    {log.breakoutDetected ? (
                      <span className="text-purple-400 inline-flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" />
                        {log.breakoutType ? log.breakoutType.toUpperCase() : "Sì"}
                      </span>
                    ) : (
                      <span className="text-slate-500 inline-flex items-center gap-1">
                        <X className="w-3.5 h-3.5" />
                        No
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Technical Metadata */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 text-xs text-slate-400 border-t border-slate-800/60">
              <div>
                <span className="text-slate-500">Metodo Autenticazione:</span>{" "}
                <span className="text-slate-300 font-mono">
                  {log.authType?.toUpperCase() || "CRON_SECRET / QSTASH"}
                </span>
              </div>
              <div>
                <span className="text-slate-500">Conservazione Redis:</span>{" "}
                <span className="text-slate-300">
                  TTL 24h &amp; Lista checkHistory
                </span>
              </div>
              <div>
                <span className="text-slate-500">Soglia Attivazione:</span>{" "}
                <span className="text-slate-300">3 verifiche consecutive</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* SEZIONE TABELLA STORICO DEI CONTROLLI (REDIS checkHistory - max 288)      */}
      {/* ========================================================================= */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 sm:p-6 space-y-5">
        {/* Table Header with Title & Stats */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-blue-400" />
              Storico Controlli Mercato (Ultime 24h)
            </h2>
            <p className="text-xs text-slate-400">
              Registro cronologico dei controlli salvati su Redis (lista{" "}
              <code className="px-1 py-0.5 bg-slate-800 rounded text-slate-300 font-mono">
                checkHistory
              </code>
              , max 288 voci).
            </p>
          </div>

          {/* Stat Mini Badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
              Totale: <strong className="text-white">{historyStats.total}</strong>
            </span>
            <span className="px-2.5 py-1 rounded-md bg-emerald-950/40 text-emerald-300 border border-emerald-800/40">
              Mercato Aperto:{" "}
              <strong className="text-emerald-400">
                {historyStats.marketOpenCount}
              </strong>
            </span>
            <span className="px-2.5 py-1 rounded-md bg-purple-950/40 text-purple-300 border border-purple-800/40">
              Segnali:{" "}
              <strong className="text-purple-400">
                {historyStats.signalsDetectedCount}
              </strong>
            </span>
            {historyStats.alertsSentCount > 0 && (
              <span className="px-2.5 py-1 rounded-md bg-sky-950/40 text-sky-300 border border-sky-800/40">
                Alert:{" "}
                <strong className="text-sky-400">
                  {historyStats.alertsSentCount}
                </strong>
              </span>
            )}
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/50 p-3 rounded-lg border border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 flex items-center gap-1.5 font-medium mr-1">
              <Filter className="w-3.5 h-3.5 text-blue-400" />
              Filtri:
            </span>

            {/* Quick Filter: Solo Mercato Aperto */}
            <button
              onClick={() => setOnlyMarketOpen((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                onlyMarketOpen
                  ? "bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-400/30"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Solo Mercato Aperto
              {onlyMarketOpen && (
                <span className="ml-1 px-1.5 py-0.2 rounded bg-emerald-800 text-[10px]">
                  Attivo
                </span>
              )}
            </button>

            {/* Filter: Solo Segnali Rilevati */}
            <button
              onClick={() => setOnlySignals((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                onlySignals
                  ? "bg-purple-600 text-white shadow-sm ring-2 ring-purple-400/30"
                  : "bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              Solo Segnali
            </button>
          </div>

          {/* Rows Limit Selector */}
          <div className="flex items-center gap-2 self-end sm:self-auto text-xs text-slate-400">
            <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
            <span>Mostra:</span>
            <select
              value={displayLimit}
              onChange={(e) => setDisplayLimit(Number(e.target.value))}
              aria-label="Numero di righe da visualizzare"
              className="bg-slate-800 border border-slate-700 text-slate-200 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={20}>Ultimi 20</option>
              <option value={50}>Ultimi 50</option>
              <option value={100}>Ultimi 100</option>
              <option value={288}>Tutti (288)</option>
            </select>
          </div>
        </div>

        {/* History Table */}
        {filteredHistory.length === 0 ? (
          <div className="text-center py-10 border border-dashed border-slate-800 rounded-lg">
            <History className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-400 font-medium">
              Nessun check corrisponde ai filtri selezionati
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {history.length === 0
                ? "La lista checkHistory su Redis è vuota. I check automatici verranno aggiunti man mano."
                : "Prova a disattivare il filtro 'Solo Mercato Aperto' o 'Solo Segnali'."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th scope="col" className="px-3.5 py-3">
                    Orario
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Mercato
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Segnale
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    RSI (14)
                  </th>
                  <th scope="col" className="px-3 py-3 text-right">
                    ATR (vs Media)
                  </th>
                  <th scope="col" className="px-3 py-3 text-center">
                    Rottura Liv.
                  </th>
                  <th scope="col" className="px-3 py-3 text-center">
                    Persistenza
                  </th>
                  <th scope="col" className="px-3.5 py-3">
                    Messaggio / Esito
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 bg-slate-900/40">
                {filteredHistory.map((item, index) => {
                  const hasRsi =
                    typeof item.rsi === "number" && !isNaN(item.rsi);
                  const isRsiOverbought = hasRsi && item.rsi! >= 60;
                  const isRsiOversold = hasRsi && item.rsi! <= 40;

                  return (
                    <tr
                      key={`${item.timestamp}-${index}`}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        item.alertSent
                          ? "bg-emerald-950/20"
                          : item.signalDetected
                          ? "bg-purple-950/15"
                          : ""
                      }`}
                    >
                      {/* 1. Orario */}
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <div className="font-mono font-medium text-slate-200">
                          {formatTimeOnly(item.timestamp)}
                        </div>
                        <div className="text-[10px] text-slate-500 flex items-center gap-1 font-mono">
                          <span>{getTimeAgo(item.timestamp)}</span>
                          <span>•</span>
                          <span>
                            {new Date(item.timestamp).toLocaleDateString("it-IT", {
                              day: "2-digit",
                              month: "2-digit",
                              timeZone: "Europe/Rome",
                            })}
                          </span>
                        </div>
                      </td>

                      {/* 2. Stato Mercato */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {item.marketOpen ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-800/50">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Aperto
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-950/40 text-amber-400 border border-amber-800/40">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            Chiuso
                          </span>
                        )}
                      </td>

                      {/* 3. Segnale Rilevato */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {item.signalDetected ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-950/60 text-purple-300 border border-purple-700/50">
                            <Check className="w-3 h-3 text-purple-400" />
                            Sì
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-slate-400 bg-slate-800/60">
                            <X className="w-3 h-3 text-slate-500" />
                            No
                          </span>
                        )}
                      </td>

                      {/* 4. RSI (14) */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-right font-mono">
                        {hasRsi ? (
                          <span
                            className={`font-semibold ${
                              isRsiOverbought
                                ? "text-emerald-400"
                                : isRsiOversold
                                ? "text-rose-400"
                                : "text-slate-300"
                            }`}
                          >
                            {item.rsi!.toFixed(1)}
                          </span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      {/* 5. ATR Corrente vs Media */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-right font-mono">
                        {typeof item.atr === "number" ? (
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-200">
                              ${item.atr.toFixed(2)}
                            </div>
                            {typeof item.atrAvg === "number" && (
                              <div className="text-[10px] text-slate-500">
                                avg ${item.atrAvg.toFixed(2)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      {/* 6. Rottura Livello (Breakout) */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-center">
                        {item.breakoutDetected ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-900/40 text-purple-300 border border-purple-700/40">
                            {item.breakoutType
                              ? item.breakoutType.toUpperCase()
                              : "BREAKOUT"}
                          </span>
                        ) : item.marketOpen ? (
                          <span className="text-slate-500 text-[11px]">No</span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </td>

                      {/* 7. Consecutive Signal Count */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-center font-mono">
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            item.consecutiveSignalCount >= 3
                              ? "bg-emerald-900/60 text-emerald-300 border border-emerald-700/60"
                              : item.consecutiveSignalCount > 0
                              ? "bg-blue-900/50 text-blue-300 border border-blue-700/50"
                              : "text-slate-500 bg-slate-800/40"
                          }`}
                        >
                          {item.consecutiveSignalCount} / 3
                        </span>
                      </td>

                      {/* 8. Messaggio / Esito */}
                      <td className="px-3.5 py-2.5 max-w-xs sm:max-w-md">
                        <div className="flex items-center gap-1.5">
                          {item.alertSent && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-sky-950 text-sky-300 border border-sky-600/50 shrink-0">
                              <Send className="w-2.5 h-2.5 text-sky-400" />
                              ALERT
                            </span>
                          )}
                          <span
                            className="truncate text-slate-300"
                            title={item.message}
                          >
                            {item.message}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer info */}
        <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-800/60 gap-2">
          <div>
            Mostrando {filteredHistory.length} di {history.length} check
            memorizzati (fino a 24 ore di campionamento a intervalli di 5 min).
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            LTRIM Redis: 288 elementi
          </div>
        </div>
      </div>
    </div>
  );
}

