import { Redis } from "@upstash/redis";

// Chiavi di persistenza su Redis / Vercel KV
export const KV_KEY_LAST_ALERT_TIMESTAMP = "market:lastAlertTimestamp";
export const KV_KEY_CONSECUTIVE_SIGNAL_COUNT = "market:consecutiveSignalCount";

// Fallback in-memory per sviluppo locale / assenza credenziali Redis
const inMemoryState = {
  lastAlertTimestamp: 0,
  consecutiveSignalCount: 0,
};

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
