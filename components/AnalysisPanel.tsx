"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Activity,
  Zap,
  Eye,
  Layers,
  Clock,
  RefreshCw,
  AlertTriangle,
  ShieldAlert,
  Moon,
  Target,
} from "lucide-react";
import { fetchMarketData } from "@/lib/marketData";
import { calculateTechnicalIndicators } from "@/lib/indicators";
import {
  ExtendedMarketAnalysisResponse,
  TechnicalIndicatorsSummary,
} from "@/lib/types";

export interface AnalysisPanelProps {
  autoRefreshIntervalSeconds?: number;
}

export function AnalysisPanel({
  autoRefreshIntervalSeconds = 90, // Aggiornamento ogni 90 secondi per ottimizzare le chiamate AI
}: AnalysisPanelProps) {
  const [analysis, setAnalysis] =
    useState<ExtendedMarketAnalysisResponse | null>(null);
  const [indicators, setIndicators] =
    useState<TechnicalIndicatorsSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number>(autoRefreshIntervalSeconds);

  const runAnalysis = useCallback(async (isPolling = false) => {
    try {
      if (isPolling) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      // 1. Recupero dati candele live
      const candles = await fetchMarketData();
      if (!candles || candles.length === 0) {
        throw new Error("Nessun dato di mercato disponibile per l'analisi.");
      }

      // 2. Calcolo indicatori tecnici
      const calculatedIndicators = calculateTechnicalIndicators(candles);
      setIndicators(calculatedIndicators);

      // 3. Chiamata alla route /api/analyze (con analyzeMarket unificato)
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ indicators: calculatedIndicators }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Errore HTTP ${response.status}`);
      }

      setAnalysis(result.data as ExtendedMarketAnalysisResponse);
      if (result.modelUsed) {
        setModelUsed(result.modelUsed);
      }
      setLastUpdated(new Date());
      setCountdown(autoRefreshIntervalSeconds);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Errore sconosciuto durante l'elaborazione dell'analisi";
      setError(message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [autoRefreshIntervalSeconds]);

  const handleManualRefresh = useCallback(() => {
    setCountdown(autoRefreshIntervalSeconds);
    runAnalysis(false);
  }, [autoRefreshIntervalSeconds, runAnalysis]);

  // Fetch iniziale
  useEffect(() => {
    runAnalysis(false);
  }, [runAnalysis]);

  // Timer per countdown decrescente secondo per secondo e auto-refresh a zero
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          runAnalysis(true);
          return autoRefreshIntervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [runAnalysis, autoRefreshIntervalSeconds]);

  // Helper per badge Trend
  const renderTrendBadge = (trend?: "rialzista" | "ribassista" | "laterale") => {
    if (trend === "rialzista") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <TrendingUp className="w-3.5 h-3.5" /> Rialzista
        </span>
      );
    }
    if (trend === "ribassista") {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
          <TrendingDown className="w-3.5 h-3.5" /> Ribassista
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
        <Activity className="w-3.5 h-3.5" /> Laterale
      </span>
    );
  };

  // Helper per Volatilità (Barra visiva)
  const renderVolatilityGauge = (vol?: "bassa" | "media" | "alta") => {
    let filledBars = 1;
    let colorClass = "bg-emerald-500";
    let label = "Bassa";

    if (vol === "media") {
      filledBars = 2;
      colorClass = "bg-amber-400";
      label = "Media";
    } else if (vol === "alta") {
      filledBars = 3;
      colorClass = "bg-red-500";
      label = "Alta";
    }

    return (
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          {[1, 2, 3].map((bar) => (
            <div
              key={bar}
              className={`w-2 h-4 rounded-sm transition-all ${
                bar <= filledBars ? colorClass : "bg-slate-800"
              }`}
            />
          ))}
        </div>
        <span className="text-xs font-medium text-slate-300">{label}</span>
      </div>
    );
  };

  return (
    <aside className="w-full lg:w-96 flex flex-col justify-between bg-slate-900/50 rounded-xl border border-slate-800 p-4 sm:p-5 relative overflow-hidden backdrop-blur">
      {/* Intestazione Pannello */}
      <div>
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                Analisi AI
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
                  {modelUsed ? modelUsed.replace("gemini-", "") : "Gemini"}
                </span>
              </h2>
              <p className="text-xs text-slate-400">Lettura assistita del mercato</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50 text-xs font-mono"
            title="Ricalcola analisi ora"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                refreshing ? "animate-spin text-purple-400" : ""
              }`}
            />
            <span className="text-[11px] text-slate-300 font-medium">
              {refreshing ? "Analisi..." : `Aggiorna (${countdown}s)`}
            </span>
          </button>
        </div>

        {/* Banner Giallo se Mercato Chiuso / Weekend */}
        {analysis?.mercato_chiuso && (
          <div className="mb-3.5 p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-start gap-2.5">
            <Moon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200 font-medium leading-relaxed">
              Mercato chiuso o a bassa liquidità — l&apos;analisi qui sotto è meno affidabile.
            </p>
          </div>
        )}

        {/* Loading Skeleton State */}
        {loading && (
          <div className="space-y-4 animate-pulse">
            <div className="p-3.5 rounded-lg bg-slate-800/30 border border-slate-800 space-y-3">
              <div className="flex justify-between items-center">
                <div className="h-4 bg-slate-800 rounded w-24"></div>
                <div className="h-6 bg-slate-800 rounded-full w-20"></div>
              </div>
              <div className="h-4 bg-slate-800 rounded w-32"></div>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-800/30 border border-slate-800 space-y-2">
              <div className="h-4 bg-slate-800 rounded w-28"></div>
              <div className="h-3 bg-slate-800 rounded w-full"></div>
              <div className="h-3 bg-slate-800 rounded w-4/5"></div>
            </div>
            <div className="p-3.5 rounded-lg bg-slate-800/30 border border-slate-800 space-y-2">
              <div className="h-4 bg-slate-800 rounded w-28"></div>
              <div className="h-3 bg-slate-800 rounded w-full"></div>
            </div>
            <p className="text-[11px] text-center text-slate-500 py-1">
              Calcolo indicatori & interrogazione modello Gemini...
            </p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="p-4 rounded-lg bg-red-950/20 border border-red-500/20 mb-4 text-center">
            <AlertTriangle className="w-5 h-5 text-red-400 mx-auto mb-2" />
            <h4 className="text-xs font-semibold text-red-300 mb-1">
              Analisi non disponibile
            </h4>
            <p className="text-[11px] text-red-400/90 mb-3 leading-relaxed">
              {error}
            </p>
            <button
              type="button"
              onClick={() => runAnalysis(false)}
              className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white border border-slate-700 transition-colors"
            >
              Riprova
            </button>
          </div>
        )}

        {/* Risultato Analisi */}
        {!loading && analysis && (
          <div className="space-y-3.5">
            {/* Scheda Trend & Volatilità */}
            <div className="p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/50 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">
                    Trend Identificato
                  </span>
                  {renderTrendBadge(analysis.trend)}
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-slate-400 font-medium block mb-1">
                    Forza Trend
                  </span>
                  <span className="text-xs font-semibold capitalize text-slate-200 bg-slate-700/50 px-2.5 py-1 rounded-md border border-slate-600/50">
                    {analysis.forza_trend}
                  </span>
                </div>
              </div>

              <div className="pt-2.5 border-t border-slate-700/40 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Volatilità (ATR)
                </span>
                {renderVolatilityGauge(analysis.volatilita)}
              </div>
            </div>

            {/* Livelli Chiave */}
            {analysis.livelli_chiave && analysis.livelli_chiave.length > 0 && (
              <div className="p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
                  <Layers className="w-3.5 h-3.5 text-blue-400" />
                  <span>Livelli Chiave di Prezzo</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.livelli_chiave.map((livello, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2.5 py-1 rounded bg-slate-900/80 text-blue-300 border border-slate-700 font-mono font-medium"
                    >
                      {livello}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Sezione Evidenziata: Parametri Operativi Indicativi (visibile se presenti) */}
            {analysis.parametri_operativi &&
              (analysis.parametri_operativi.entry_price ||
                analysis.parametri_operativi.stop_loss ||
                analysis.parametri_operativi.take_profit) && (
                <div className="p-3.5 rounded-lg bg-gradient-to-br from-blue-950/40 via-slate-850 to-purple-950/30 border border-blue-500/30 shadow-sm space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-300">
                      <Target className="w-4 h-4 text-blue-400" />
                      <span>Parametri Operativi Indicativi</span>
                    </div>
                    {analysis.parametri_operativi.tipo_operazione &&
                      analysis.parametri_operativi.tipo_operazione !==
                        "nessuna" && (
                        <span
                          className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                            analysis.parametri_operativi.tipo_operazione ===
                            "long"
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : "bg-red-500/20 text-red-300 border-red-500/40"
                          }`}
                        >
                          {analysis.parametri_operativi.tipo_operazione}
                        </span>
                      )}
                  </div>

                  {/* Griglia Valori: Entry, Stop Loss, Take Profit */}
                  <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                    <div className="p-2 rounded bg-slate-900/80 border border-slate-700/60">
                      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                        Entry
                      </div>
                      <div className="text-xs font-bold text-white font-mono mt-0.5 truncate">
                        {analysis.parametri_operativi.entry_price || "--"}
                      </div>
                    </div>

                    <div className="p-2 rounded bg-slate-900/80 border border-red-500/30">
                      <div className="text-[10px] font-medium text-red-400 uppercase tracking-wider">
                        Stop Loss
                      </div>
                      <div className="text-xs font-bold text-red-300 font-mono mt-0.5 truncate">
                        {analysis.parametri_operativi.stop_loss || "--"}
                      </div>
                    </div>

                    <div className="p-2 rounded bg-slate-900/80 border border-emerald-500/30">
                      <div className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider">
                        Take Profit
                      </div>
                      <div className="text-xs font-bold text-emerald-300 font-mono mt-0.5 truncate">
                        {analysis.parametri_operativi.take_profit || "--"}
                      </div>
                    </div>
                  </div>

                  {/* Disclaimer Rischio Specifico */}
                  {analysis.parametri_operativi.rischio && (
                    <p className="text-[10px] text-slate-400 italic leading-relaxed pt-1 border-t border-slate-700/40">
                      ⚠️ {analysis.parametri_operativi.rischio}
                    </p>
                  )}
                </div>
              )}

            {/* Scenario Probabile */}
            <div className="p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Scenario Probabile</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {analysis.scenario_probabile}
              </p>
            </div>

            {/* Cosa Osservare */}
            <div className="p-3.5 rounded-lg bg-purple-950/20 border border-purple-500/20">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300 mb-1.5">
                <Eye className="w-3.5 h-3.5 text-purple-400" />
                <span>Cosa Monitorare</span>
              </div>
              <p className="text-xs text-purple-200/90 leading-relaxed">
                {analysis.cosa_osservare}
              </p>
            </div>

            {/* Indicatori Tecnici Quick Glance */}
            {indicators && (
              <div className="px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between font-mono">
                <span>RSI: {indicators.rsi14 ?? "--"}</span>
                <span>EMA20: ${indicators.ema20 ?? "--"}</span>
                <span>EMA50: ${indicators.ema50 ?? "--"}</span>
              </div>
            )}

            {/* Ultimo aggiornamento con Countdown dinamico */}
            {lastUpdated && (
              <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 font-mono">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {lastUpdated.toLocaleTimeString("it-IT", { hour12: false })}
                </span>
                <span className="text-slate-400">
                  Auto-refresh in:{" "}
                  <span className="text-purple-400 font-semibold">{countdown}s</span>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Disclaimer Obbligatorio Fisso in Fondo */}
      <div className="mt-5 pt-3.5 border-t border-slate-800/80">
        <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/60 flex items-start gap-2">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400/80 shrink-0 mt-0.5" />
          <p className="text-[10px] text-slate-400 leading-normal">
            Analisi educativa generata da IA, non è un consiglio di investimento. Fai sempre le tue verifiche prima di operare, specialmente su conto reale.
          </p>
        </div>
      </div>
    </aside>
  );
}
