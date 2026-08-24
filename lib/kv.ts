import { Redis } from "@upstash/redis";

// Chiavi di persistenza su Redis / Vercel KV
export const KV_KEY_LAST_ALERT_TIMESTAMP = "market:lastAlertTimestamp";
export const KV_KEY_CONSECUTIVE_SIGNAL_COUNT = "market:consecutiveSignalCount";
export const KV_KEY_LAST_CHECK_LOG = "lastCheckLog";
export const KV_KEY_CHECK_HISTORY = "checkHistory";

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
