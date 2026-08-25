import { NextRequest, NextResponse } from "next/server";
import { analyzeMarket } from "@/lib/analyzeMarket";
import { fetchCandlesWithCache } from "@/lib/marketData";
import { calculateTechnicalIndicators } from "@/lib/indicators";
import { getMarketHoursStatus } from "@/lib/marketHours";
import { saveManualAnalysis, getManualAnalysisHistory } from "@/lib/kv";
import { StoredManualAnalysis } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET: Restituisce lo storico delle ultime 10 analisi manuali memorizzate su Redis.
 */
export async function GET() {
  try {
    const history = await getManualAnalysisHistory(10);
    return NextResponse.json({ success: true, history });
  } catch (error) {
    console.error("Errore durante il recupero dello storico analisi:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Errore durante il recupero dello storico analisi.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/**
 * POST: Esegue una nuova analisi manuale:
 * 1. Usa dati FRESCHI per timeframe 15M (bypass lettura cache, fetch Twelve Data, salvataggio su Redis).
 * 2. Usa dati in CACHE per timeframe 1H se presenti (altrimenti fetch Twelve Data e salvataggio su Redis).
 * 3. Calcola indicatori tecnici ed esegue l'analisi Gemini AI.
 * 4. Salva il risultato su Redis nella lista dello storico (max 10 elementi, LPUSH + LTRIM).
 */
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey.trim() === "") {
      return NextResponse.json(
        {
          success: false,
          error:
            "Chiave GEMINI_API_KEY mancante. Configura GEMINI_API_KEY nel file .env.local per abilitare l'analisi AI.",
        },
        { status: 500 }
      );
    }

    // Estrazione eventuale simbolo dalla richiesta (default: "XAU/USD")
    let symbol = "XAU/USD";
    try {
      const body = await req.json();
      if (body && typeof body.symbol === "string" && body.symbol.trim() !== "") {
        symbol = body.symbol.trim();
      }
    } catch {
      // Body vuoto o non JSON: usa default
    }

    // 1. Candele 15M fresche (forceRefresh = true: bypass cache TwelveData e salvataggio su Redis)
    const candles15m = await fetchCandlesWithCache({
      symbol,
      timeframe: "15M",
      outputsize: 100,
      forceRefresh: true,
    });

    if (!candles15m || candles15m.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Dati candela 15M non disponibili da Twelve Data per ${symbol}.`,
        },
        { status: 502 }
      );
    }

    // 2. Candele 1H di conferma (forceRefresh = false: legge dalla cache se presenti, altrimenti fetch e cache)
    const candles1h = await fetchCandlesWithCache({
      symbol,
      timeframe: "1H",
      outputsize: 100,
      forceRefresh: false,
    }).catch((err) => {
      console.warn(`[API /analyze] Warning recupero candele 1H per ${symbol}:`, err);
      return null;
    });

    // 3. Calcolo indicatori tecnici sul timeframe primario (15M) e timeframe di conferma (1H)
    const indicators15m = calculateTechnicalIndicators(candles15m, symbol, "15m");
    const indicators1h =
      candles1h && candles1h.length >= 20
        ? calculateTechnicalIndicators(candles1h, symbol, "1h")
        : undefined;

    const marketStatus = getMarketHoursStatus();

    // 4. Analisi di mercato con Gemini AI (MTF 15M + 1H)
    const result = await analyzeMarket(indicators15m, {
      symbol,
      skipGeminiIfNoSignal: false,
      candles: candles15m,
      candles1h: candles1h || undefined,
      indicators1h,
      apiKey: apiKey.trim(),
    });

    if (!result) {
      throw new Error("Errore durante l'elaborazione dell'analisi di mercato.");
    }

    // 5. Salvataggio su Redis nella lista storico manuale (max 10 elementi)
    const entry: StoredManualAnalysis = {
      id: `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      symbol,
      currentPrice: indicators15m.currentPrice,
      indicators: indicators15m,
      analysis: result,
      modelUsed: result.modelUsed || null,
      filterResult: result.filterResult,
    };

    await saveManualAnalysis(entry);

    return NextResponse.json({
      success: true,
      symbol,
      data: result,
      entry,
      modelUsed: result.modelUsed,
      filterResult: result.filterResult,
      marketStatus: {
        isOpen: marketStatus.isOpen,
        isClosed: marketStatus.isClosed,
        message: marketStatus.message,
      },
    });
  } catch (error) {
    console.error("Errore durante l'analisi con Gemini AI:", error);
    const message =
      error instanceof Error
        ? error.message
        : "Si è verificato un errore durante l'elaborazione dell'analisi AI.";

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}

