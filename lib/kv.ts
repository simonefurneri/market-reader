import { Redis } from "@upstash/redis";
import { CandleData, StoredManualAnalysis } from "@/lib/types";

// Chiavi di persistenza su Redis / Vercel KV
export const KV_KEY_LAST_ALERT_TIMESTAMP = "market:lastAlertTimestamp";
export const KV_KEY_CONSECUTIVE_SIGNAL_COUNT = "market:consecutiveSignalCount";
export const KV_KEY_LAST_CHECK_LOG = "lastCheckLog";
export const KV_KEY_CHECK_HISTORY = "checkHistory";
export const KV_KEY_MANUAL_ANALYSIS_HISTORY = "analysis:history";

/**
 * Normalizza il simbolo in un formato chiave Redis pulito (es. "XAU/USD" -> "XAUUSD")
 */
export function normalizeSymbolKey(symbol?: string): string {
  if (!symbol) return "XAUUSD";
  return symbol.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

export function getLastAlertTimestampKey(symbol?: string): string {
  const norm = normalizeSymbolKey(symbol);
  return `market:lastAlertTimestamp:${norm}`;
}

export function getConsecutiveSignalCountKey(symbol?: string): string {
  const norm = normalizeSymbolKey(symbol);
  return `market:consecutiveSignalCount:${norm}`;
}

export interface MarketCheckLog {
  timestamp: number;
  symbol?: string;
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
  trend1h?: "rialzista" | "ribassista" | "laterale" | string | null;
  confermaTrend?: "concorde" | "discorde" | "neutrale" | string | null;
}

// Fallback in-memory per sviluppo locale / assenza credenziali Redis
const inMemoryLastAlertMap = new Map<string, number>();
const inMemorySignalCountMap = new Map<string, number>();

let inMemoryLastCheckLog: MarketCheckLog | null = null;
let inMemoryCheckHistory: MarketCheckLog[] = [];
let inMemoryManualHistory: StoredManualAnalysis[] = [];
export interface CachedCandlesData {
  candles: CandleData[];
  fetchedAt: number;
}

const inMemoryCandlesCache = new Map<string, { data: CachedCandlesData; expiresAt: number }>();

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

async function getSignalCountMap(redis: Redis): Promise<Record<string, number>> {
  try {
    const raw = await redis.get<Record<string, number> | number | string>(KV_KEY_CONSECUTIVE_SIGNAL_COUNT);
    if (!raw) return {};
    if (typeof raw === "number") return { XAUUSD: raw };
    if (typeof raw === "string") {
      const num = parseInt(raw, 10);
      return isNaN(num) ? {} : { XAUUSD: num };
    }
    return raw as Record<string, number>;
  } catch (err) {
    console.warn("[KV Storage] Errore lettura getSignalCountMap:", err);
    return {};
  }
}

async function getLastAlertTimestampMap(redis: Redis): Promise<Record<string, number>> {
  try {
    const raw = await redis.get<Record<string, number> | number | string>(KV_KEY_LAST_ALERT_TIMESTAMP);
    if (!raw) return {};
    if (typeof raw === "number") return { XAUUSD: raw };
    if (typeof raw === "string") {
      const num = parseInt(raw, 10);
      return isNaN(num) ? {} : { XAUUSD: num };
    }
    return raw as Record<string, number>;
  } catch (err) {
    console.warn("[KV Storage] Errore lettura getLastAlertTimestampMap:", err);
    return {};
  }
}

export interface MarketStorageState {
  lastAlertTimestamp: number;
  consecutiveSignalCount: number;
  isUsingFallback: boolean;
}

/**
 * Legge lo stato persistente dei segnali e dell'ultimo alert inviato per un simbolo specifico
 * dalle chiavi unificate "market:lastAlertTimestamp" e "market:consecutiveSignalCount".
 */
export async function getMarketStorageState(symbol: string = "XAU/USD"): Promise<MarketStorageState> {
  const normKey = normalizeSymbolKey(symbol);
  const redis = getRedisClient();

  if (!redis) {
    return {
      lastAlertTimestamp: inMemoryLastAlertMap.get(normKey) || 0,
      consecutiveSignalCount: inMemorySignalCountMap.get(normKey) || 0,
      isUsingFallback: true,
    };
  }

  try {
    const [alertMap, countMap] = await Promise.all([
      getLastAlertTimestampMap(redis),
      getSignalCountMap(redis),
    ]);

    const lastAlertTimestamp = alertMap[normKey] ?? 0;
    const consecutiveSignalCount = countMap[normKey] ?? 0;

    return {
      lastAlertTimestamp,
      consecutiveSignalCount,
      isUsingFallback: false,
    };
  } catch (error) {
    console.warn(
      `[KV Storage] Impossibile leggere da Redis per ${symbol}, fallback su memoria locale:`,
      error
    );
    return {
      lastAlertTimestamp: inMemoryLastAlertMap.get(normKey) || 0,
      consecutiveSignalCount: inMemorySignalCountMap.get(normKey) || 0,
      isUsingFallback: true,
    };
  }
}

/**
 * Incrementa di 1 il contatore dei segnali consecutivi per il simbolo nella mappa "market:consecutiveSignalCount".
 */
export async function incrementConsecutiveSignalCount(symbol: string = "XAU/USD"): Promise<number> {
  const normKey = normalizeSymbolKey(symbol);
  const currentInMemory = (inMemorySignalCountMap.get(normKey) || 0) + 1;
  inMemorySignalCountMap.set(normKey, currentInMemory);

  const redis = getRedisClient();
  if (!redis) {
    return currentInMemory;
  }

  try {
    const countMap = await getSignalCountMap(redis);
    const newCount = (countMap[normKey] || 0) + 1;
    countMap[normKey] = newCount;

    await Promise.all([
      redis.set(KV_KEY_CONSECUTIVE_SIGNAL_COUNT, countMap),
      // Pulizia chiavi legacy residue
      redis.del(`market:consecutiveSignalCount:${normKey}`).catch(() => {}),
    ]);

    return newCount;
  } catch (error) {
    console.warn(`[KV Storage] Errore incremento contatore Redis per ${symbol}:`, error);
    return currentInMemory;
  }
}

/**
 * Resetta a 0 il contatore dei segnali consecutivi per il simbolo nella mappa "market:consecutiveSignalCount".
 */
export async function resetConsecutiveSignalCount(symbol: string = "XAU/USD"): Promise<void> {
  const normKey = normalizeSymbolKey(symbol);
  inMemorySignalCountMap.set(normKey, 0);

  const redis = getRedisClient();
  if (!redis) return;

  try {
    const countMap = await getSignalCountMap(redis);
    countMap[normKey] = 0;

    await Promise.all([
      redis.set(KV_KEY_CONSECUTIVE_SIGNAL_COUNT, countMap),
      redis.del(`market:consecutiveSignalCount:${normKey}`).catch(() => {}),
    ]);
  } catch (error) {
    console.warn(`[KV Storage] Errore reset contatore Redis per ${symbol}:`, error);
  }
}

/**
 * Salva il timestamp dell'alert inviato e azzera il contatore dei segnali consecutivi per il simbolo
 * nelle rispettive mappe unificate "market:lastAlertTimestamp" e "market:consecutiveSignalCount".
 */
export async function recordAlertSent(
  symbol: string | number = "XAU/USD",
  timestamp?: number
): Promise<void> {
  // Supporto retrocompatibile nel caso il primo parametro sia il timestamp
  const targetSymbol = typeof symbol === "string" ? symbol : "XAU/USD";
  const targetTimestamp = typeof symbol === "number" ? symbol : timestamp || Date.now();

  const normKey = normalizeSymbolKey(targetSymbol);
  inMemoryLastAlertMap.set(normKey, targetTimestamp);
  inMemorySignalCountMap.set(normKey, 0);

  const redis = getRedisClient();
  if (!redis) return;

  try {
    const [alertMap, countMap] = await Promise.all([
      getLastAlertTimestampMap(redis),
      getSignalCountMap(redis),
    ]);

    alertMap[normKey] = targetTimestamp;
    countMap[normKey] = 0;

    await Promise.all([
      redis.set(KV_KEY_LAST_ALERT_TIMESTAMP, alertMap),
      redis.set(KV_KEY_CONSECUTIVE_SIGNAL_COUNT, countMap),
      redis.del(
        `market:lastAlertTimestamp:${normKey}`,
        `market:consecutiveSignalCount:${normKey}`
      ).catch(() => {}),
    ]);
  } catch (error) {
    console.warn(`[KV Storage] Errore salvataggio alert sent per ${targetSymbol}:`, error);
  }
}

const inMemoryLastCheckMap = new Map<string, MarketCheckLog>();

/**
 * Salva i log dettagliati dell'ultimo controllo di mercato per una lista di simboli su Redis
 * nella chiave unificata "lastCheckLog" (mappa con simbolo -> log, TTL 24h) e aggiunge
 * ciascuna entry alla lista "checkHistory" (massimo 288 elementi).
 */
export async function saveLastCheckLogs(logs: MarketCheckLog[]): Promise<void> {
  if (!logs || logs.length === 0) return;
  const redis = getRedisClient();

  // Gestione fallback in-memory
  for (const log of logs) {
    const norm = normalizeSymbolKey(log.symbol);
    inMemoryLastCheckMap.set(norm, log);
    inMemoryCheckHistory.unshift(log);
  }
  if (inMemoryCheckHistory.length > 288) {
    inMemoryCheckHistory = inMemoryCheckHistory.slice(0, 288);
  }

  if (!redis) return;

  try {
    // 1. Recupera la mappa attuale o inizializzane una nuova
    const existingRaw = await redis.get<Record<string, MarketCheckLog> | MarketCheckLog>(KV_KEY_LAST_CHECK_LOG);
    const map: Record<string, MarketCheckLog> = {};

    if (existingRaw && typeof existingRaw === "object") {
      if ("timestamp" in existingRaw) {
        const legacy = existingRaw as MarketCheckLog;
        map[normalizeSymbolKey(legacy.symbol)] = legacy;
      } else {
        Object.assign(map, existingRaw);
      }
    }

    // 2. Aggiorna i log per ciascun simbolo passato
    for (const log of logs) {
      map[normalizeSymbolKey(log.symbol)] = log;
    }

    // 3. Salva la mappa aggiornata su "lastCheckLog" e pusha su "checkHistory"
    const operations: Promise<unknown>[] = [
      redis.set(KV_KEY_LAST_CHECK_LOG, map, { ex: 86400 }),
      ...logs.map((log) => redis.lpush(KV_KEY_CHECK_HISTORY, log)),
      redis.ltrim(KV_KEY_CHECK_HISTORY, 0, 287),
    ];

    // Pulizia proattiva di eventuali vecchie chiavi ridondanti
    const legacyKeysToClean = [
      "lastCheckLog:XAUUSD",
      "lastCheckLog:EURUSD",
      "checkHistory:XAUUSD",
      "checkHistory:EURUSD",
    ];
    operations.push(redis.del(...legacyKeysToClean).catch(() => {}));

    await Promise.all(operations);
  } catch (error) {
    console.warn("[KV Storage] Errore salvataggio lastCheckLogs / checkHistory:", error);
  }
}

/**
 * Salva il log dettagliato di un singolo controllo di mercato.
 */
export async function saveLastCheckLog(log: MarketCheckLog): Promise<void> {
  return saveLastCheckLogs([log]);
}

/**
 * Recupera la mappa degli ultimi log per tutti i simboli salvati nella chiave "lastCheckLog".
 */
export async function getLastCheckLogs(): Promise<Record<string, MarketCheckLog>> {
  const redis = getRedisClient();

  if (!redis) {
    const fallbackMap: Record<string, MarketCheckLog> = {};
    for (const [k, v] of inMemoryLastCheckMap.entries()) {
      fallbackMap[k] = v;
    }
    return fallbackMap;
  }

  try {
    const raw = await redis.get<Record<string, MarketCheckLog> | MarketCheckLog>(KV_KEY_LAST_CHECK_LOG);
    if (!raw) return {};

    if ("timestamp" in raw) {
      const legacy = raw as MarketCheckLog;
      return { [normalizeSymbolKey(legacy.symbol)]: legacy };
    }

    return raw as Record<string, MarketCheckLog>;
  } catch (error) {
    console.warn("[KV Storage] Errore recupero lastCheckLogs:", error);
    return {};
  }
}

/**
 * Recupera l'ultimo log di controllo mercato per uno specifico simbolo.
 */
export async function getLastCheckLog(symbol: string = "XAU/USD"): Promise<MarketCheckLog | null> {
  const logsMap = await getLastCheckLogs();
  const norm = normalizeSymbolKey(symbol);
  return logsMap[norm] || logsMap["XAUUSD"] || Object.values(logsMap)[0] || inMemoryLastCheckMap.get(norm) || null;
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
 * Restituisce CachedCandlesData oppure null se la chiave non esiste o se il TTL è scaduto.
 */
export async function getCachedCandles(
  symbol: string,
  timeframe: string
): Promise<CachedCandlesData | null> {
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
    const raw = await redis.get<CachedCandlesData | CandleData[] | string>(key);
    if (!raw) return null;

    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
    }

    if (Array.isArray(parsed)) {
      return {
        candles: parsed as CandleData[],
        fetchedAt: Date.now(),
      };
    } else if (parsed && typeof parsed === "object" && "candles" in parsed && Array.isArray((parsed as CachedCandlesData).candles)) {
      const obj = parsed as CachedCandlesData;
      return {
        candles: obj.candles,
        fetchedAt: typeof obj.fetchedAt === "number" ? obj.fetchedAt : Date.now(),
      };
    }
    return null;
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
 * Salva le candele nella cache Redis con il relativo TTL in secondi e il timestamp di fetch.
 */
export async function setCachedCandles(
  symbol: string,
  timeframe: string,
  candles: CandleData[],
  ttlSeconds?: number,
  fetchedAt: number = Date.now()
): Promise<void> {
  const ttl = ttlSeconds ?? getTimeframeTtlSeconds(timeframe);
  const key = getCandlesCacheKey(symbol, timeframe);
  const payload: CachedCandlesData = {
    candles,
    fetchedAt,
  };

  inMemoryCandlesCache.set(key, {
    data: payload,
    expiresAt: Date.now() + ttl * 1000,
  });

  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(key, payload, { ex: ttl });
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

