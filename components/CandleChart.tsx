"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickSeries,
  CandlestickData,
  UTCTimestamp,
} from "lightweight-charts";
import { fetchMarketData } from "@/lib/marketData";
import { CandleData } from "@/lib/types";
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  Clock,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

export interface CandleChartProps {
  symbolName?: string;
  intervalName?: string;
  autoRefreshIntervalSeconds?: number;
}

export function CandleChart({
  symbolName = "XAU/USD",
  intervalName = "15m",
  autoRefreshIntervalSeconds = 60,
}: CandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [currentCandle, setCurrentCandle] = useState<CandleData | null>(null);
  const [countdown, setCountdown] = useState<number>(autoRefreshIntervalSeconds);
  const [priceChange, setPriceChange] = useState<{
    diff: number;
    pct: number;
  } | null>(null);

  const loadData = useCallback(
    async (isPolling = false, forceRefresh = false) => {
      try {
        if (isPolling) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }
        setError(null);

        const rawCandles = await fetchMarketData({
          symbol: symbolName,
          timeframe: intervalName,
          forceRefresh,
        });

        if (rawCandles.length > 0) {
          const last = rawCandles[rawCandles.length - 1];
          const first = rawCandles[0];
          setCurrentCandle(last);

          const diff = last.close - first.open;
          const pct = (diff / first.open) * 100;
          setPriceChange({ diff, pct });

          // Converte nel tipo CandlestickData con UTCTimestamp per lightweight-charts
          const chartData: CandlestickData<UTCTimestamp>[] = rawCandles.map((c) => ({
            time: c.time as UTCTimestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));

          if (seriesRef.current) {
            seriesRef.current.setData(chartData);
          }
        }

        setLastUpdated(new Date());
        setCountdown(autoRefreshIntervalSeconds);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Si è verificato un errore durante il recupero delle candele";
        setError(message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [autoRefreshIntervalSeconds, symbolName, intervalName]
  );

  const handleManualRefresh = useCallback(() => {
    setCountdown(autoRefreshIntervalSeconds);
    // Click manuale: bypass della cache (forceRefresh = true)
    loadData(true, true);
  }, [autoRefreshIntervalSeconds, loadData]);


  // Inizializzazione grafico Lightweight Charts con tema scuro e responsive
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const container = chartContainerRef.current;

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#020617" }, // slate-950
        textColor: "#94a3b8", // slate-400
        fontSize: 12,
        fontFamily: "Inter, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "#1e293b" }, // slate-800
        horzLines: { color: "#1e293b" },
      },
      crosshair: {
        mode: 1, // Magnet crosshair
        vertLine: {
          color: "#475569",
          width: 1,
          style: 2, // Dashed
          labelBackgroundColor: "#1e293b",
        },
        horzLine: {
          color: "#475569",
          width: 1,
          style: 2, // Dashed
          labelBackgroundColor: "#1e293b",
        },
      },
      rightPriceScale: {
        borderColor: "#334155",
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: "#334155",
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
      autoSize: true,
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", // emerald-500
      downColor: "#ef4444", // red-500
      borderVisible: true,
      borderUpColor: "#10b981",
      borderDownColor: "#ef4444",
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });

    chartRef.current = chart;
    seriesRef.current = candlestickSeries;

    // Gestione ResizeObserver per responsiveness fluido
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        chart.applyOptions({ width, height });
      }
    });

    resizeObserver.observe(container);

    // Carica i dati iniziali
    loadData(false);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [loadData]);

  // Timer per countdown decrescente secondo per secondo e auto-refresh a zero
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          loadData(true);
          return autoRefreshIntervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [loadData, autoRefreshIntervalSeconds]);

  const isPositive = (priceChange?.diff ?? 0) >= 0;

  return (
    <div className="flex-1 flex flex-col w-full h-full min-h-[460px] relative">
      {/* Top Meta Header: Simbolo, Prezzo attuale, Variazione e Status */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                {symbolName}
              </h2>
              <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-mono font-medium">
                {intervalName}
              </span>
            </div>
            <p className="text-xs text-slate-400">Twelve Data Feed (Ultime 100 candele)</p>
          </div>

          {currentCandle && (
            <div className="hidden sm:flex flex-col pl-3 border-l border-slate-800">
              <span className="text-lg font-bold font-mono text-white leading-tight">
                ${currentCandle.close.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              {priceChange && (
                <div
                  className={`flex items-center gap-1 text-xs font-semibold ${
                    isPositive ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="w-3 h-3" />
                  ) : (
                    <TrendingDown className="w-3 h-3" />
                  )}
                  <span>
                    {isPositive ? "+" : ""}
                    {priceChange.diff.toFixed(2)} ({isPositive ? "+" : ""}
                    {priceChange.pct.toFixed(2)}%)
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Polling indicator & Refresh button con Countdown dinamico */}
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {lastUpdated && (
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-400">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span>
                Aggiornato: {lastUpdated.toLocaleTimeString("it-IT", { hour12: false })}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={loading || refreshing}
            suppressHydrationWarning
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
            title="Aggiorna candele ora"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-blue-400" : ""}`}
            />
            <span suppressHydrationWarning className="hidden sm:inline font-mono">
              {refreshing ? "Aggiornamento..." : `Aggiorna (${countdown}s)`}
            </span>
          </button>
        </div>
      </div>

      {/* Contenitore Grafico e Stati Overlay */}
      <div className="flex-1 w-full h-full min-h-[380px] relative rounded-lg overflow-hidden bg-slate-950 border border-slate-800/80">
        {/* Canvas DOM container for Lightweight Charts */}
        <div ref={chartContainerRef} className="w-full h-full absolute inset-0" />

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-sm transition-opacity">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-200">
              Caricamento candele {symbolName}...
            </p>
            <p className="text-xs text-slate-400 mt-1">Recupero dati da Twelve Data API</p>
          </div>
        )}

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 bg-slate-950/90 text-center">
            <div className="p-3 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-100 mb-1">
              Impossibile caricare il grafico
            </h3>
            <p className="text-xs text-red-400 max-w-md mb-4 leading-relaxed">
              {error}
            </p>
            <button
              type="button"
              onClick={() => loadData(false)}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Riprova
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
