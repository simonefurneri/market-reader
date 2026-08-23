import { CandleData, TwelveDataTimeSeriesResponse } from "@/lib/types";

/**
 * Converte una stringa datetime di Twelve Data (es. "2024-03-22 15:45:00")
 * in un timestamp UNIX in secondi (UTCTimestamp richiesto da TradingView lightweight-charts).
 */
function parseTwelveDataTimestamp(datetimeStr: string): number {
  const isoStr = datetimeStr.includes("T")
    ? datetimeStr
    : datetimeStr.replace(" ", "T") + "Z";
  const timestampMs = Date.parse(isoStr);

  if (isNaN(timestampMs)) {
    const [datePart, timePart = "00:00:00"] = datetimeStr.split(" ");
    const [year, month, day] = datePart.split("-").map(Number);
    const [hours, minutes, seconds] = timePart.split(":").map(Number);
    return Math.floor(
      Date.UTC(year, month - 1, day, hours, minutes, seconds) / 1000
    );
  }

  return Math.floor(timestampMs / 1000);
}

export interface FetchCandlesOptions {
  symbol?: string;
  interval?: string;
  outputsize?: number;
  apiKey?: string;
}

/**
 * Recupera le candele OHLC per XAU/USD su timeframe 15m da Twelve Data
 * e le restituisce ordinate cronologicamente in formato compatibile con lightweight-charts.
 */
export async function getXAUUSD15mCandles(
  options: FetchCandlesOptions = {}
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
  endpoint.searchParams.set("apikey", apiKey.trim());

  let response: Response;
  try {
    response = await fetch(endpoint.toString(), {
      next: { revalidate: 60 },
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

/**
 * Funzione client/server unificata per il recupero dati di mercato.
 * Nel browser contatta l'endpoint API locale /api/market-data per non esporre la chiave,
 * sul server chiama direttamente getXAUUSD15mCandles().
 */
export async function fetchMarketData(): Promise<CandleData[]> {
  if (typeof window !== "undefined") {
    const res = await fetch("/api/market-data", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json.error || `Errore HTTP ${res.status}`);
    }
    return json.data as CandleData[];
  }

  return getXAUUSD15mCandles();
}
