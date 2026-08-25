import { CandleData, TwelveDataTimeSeriesResponse } from "@/lib/types";
import {
  getCachedCandles,
  setCachedCandles,
  normalizeTimeframe,
  getTimeframeTtlSeconds,
} from "@/lib/kv";

/**
 * Converte una stringa datetime di Twelve Data (es. "2024-03-22 15:45:00")
 * in un timestamp UNIX in secondi (UTCTimestamp richiesto da TradingView lightweight-charts).
 */
function parseTwelveDataTimestamp(datetimeStr: string): number {
  const cleanStr = datetimeStr.trim();
  const isoStr = cleanStr.includes("T")
    ? (cleanStr.endsWith("Z") ? cleanStr : cleanStr + "Z")
    : cleanStr.replace(" ", "T") + "Z";
  const timestampMs = Date.parse(isoStr);

  if (isNaN(timestampMs)) {
    const [datePart, timePart = "00:00:00"] = cleanStr.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hours, minutes, seconds] = timePart.split(":").map(Number);
    return Math.floor(
      Date.UTC(year, month - 1, day, hours, minutes, seconds) / 1000
    );
  }

  return Math.floor(timestampMs / 1000);
}

/**
 * Mappa un timeframe normalizzato ("15M", "1H") nell'intervallo compreso dall'API di Twelve Data.
 */
export function toTwelveDataInterval(timeframe: string): string {
  const norm = normalizeTimeframe(timeframe);
  if (norm === "15M") return "15min";
  if (norm === "1H") return "1h";
  return timeframe.toLowerCase();
}

export interface FetchTwelveDataOptions {
  symbol?: string;
  interval?: string;
  outputsize?: number;
  apiKey?: string;
}

/**
 * Chiamata diretta non memorizzata nella cache all'API di Twelve Data per recuperare candele OHLC.
 */
export async function fetchTwelveDataCandles(
  options: FetchTwelveDataOptions = {}
): Promise<CandleData[]> {
  const {
    symbol = "XAU/USD",
    interval = "15min",
    outputsize = 100,
    apiKey = process.env.TWELVE_DATA_API_KEY,
  } = options;

  if (!apiKey || apiKey.trim() === "") {
    throw new Error(
      "Chiave API Twelve Data mancante. Imposta la variabile d'ambiente TWELVE_DATA_API_KEY nel file .env.local"
    );
  }

  const endpoint = new URL("https://api.twelvedata.com/time_series");
  endpoint.searchParams.set("symbol", symbol);
  endpoint.searchParams.set("interval", interval);
  endpoint.searchParams.set("outputsize", outputsize.toString());
  endpoint.searchParams.set("timezone", "UTC");
  endpoint.searchParams.set("apikey", apiKey.trim());

  let response: Response;
  try {
    response = await fetch(endpoint.toString(), {
      cache: "no-store",
    });
  } catch (networkError) {
    const errorMsg =
      networkError instanceof Error ? networkError.message : "Errore sconosciuto";
    throw new Error(
      `Errore di rete durante la connessione all'API di Twelve Data: ${errorMsg}. Verifica la tua connessione internet.`
    );
  }

  if (response.status === 429) {
    throw new Error(
      "Limite di richieste API Twelve Data raggiunto (Rate Limit 429). Attendi prima di effettuare nuove richieste o effettua l'upgrade del piano."
    );
  }

  if (!response.ok) {
    throw new Error(
      `Errore HTTP dall'API di Twelve Data [${response.status} ${response.statusText}].`
    );
  }

  let data: TwelveDataTimeSeriesResponse;
  try {
    data = (await response.json()) as TwelveDataTimeSeriesResponse;
  } catch {
    throw new Error(
      "Impossibile analizzare la risposta JSON restituita da Twelve Data."
    );
  }

  if (data.status === "error" || data.code !== undefined) {
    const code = data.code;
    const message = data.message || "Errore sconosciuto restituito dall'API";

    if (code === 429 || /limit|quota|exceeded|credits/i.test(message)) {
      throw new Error(
        `Rate limit Twelve Data superato: ${message} (Codice: ${code || 429}).`
      );
    }

    if (code === 401 || /invalid.*api.*key|unauthorized/i.test(message)) {
      throw new Error(
        `Chiave API Twelve Data non valida o non autorizzata: ${message}`
      );
    }

    throw new Error(`Errore API Twelve Data [Codice ${code ?? "N/D"}]: ${message}`);
  }

  if (!data.values || !Array.isArray(data.values) || data.values.length === 0) {
    throw new Error(
      `Nessun dato OHLC ricevuto da Twelve Data per ${symbol} (${interval}).`
    );
  }

  const candles: CandleData[] = data.values.map((item) => {
    const open = parseFloat(item.open);
    const high = parseFloat(item.high);
    const low = parseFloat(item.low);
    const close = parseFloat(item.close);
    const volume = item.volume ? parseFloat(item.volume) : undefined;
    const time = parseTwelveDataTimestamp(item.datetime);

    if (isNaN(open) || isNaN(high) || isNaN(low) || isNaN(close) || isNaN(time)) {
      throw new Error(
        `Dati candela non validi ricevuti da Twelve Data al timestamp "${item.datetime}".`
      );
    }

    return {
      time,
      open,
      high,
      low,
      close,
      ...(volume !== undefined && !isNaN(volume) ? { volume } : {}),
    };
  });

  candles.sort((a, b) => a.time - b.time);

  return candles;
}

export interface FetchCandlesWithCacheOptions {
  symbol?: string;
  timeframe?: "15M" | "1H" | string;
  outputsize?: number;
  forceRefresh?: boolean;
  apiKey?: string;
}

export interface FetchCandlesWithCacheResult {
  candles: CandleData[];
  source: "cache" | "live";
  fetchedAt: number;
}

/**
 * Recupera le candele con gestione cache Redis e restituisce i dettagli di provenienza:
 * - Se `forceRefresh` è false: cerca in cache Redis. Se presente, restituisce i dati memorizzati con source "cache".
 * - Se cache miss o se `forceRefresh` è true: contatta Twelve Data, aggiorna la cache Redis con il TTL specifico
 *   (4 min per 15M, 18 min per 1H) e restituisce i dati freschi con source "live".
 */
export async function fetchCandlesWithCacheDetails(
  options: FetchCandlesWithCacheOptions = {}
): Promise<FetchCandlesWithCacheResult> {
  const {
    symbol = "XAU/USD",
    timeframe = "15M",
    outputsize = 100,
    forceRefresh = false,
    apiKey,
  } = options;

  const normTf = normalizeTimeframe(timeframe);

  // 1. Se non è richiesto il bypass della cache, prova a leggere da Redis
  if (!forceRefresh) {
    const cachedData = await getCachedCandles(symbol, normTf);
    if (cachedData && Array.isArray(cachedData.candles) && cachedData.candles.length > 0) {
      return {
        candles: cachedData.candles,
        source: "cache",
        fetchedAt: cachedData.fetchedAt,
      };
    }
  }

  // 2. Cache miss oppure forceRefresh richiesto -> Chiama Twelve Data
  const interval = toTwelveDataInterval(normTf);
  const now = Date.now();
  const freshCandles = await fetchTwelveDataCandles({
    symbol,
    interval,
    outputsize,
    apiKey,
  });

  // 3. Salva in cache con il TTL corrispondente (15M -> 240s, 1H -> 1080s) e timestamp di fetch
  const ttl = getTimeframeTtlSeconds(normTf);
  await setCachedCandles(symbol, normTf, freshCandles, ttl, now);

  return {
    candles: freshCandles,
    source: "live",
    fetchedAt: now,
  };
}

/**
 * Recupera le candele con gestione cache Redis:
 * Restituisce l'array di candele (compatibile con i servizi interni).
 */
export async function fetchCandlesWithCache(
  options: FetchCandlesWithCacheOptions = {}
): Promise<CandleData[]> {
  const result = await fetchCandlesWithCacheDetails(options);
  return result.candles;
}

/**
 * Recupera le ultime 100 candele a 15 minuti per XAU/USD con supporto cache Redis.
 */
export async function getXAUUSD15mCandles(
  options: FetchCandlesWithCacheOptions = {}
): Promise<CandleData[]> {
  return fetchCandlesWithCache({
    symbol: options.symbol || "XAU/USD",
    timeframe: "15M",
    outputsize: options.outputsize || 100,
    forceRefresh: options.forceRefresh ?? false,
    apiKey: options.apiKey,
  });
}

/**
 * Recupera le ultime 100 candele a 1 ora per XAU/USD con supporto cache Redis.
 */
export async function getXAUUSD1hCandles(
  options: FetchCandlesWithCacheOptions = {}
): Promise<CandleData[]> {
  return fetchCandlesWithCache({
    symbol: options.symbol || "XAU/USD",
    timeframe: "1H",
    outputsize: options.outputsize || 100,
    forceRefresh: options.forceRefresh ?? false,
    apiKey: options.apiKey,
  });
}

export interface FetchMarketDataOptions {
  symbol?: string;
  timeframe?: string;
  forceRefresh?: boolean;
}

export interface MarketDataResponse {
  candles: CandleData[];
  source: "cache" | "live";
  fetchedAt: number;
}

/**
 * Funzione client/server unificata per il recupero dati di mercato.
 * Nel browser contatta l'endpoint API locale /api/market-data per non esporre la chiave,
 * sul server chiama direttamente fetchCandlesWithCacheDetails().
 */
export async function fetchMarketData(
  options: FetchMarketDataOptions = {}
): Promise<MarketDataResponse> {
  const {
    symbol = "XAU/USD",
    timeframe = "15M",
    forceRefresh = false,
  } = options;

  if (typeof window !== "undefined") {
    const params = new URLSearchParams();
    if (symbol) params.set("symbol", symbol);
    if (timeframe) params.set("timeframe", timeframe);
    if (forceRefresh) params.set("forceRefresh", "true");

    const res = await fetch(`/api/market-data?${params.toString()}`, {
      cache: "no-store",
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `Errore HTTP ${res.status}`);
    }
    return {
      candles: json.data as CandleData[],
      source: (json.source as "cache" | "live") || "live",
      fetchedAt: typeof json.fetchedAt === "number" ? json.fetchedAt : Date.now(),
    };
  }

  const result = await fetchCandlesWithCacheDetails({
    symbol,
    timeframe,
    forceRefresh,
  });
  return {
    candles: result.candles,
    source: result.source,
    fetchedAt: result.fetchedAt,
  };
}

