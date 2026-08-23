/**
 * Formato compatibile con TradingView Lightweight Charts (CandlestickData)
 * `time` deve essere un timestamp UNIX in secondi (per intervalli intraday)
 * e i dati devono essere ordinati in modo cronologico crescente (dal più vecchio al più recente).
 */
export interface CandleData {
  time: number; // Unix timestamp in secondi (UTCTimestamp)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TwelveDataTimeSeriesValue {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

export interface TwelveDataTimeSeriesResponse {
  meta?: {
    symbol: string;
    interval: string;
    currency_base?: string;
    currency_quote?: string;
    exchange_timezone?: string;
  };
  values?: TwelveDataTimeSeriesValue[];
  status?: string;
  code?: number;
  message?: string;
}

export interface TechnicalIndicatorsSummary {
  currentPrice: number;
  ema20: number | null;
  ema50: number | null;
  emaTrend: "bullish" | "bearish" | "neutral";
  rsi14: number | null;
  rsiCondition: "oversold" | "overbought" | "neutral";
  atr14: number | null;
  supports: number[]; // I 2 supporti più rilevanti [S1, S2]
  resistances: number[]; // Le 2 resistenze più rilevanti [R1, R2]
  promptSummary: string; // Testo pre-formattato pronto per prompt AI
}

/**
 * Risposta strutturata dell'analisi AI per il trader
 */
export interface MarketAnalysisResponse {
  trend: "rialzista" | "ribassista" | "laterale";
  forza_trend: "debole" | "moderata" | "forte";
  volatilita: "bassa" | "media" | "alta";
  livelli_chiave: string[];
  scenario_probabile: string;
  cosa_osservare: string;
  mercato_chiuso?: boolean;
}

export interface AnalysisSummary {
  trend: "bullish" | "bearish" | "neutral";
  indicators: {
    rsi?: number;
    macd?: {
      value: number;
      signal: number;
      histogram: number;
    };
    support?: number;
    resistance?: number;
  };
  notes?: string[];
}
