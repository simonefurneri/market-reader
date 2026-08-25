import { Redis } from "@upstash/redis";
import { CandleData, StoredManualAnalysis } from "@/lib/types";

// Chiavi di persistenza su Redis / Vercel KV
export const KV_KEY_LAST_ALERT_TIMESTAMP = "market:lastAlertTimestamp";
export const KV_KEY_CONSECUTIVE_SIGNAL_COUNT = "market:consecutiveSignalCount";
export const KV_KEY_LAST_CHECK_LOG = "lastCheckLog";
export const KV_KEY_CHECK_HISTORY = "checkHistory";
export const KV_KEY_MANUAL_ANALYSIS_HISTORY = "analysis:history";


export interface MarketCheckLog {
  timestamp: number;
  marketOpen: boolean;
  signalDetected: boolean;
  consecutiveSignalCount: number;
  alertSent: boolean;
  message: string;
  messaggio?: string;
  currentPrice?: number;
  authType?: string;
  condizioniSoddisfatte?: number;
  motivi?: string[];
  // Valori grezzi degli indicatori tecnici usati per la decisione
  rsi?: number | null;
  atr?: number | null;
  atrAvg?: number | null;
  breakoutDetected?: boolean;
  levelBroken?: number | null;
  breakoutType?: "resistenza" | "supporto" | null;
}

// Fallback in-memory per sviluppo locale / assenza credenziali Redis
const inMemoryState = {
  lastAlertTimestamp: 0,
  consecutiveSignalCount: 0,
};

let inMemoryLastCheckLog: MarketCheckLog | null = null;
let inMemoryCheckHistory: MarketCheckLog[] = [];
let inMemoryManualHistory: StoredManualAnalysis[] = [];
const inMemoryCandlesCache = new Map<string, { data: CandleData[]; expiresAt: number }>();


/**
 * Inizializza il client Redis rilevando automaticamente sia le variabili
 * d'ambiente di Vercel KV (KV_REST_API_URL/TOKEN) sia quelle di Upstash (UPSTASH_REDIS_REST_URL/TOKEN).
 */
export function getRedisClient(): Redis | null {
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim();

  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (url && token) {
    try {
      return new Redis({ url, token });
    } catch (e) {
      console.warn("[KV Storage] Errore inizializzazione client Redis:", e);
      return null;
    }
  }

  return null;
}

export interface MarketStorageState {
  lastAlertTimestamp: number;
  consecutiveSignalCount: number;
  isUsingFallback: boolean;
}

/**
 * Legge lo stato persistente dei segnali e dell'ultimo alert inviato.
 */
export async function getMarketStorageState(): Promise<MarketStorageState> {
  const redis = getRedisClient();

  if (!redis) {
    return {
      lastAlertTimestamp: inMemoryState.lastAlertTimestamp,
      consecutiveSignalCount: inMemoryState.consecutiveSignalCount,
      isUsingFallback: true,
    };
  }

  try {
    const [lastAlertRaw, signalCountRaw] = await Promise.all([
      redis.get<number | string>(KV_KEY_LAST_ALERT_TIMESTAMP),
      redis.get<number | string>(KV_KEY_CONSECUTIVE_SIGNAL_COUNT),
    ]);

    const lastAlertTimestamp =
      typeof lastAlertRaw === "number"
        ? lastAlertRaw
        : typeof lastAlertRaw === "string"
        ? parseInt(lastAlertRaw, 10) || 0
        : 0;

    const consecutiveSignalCount =
      typeof signalCountRaw === "number"
        ? signalCountRaw
        : typeof signalCountRaw === "string"
        ? parseInt(signalCountRaw, 10) || 0
        : 0;

    return {
      lastAlertTimestamp,
      consecutiveSignalCount,
      isUsingFallback: false,
    };
  } catch (error) {
    console.warn(
      "[KV Storage] Impossibile leggere da Redis, fallback su memoria locale:",
      error
    );
    return {
      lastAlertTimestamp: inMemoryState.lastAlertTimestamp,
      consecutiveSignalCount: inMemoryState.consecutiveSignalCount,
      isUsingFallback: true,
    };
  }
}

/**
 * Incrementa di 1 il contatore dei segnali consecutivi e restituisce il nuovo valore.
 */
export async function incrementConsecutiveSignalCount(): Promise<number> {
  const redis = getRedisClient();

  if (!redis) {
    inMemoryState.consecutiveSignalCount += 1;
    return inMemoryState.consecutiveSignalCount;
  }

  try {
    const newCount = await redis.incr(KV_KEY_CONSECUTIVE_SIGNAL_COUNT);
    return typeof newCount === "number"
      ? newCount
      : (inMemoryState.consecutiveSignalCount += 1);
  } catch (error) {
    console.warn("[KV Storage] Errore incr Redis:", error);
    inMemoryState.consecutiveSignalCount += 1;
    return inMemoryState.consecutiveSignalCount;
  }
}

/**
 * Resetta a 0 il contatore dei segnali consecutivi (es. quando il segnale si interrompe).
 */
export async function resetConsecutiveSignalCount(): Promise<void> {
  const redis = getRedisClient();
  inMemoryState.consecutiveSignalCount = 0;

  if (!redis) return;

  try {
    await redis.set(KV_KEY_CONSECUTIVE_SIGNAL_COUNT, 0);
  } catch (error) {
    console.warn("[KV Storage] Errore reset contatore Redis:", error);
  }
}

/**
 * Salva il timestamp dell'alert inviato e azzera il contatore dei segnali consecutivi.
 */
export async function recordAlertSent(
  timestamp: number = Date.now()
): Promise<void> {
  const redis = getRedisClient();
  inMemoryState.lastAlertTimestamp = timestamp;
  inMemoryState.consecutiveSignalCount = 0;

  if (!redis) return;

  try {
    await Promise.all([
      redis.set(KV_KEY_LAST_ALERT_TIMESTAMP, timestamp),
      redis.set(KV_KEY_CONSECUTIVE_SIGNAL_COUNT, 0),
    ]);
  } catch (error) {
    console.warn("[KV Storage] Errore salvataggio alert sent:", error);
  }
}

/**
 * Salva il log dettagliato dell'ultimo controllo di mercato su Redis
 * con un TTL di 24 ore (86400 secondi) e aggiunge l'entry alla lista "checkHistory"
 * troncandola a un massimo di 288 elementi (24 ore di check ogni 5 minuti).
 */
export async function saveLastCheckLog(log: MarketCheckLog): Promise<void> {
  const redis = getRedisClient();
  inMemoryLastCheckLog = log;

  // Gestione fallback in-memory (massimo 288 elementi)
  inMemoryCheckHistory.unshift(log);
  if (inMemoryCheckHistory.length > 288) {
    inMemoryCheckHistory = inMemoryCheckHistory.slice(0, 288);
  }

  if (!redis) return;

  try {
    // 1. Salva ultimo log con TTL 24h
    // 2. LPUSH su checkHistory
    // 3. LTRIM checkHistory a 288 elementi (indici da 0 a 287 inclusi)
    await Promise.all([
      redis.set(KV_KEY_LAST_CHECK_LOG, log, { ex: 86400 }),
      redis.lpush(KV_KEY_CHECK_HISTORY, log).then(() =>
        redis.ltrim(KV_KEY_CHECK_HISTORY, 0, 287)
      ),
    ]);
  } catch (error) {
    console.warn("[KV Storage] Errore salvataggio lastCheckLog / checkHistory:", error);
  }
}

/**
 * Recupera l'ultimo log di controllo mercato salvato su Redis.
 */
export async function getLastCheckLog(): Promise<MarketCheckLog | null> {
  const redis = getRedisClient();

  if (!redis) {
    return inMemoryLastCheckLog;
  }

  try {
    const log = await redis.get<MarketCheckLog>(KV_KEY_LAST_CHECK_LOG);
    return log || inMemoryLastCheckLog;
  } catch (error) {
    console.warn("[KV Storage] Errore recupero lastCheckLog:", error);
    return inMemoryLastCheckLog;
  }
}

/**
 * Recupera lo storico dei controlli di mercato dalla lista Redis "checkHistory",
 * ordinati dal più recente al più vecchio (fino a un massimo di `limit` elementi, default 288).
 */
export async function getCheckHistory(
  limit: number = 288
): Promise<MarketCheckLog[]> {
  const redis = getRedisClient();

  if (!redis) {
    return inMemoryCheckHistory.slice(0, limit);
  }

  try {
    const rawList = await redis.lrange<MarketCheckLog | string>(
      KV_KEY_CHECK_HISTORY,
      0,
      limit - 1
    );

    if (!rawList || rawList.length === 0) {
      return inMemoryCheckHistory.slice(0, limit);
    }

    return rawList.map((item) => {
      if (typeof item === "string") {
        try {
          return JSON.parse(item) as MarketCheckLog;
        } catch {
          return item as unknown as MarketCheckLog;
        }
      }
      return item as MarketCheckLog;
    });
  } catch (error) {
    console.warn("[KV Storage] Errore recupero checkHistory da Redis:", error);
    return inMemoryCheckHistory.slice(0, limit);
  }
}

// ============================================================================
// GESTIONE CACHE CANDELE (REDIS & FALLBACK MEMORIA)
// ============================================================================

/**
 * Normalizza il simbolo (es. "XAU/USD" -> "XAUUSD").
 */
export function normalizeSymbol(symbol: string): string {
  return symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

/**
 * Normalizza il timeframe (es. "15min" -> "15M", "1h" -> "1H").
 */
export function normalizeTimeframe(timeframe: string): "15M" | "1H" | string {
  const tf = timeframe.toUpperCase();
  if (tf === "15MIN" || tf === "15M") return "15M";
  if (tf === "1H" || tf === "60MIN" || tf === "60M") return "1H";
  return tf;
}

/**
 * Genera la chiave Redis per la cache candele nel formato: candles:{symbol}:{timeframe}
 */
export function getCandlesCacheKey(symbol: string, timeframe: string): string {
  return `candles:${normalizeSymbol(symbol)}:${normalizeTimeframe(timeframe)}`;
}

/**
 * Restituisce il TTL in secondi per il timeframe specificato:
 * - 15M: 4 minuti (240 secondi)
 * - 1H: 18 minuti (1080 secondi)
 */
export function getTimeframeTtlSeconds(timeframe: string): number {
  const norm = normalizeTimeframe(timeframe);
  if (norm === "15M") return 4 * 60; // 240 secondi = 4 minuti
  if (norm === "1H") return 18 * 60; // 1080 secondi = 18 minuti
  return 4 * 60;
}

/**
 * Legge le candele dalla cache Redis (o fallback in-memory se Redis non è configurato).
 * Restituisce null se la chiave non esiste o se il TTL è scaduto.
 */
export async function getCachedCandles(
  symbol: string,
  timeframe: string
): Promise<CandleData[] | null> {
  const key = getCandlesCacheKey(symbol, timeframe);
  const redis = getRedisClient();

  if (!redis) {
    const cached = inMemoryCandlesCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    inMemoryCandlesCache.delete(key);
    return null;
  }

  try {
    const data = await redis.get<CandleData[] | string>(key);
    if (!data) return null;

    if (typeof data === "string") {
      try {
        return JSON.parse(data) as CandleData[];
      } catch {
        return null;
      }
    }
    return data as CandleData[];
  } catch (error) {
    console.warn(`[KV Storage] Errore lettura cache candele [${key}]:`, error);
    const cached = inMemoryCandlesCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    return null;
  }
}

/**
 * Salva le candele nella cache Redis con il relativo TTL in secondi.
 */
export async function setCachedCandles(
  symbol: string,
  timeframe: string,
  candles: CandleData[],
  ttlSeconds?: number
): Promise<void> {
  const ttl = ttlSeconds ?? getTimeframeTtlSeconds(timeframe);
  const key = getCandlesCacheKey(symbol, timeframe);

  inMemoryCandlesCache.set(key, {
    data: candles,
    expiresAt: Date.now() + ttl * 1000,
  });

  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(key, candles, { ex: ttl });
  } catch (error) {
    console.warn(`[KV Storage] Errore scrittura cache candele [${key}]:`, error);
  }
}

// ============================================================================
// GESTIONE STORICO ANALISI AI MANUALI (REDIS LPUSH + LTRIM MAX 10)
// ============================================================================

/**
 * Salva un'analisi AI eseguita manualmente tramite pulsante nel pannello.
 * Mantiene uno storico di massimo 10 elementi (LPUSH + LTRIM 0 9).
 */
export async function saveManualAnalysis(
  analysisEntry: StoredManualAnalysis
): Promise<void> {
  const redis = getRedisClient();

  // In-memory fallback
  inMemoryManualHistory.unshift(analysisEntry);
  if (inMemoryManualHistory.length > 10) {
    inMemoryManualHistory = inMemoryManualHistory.slice(0, 10);
  }

  if (!redis) return;

  try {
    await redis.lpush(KV_KEY_MANUAL_ANALYSIS_HISTORY, analysisEntry);
    await redis.ltrim(KV_KEY_MANUAL_ANALYSIS_HISTORY, 0, 9);
  } catch (error) {
    console.warn(
      "[KV Storage] Errore salvataggio manual analysis in Redis:",
      error
    );
  }
}

/**
 * Recupera le ultime N analisi manuali salvate su Redis (massimo 10).
 */
export async function getManualAnalysisHistory(
  limit: number = 10
): Promise<StoredManualAnalysis[]> {
  const maxLimit = Math.min(Math.max(limit, 1), 10);
  const redis = getRedisClient();

  if (!redis) {
    return inMemoryManualHistory.slice(0, maxLimit);
  }

  try {
    const rawList = await redis.lrange<StoredManualAnalysis | string>(
      KV_KEY_MANUAL_ANALYSIS_HISTORY,
      0,
      maxLimit - 1
    );

    if (!rawList || rawList.length === 0) {
      return inMemoryManualHistory.slice(0, maxLimit);
    }

    return rawList.map((item) => {
      if (typeof item === "string") {
        try {
          return JSON.parse(item) as StoredManualAnalysis;
        } catch {
          return item as unknown as StoredManualAnalysis;
        }
      }
      return item as StoredManualAnalysis;
    });
  } catch (error) {
    console.warn(
      "[KV Storage] Errore recupero manual analysis history da Redis:",
      error
    );
    return inMemoryManualHistory.slice(0, maxLimit);
  }
}

