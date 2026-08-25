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
  AlertTriangle,
  ShieldAlert,
  Moon,
  Target,
  History,
  ArrowLeft,
  ChevronRight,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import {
  ExtendedMarketAnalysisResponse,
  TechnicalIndicatorsSummary,
  StoredManualAnalysis,
} from "@/lib/types";

export interface AnalysisPanelProps {
  selectedSymbol?: string;
}

export function AnalysisPanel({ selectedSymbol = "XAU/USD" }: AnalysisPanelProps) {
  const [activeTab, setActiveTab] = useState<"analysis" | "history">("analysis");
  const [analysis, setAnalysis] =
    useState<ExtendedMarketAnalysisResponse | null>(null);
  const [indicators, setIndicators] =
    useState<TechnicalIndicatorsSummary | null>(null);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [analysisTimestamp, setAnalysisTimestamp] = useState<number | null>(null);

  const [history, setHistory] = useState<StoredManualAnalysis[]>([]);
  const [selectedHistoryItem, setSelectedHistoryItem] =
    useState<StoredManualAnalysis | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Carica lo storico delle analisi da Redis al mounting
  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await fetch("/api/analyze", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.history)) {
        setHistory(json.history);
        // Se non c'è ancora un'analisi corrente caricata e c'è almeno un elemento nello storico,
        // visualizza l'ultima analisi effettuata
        if (json.history.length > 0) {
          setAnalysis((prev) => prev || json.history[0].analysis);
          setIndicators((prev) => prev || json.history[0].indicators);
          setModelUsed((prev) => prev || json.history[0].modelUsed || null);
          setAnalysisTimestamp((prev) => prev || json.history[0].timestamp);
        }
      }
    } catch (err) {
      console.warn("Impossibile caricare lo storico analisi:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Esecuzione manuale dell'analisi AI tramite pulsante "Analizza ora"
  const handleRunAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);
      setActiveTab("analysis");
      setSelectedHistoryItem(null);

      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ symbol: selectedSymbol }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Errore HTTP ${response.status}`);
      }

      const newAnalysis = result.data as ExtendedMarketAnalysisResponse;
      setAnalysis(newAnalysis);
      setModelUsed(result.modelUsed || null);

      if (result.entry) {
        const entry = result.entry as StoredManualAnalysis;
        setIndicators(entry.indicators);
        setAnalysisTimestamp(entry.timestamp);
        // Aggiorna lo storico locale mantenendo max 10 elementi
        setHistory((prev) => [entry, ...prev.filter((i) => i.id !== entry.id)].slice(0, 10));
      } else {
        setAnalysisTimestamp(Date.now());
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Errore sconosciuto durante l'elaborazione dell'analisi";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Helper per badge Trend
  const renderTrendBadge = (trend?: "rialzista" | "ribassista" | "laterale") => {
    if (trend === "rialzista") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
          <TrendingUp className="w-3.5 h-3.5" /> Rialzista
        </span>
      );
    }
    if (trend === "ribassista") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
          <TrendingDown className="w-3.5 h-3.5" /> Ribassista
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
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

  // Helper di rendering del corpo di un'analisi (utilizzato sia per l'analisi corrente che per i dettagli dello storico)
  const renderAnalysisBody = (
    data: ExtendedMarketAnalysisResponse,
    indicatorsData?: TechnicalIndicatorsSummary | null,
    model?: string | null,
    timestamp?: number | null,
    symbolLabel?: string | null
  ) => {
    const isForex = (indicatorsData?.currentPrice ?? 0) < 20;
    const pricePrefix = isForex ? "" : "$";
    const decimals = isForex ? 4 : 2;

    return (
      <div className="space-y-3.5">
        {/* Banner Giallo se Mercato Chiuso / Weekend */}
        {data.mercato_chiuso && (
          <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-start gap-2.5">
            <Moon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-200 font-medium leading-relaxed">
              Mercato chiuso o a bassa liquidità — l&apos;analisi potrebbe essere meno affidabile.
            </p>
          </div>
        )}

        {/* Scheda Trend, Volatilità & Conferma 1H */}
        <div className="p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/50 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-400 font-medium block mb-1">
                Trend 15M (Primario)
              </span>
              {renderTrendBadge(data.trend)}
            </div>

            <div className="text-right">
              <span className="text-[11px] text-slate-400 font-medium block mb-1">
                Forza Trend
              </span>
              <span className="text-xs font-semibold capitalize text-slate-200 bg-slate-700/50 px-2.5 py-1 rounded-md border border-slate-600/50">
                {data.forza_trend}
              </span>
            </div>
          </div>

          {/* Conferma Trend 1H Multi-Timeframe */}
          {data.conferma_trend && (
            <div className="pt-2.5 border-t border-slate-700/40 flex items-center justify-between">
              <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
                Conferma Multi-TF (1H)
              </span>
              {data.conferma_trend.toLowerCase().includes("concorde") ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Concorde
                </span>
              ) : data.conferma_trend.toLowerCase().includes("discorde") ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  <AlertTriangle className="w-3 h-3 text-amber-400" /> Discorde
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                  Neutrale
                </span>
              )}
            </div>
          )}

          <div className="pt-2.5 border-t border-slate-700/40 flex items-center justify-between">
            <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" /> Volatilità (ATR)
            </span>
            {renderVolatilityGauge(data.volatilita)}
          </div>
        </div>


        {/* Livelli Chiave */}
        {data.livelli_chiave && data.livelli_chiave.length > 0 && (
          <div className="p-3.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-300 mb-2">
              <Layers className="w-3.5 h-3.5 text-blue-400" />
              <span>Livelli Chiave di Prezzo</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {data.livelli_chiave.map((livello, idx) => (
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

        {/* Parametri Operativi Indicativi (se presenti) */}
        {data.parametri_operativi &&
          (data.parametri_operativi.entry_price ||
            data.parametri_operativi.stop_loss ||
            data.parametri_operativi.take_profit) && (
            <div className="p-3.5 rounded-lg bg-gradient-to-br from-blue-950/40 via-slate-850 to-purple-950/30 border border-blue-500/30 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-300">
                  <Target className="w-4 h-4 text-blue-400" />
                  <span>Parametri Operativi Indicativi</span>
                </div>
                {data.parametri_operativi.tipo_operazione &&
                  data.parametri_operativi.tipo_operazione !== "nessuna" && (
                    <span
                      className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                        data.parametri_operativi.tipo_operazione === "long"
                          ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                          : "bg-red-500/20 text-red-300 border-red-500/40"
                      }`}
                    >
                      {data.parametri_operativi.tipo_operazione}
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
                    {data.parametri_operativi.entry_price || "--"}
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-900/80 border border-red-500/30">
                  <div className="text-[10px] font-medium text-red-400 uppercase tracking-wider">
                    Stop Loss
                  </div>
                  <div className="text-xs font-bold text-red-300 font-mono mt-0.5 truncate">
                    {data.parametri_operativi.stop_loss || "--"}
                  </div>
                </div>

                <div className="p-2 rounded bg-slate-900/80 border border-emerald-500/30">
                  <div className="text-[10px] font-medium text-emerald-400 uppercase tracking-wider">
                    Take Profit
                  </div>
                  <div className="text-xs font-bold text-emerald-300 font-mono mt-0.5 truncate">
                    {data.parametri_operativi.take_profit || "--"}
                  </div>
                </div>
              </div>

              {/* Disclaimer Rischio Specifico */}
              {data.parametri_operativi.rischio && (
                <p className="text-[10px] text-slate-400 italic leading-relaxed pt-1 border-t border-slate-700/40">
                  ⚠️ {data.parametri_operativi.rischio}
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
            {data.scenario_probabile}
          </p>
        </div>

        {/* Cosa Osservare */}
        <div className="p-3.5 rounded-lg bg-purple-950/20 border border-purple-500/20">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-purple-300 mb-1.5">
            <Eye className="w-3.5 h-3.5 text-purple-400" />
            <span>Cosa Monitorare</span>
          </div>
          <p className="text-xs text-purple-200/90 leading-relaxed">
            {data.cosa_osservare}
          </p>
        </div>

        {/* Indicatori Tecnici Quick Glance */}
        {indicatorsData && (
          <div className="px-3 py-2 rounded-lg bg-slate-950/40 border border-slate-800 text-[11px] text-slate-400 flex items-center justify-between font-mono">
            <span>RSI: {indicatorsData.rsi14 ?? "--"}</span>
            <span>EMA20: ${indicatorsData.ema20 ?? "--"}</span>
            <span>EMA50: ${indicatorsData.ema50 ?? "--"}</span>
          </div>
        )}

        {/* Meta Footer con Timestamp & Modello */}
        <div className="flex items-center justify-between text-[10px] text-slate-500 px-1 font-mono pt-1">
          {timestamp && (
            <span className="flex items-center gap-1 text-slate-400">
              <Clock className="w-3 h-3 text-slate-500" />
              {new Date(timestamp).toLocaleDateString("it-IT", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          )}
          {model && (
            <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
              {model.replace("gemini-", "")}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <aside className="w-full lg:w-96 flex flex-col justify-between bg-slate-900/50 rounded-xl border border-slate-800 p-4 sm:p-5 relative overflow-hidden backdrop-blur">
      <div>
        {/* Intestazione Pannello con Tab Switcher */}
        <div className="pb-3 mb-3 border-b border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
                <Sparkles className="w-4 h-4" />
              </div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                Analisi AI
              </h2>
            </div>

            {/* Pulsante Principale "Analizza ora" */}
            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white border border-purple-400/30 transition-all disabled:opacity-50 text-xs font-semibold shadow-sm hover:shadow-purple-500/20 active:scale-95 cursor-pointer"
              title="Avvia una nuova analisi con dati 15M freschi"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{loading ? "Analisi..." : "Analizza ora"}</span>
            </button>
          </div>

          {/* Navigazione tra le due Tab: "Analisi AI" e "Storico (10)" */}
          <div className="flex items-center rounded-lg bg-slate-950/80 p-1 border border-slate-800">
            <button
              type="button"
              onClick={() => {
                setActiveTab("analysis");
                setSelectedHistoryItem(null);
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === "analysis"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-400" />
              Analisi AI
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                activeTab === "history"
                  ? "bg-slate-800 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <History className="w-3.5 h-3.5 text-blue-400" />
              Storico
              {history.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full bg-slate-700 text-[10px] font-mono text-slate-300">
                  {history.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* TAB 1: ANALISI AI CORRENTE */}
        {activeTab === "analysis" && (
          <div>
            {/* Loading Skeleton */}
            {loading && (
              <div className="space-y-4 animate-pulse pt-2">
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
                <p className="text-[11px] text-center text-slate-500 py-1">
                  Recupero dati freschi 15M & interrogazione modello Gemini...
                </p>
              </div>
            )}

            {/* Error State */}
            {!loading && error && (
              <div className="p-4 rounded-lg bg-red-950/20 border border-red-500/20 mb-4 text-center">
                <AlertTriangle className="w-5 h-5 text-red-400 mx-auto mb-2" />
                <h4 className="text-xs font-semibold text-red-300 mb-1">
                  Analisi non riuscita
                </h4>
                <p className="text-[11px] text-red-400/90 mb-3 leading-relaxed">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={handleRunAnalysis}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-white border border-slate-700 transition-colors"
                >
                  Riprova
                </button>
              </div>
            )}

            {/* Visualizzazione Analisi Attiva */}
            {!loading && !error && analysis && (
              renderAnalysisBody(analysis, indicators, modelUsed, analysisTimestamp)
            )}

            {/* Placeholder Iniziale (nessuna analisi ancora eseguita) */}
            {!loading && !error && !analysis && (
              <div className="p-6 rounded-lg bg-slate-800/20 border border-dashed border-slate-800 text-center space-y-3 my-4">
                <div className="p-3 rounded-full bg-purple-500/10 text-purple-400 w-fit mx-auto border border-purple-500/20">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-white">
                    Nessuna analisi attiva per {selectedSymbol}
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                    Clicca su &quot;Analizza ora&quot; per interrogare il mercato {selectedSymbol} con dati freschi a 15M e conferma 1H.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRunAnalysis}
                  className="px-3.5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Analizza ora
                </button>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: STORICO ANALISI (MAX 10) */}
        {activeTab === "history" && (
          <div>
            {/* Sotto-vista: Dettagli dell'analisi storica selezionata */}
            {selectedHistoryItem ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setSelectedHistoryItem(null)}
                    className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Torna alla lista</span>
                  </button>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-mono">
                    {selectedHistoryItem.symbol || "XAU/USD"}
                  </span>
                </div>

                {renderAnalysisBody(
                  selectedHistoryItem.analysis,
                  selectedHistoryItem.indicators,
                  selectedHistoryItem.modelUsed,
                  selectedHistoryItem.timestamp,
                  selectedHistoryItem.symbol
                )}
              </div>
            ) : (
              /* Sotto-vista: Lista delle ultime 10 analisi */
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
                  <span>Ultime 10 analisi manuali</span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {history.length}/10
                  </span>
                </div>

                {history.length === 0 ? (
                  <div className="p-6 rounded-lg bg-slate-800/20 border border-dashed border-slate-800 text-center space-y-2 my-2">
                    <History className="w-5 h-5 text-slate-500 mx-auto" />
                    <p className="text-xs text-slate-400">
                      Nessuna analisi salvata nello storico.
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Esegui la tua prima analisi cliccando sul pulsante &quot;Analizza ora&quot;.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                    {history.map((item) => {
                      const itemDate = new Date(item.timestamp);
                      const formattedTime = itemDate.toLocaleTimeString("it-IT", {
                        hour: "2-digit",
                        minute: "2-digit",
                      });
                      const formattedDate = itemDate.toLocaleDateString("it-IT", {
                        day: "2-digit",
                        month: "2-digit",
                      });

                      const opType =
                        item.analysis.parametri_operativi?.tipo_operazione;
                      const itemIsForex = item.symbol
                        ? item.symbol.toUpperCase().includes("EUR") || item.currentPrice < 20
                        : item.currentPrice < 20;
                      const itemPricePrefix = itemIsForex ? "" : "$";
                      const itemDecimals = itemIsForex ? 4 : 2;

                      return (
                        <div
                          key={item.id}
                          onClick={() => setSelectedHistoryItem(item)}
                          className="p-3 rounded-lg bg-slate-800/40 hover:bg-slate-800/80 border border-slate-700/50 hover:border-purple-500/40 transition-all cursor-pointer group flex items-center justify-between gap-3"
                        >
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 border border-slate-700 text-slate-300 font-mono font-semibold">
                                  {item.symbol || "XAU/USD"}
                                </span>
                                <span className="text-xs font-bold text-white font-mono">
                                  {item.currentPrice
                                    ? `${itemPricePrefix}${item.currentPrice.toFixed(itemDecimals)}`
                                    : "--"}
                                </span>
                              </div>
                              <span className="text-[10px] text-slate-400 font-mono">
                                {formattedDate} {formattedTime}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap">
                              {renderTrendBadge(item.analysis.trend)}
                              {item.analysis.conferma_trend && (
                                <span
                                  className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
                                    item.analysis.conferma_trend.toLowerCase().includes("concorde")
                                      ? "bg-emerald-950/60 text-emerald-300 border-emerald-700/40"
                                      : item.analysis.conferma_trend.toLowerCase().includes("discorde")
                                      ? "bg-amber-950/60 text-amber-300 border-amber-700/40"
                                      : "bg-slate-800 text-slate-400 border-slate-700"
                                  }`}
                                >
                                  1H {item.analysis.conferma_trend}
                                </span>
                              )}
                              {opType && opType !== "nessuna" && (
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase ${
                                    opType === "long"
                                      ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30"
                                      : "bg-red-500/20 text-red-300 border-red-500/30"
                                  }`}
                                >
                                  {opType}
                                </span>
                              )}
                            </div>

                            <p className="text-[11px] text-slate-400 line-clamp-1 group-hover:text-slate-300 transition-colors">
                              {item.analysis.scenario_probabile}
                            </p>
                          </div>

                          <ChevronRight className="w-4 h-4 text-slate-500 group-hover:text-purple-400 shrink-0 transition-colors" />
                        </div>
                      );
                    })}
                  </div>
                )}
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

