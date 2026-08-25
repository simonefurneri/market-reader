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

export interface OpportunityFilterInput {
  currentPrice: number;
  ema20?: number | null;
  ema50?: number | null;
  rsi14?: number | null;
  atr14?: number | null;
  supports?: number[];
  resistances?: number[];
  candles?: CandleData[];
  promptSummary?: string;
}

export interface OpportunityFilterDetails {
  breakoutResistenza: boolean;
  breakoutSupporto: boolean;
  livelloRotto?: number | null;
  tipoBreakout?: "resistenza" | "supporto" | null;
  rsiUscitaFascia: boolean;
  rsiValore: number | null;
  rsiStato: "ipercomprato" | "ipervenduto" | "neutrale";
  atrEspansione: boolean;
  atrAttuale: number | null;
  atrMediaStorica: number | null;
  atrIncrementoPercentuale: number | null;
  trendEma: "bullish" | "bearish" | "neutral";
  condizioniSoddisfatte?: number;
  condizioniMinimeRichieste?: number;
}

export interface OpportunityFilterResult {
  potenzialeOpportunita: boolean;
  motivazione: string;
  motivi: string[];
  dettagli: OpportunityFilterDetails;
}


export interface OperationalParameters {
  opportunita_valida?: boolean;
  tipo_operazione?: "long" | "short" | "nessuna";
  entry_price?: string | number | null;
  stop_loss?: string | number | null;
  take_profit?: string | number | null;
  rischio?: string;
}

export interface ExtendedMarketAnalysisResponse extends MarketAnalysisResponse {
  conferma_opportunita?: boolean;
  parametri_operativi?: OperationalParameters;
}

export interface CheckMarketApiResponse {
  checked: boolean;
  alert: boolean;
  marketOpen?: boolean;
  authType?: "qstash" | "cron_secret" | "none";
  signalObserving?: boolean;
  consecutiveSignalCount?: number;
  requiredConsecutiveSignals?: number;
  minutesSinceLastAlert?: number;
  cooldownMinutes?: number;
  cooldownActive?: boolean;
  reason?: string;
  telegramSent?: boolean;
  telegramError?: string;
  currentPrice?: number;
  marketStatus?: {
    isOpen: boolean;
    isClosed: boolean;
    message: string;
  };
  filterResult?: OpportunityFilterResult;
  aiAnalysis?: ExtendedMarketAnalysisResponse | null;
}

export interface StoredManualAnalysis {
  id: string;
  timestamp: number;
  symbol: string;
  currentPrice: number;
  indicators: TechnicalIndicatorsSummary;
  analysis: ExtendedMarketAnalysisResponse;
  modelUsed?: string | null;
  filterResult?: OpportunityFilterResult;
}





