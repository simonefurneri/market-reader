import { NextRequest, NextResponse } from "next/server";
import { analyzeMarket } from "@/lib/analyzeMarket";
import { TechnicalIndicatorsSummary } from "@/lib/types";
import { getMarketHoursStatus } from "@/lib/marketHours";

export const dynamic = "force-dynamic";

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

    const body = await req.json();
    const indicators: Partial<TechnicalIndicatorsSummary> =
      body.indicators || body;

    const currentPrice = indicators.currentPrice ?? body.currentPrice;

    if (currentPrice === undefined || currentPrice === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Dati insufficienti: prezzo attuale (currentPrice) obbligatorio.",
        },
        { status: 400 }
      );
    }

    const marketStatus = getMarketHoursStatus();

    // Chiamata con skipGeminiIfNoSignal: false
    // Ottiene sempre la risposta da Gemini (con parametri operativi inclusi automaticamente se c'è segnale)
    const result = await analyzeMarket(
      indicators as TechnicalIndicatorsSummary,
      {
        skipGeminiIfNoSignal: false,
        apiKey: apiKey.trim(),
      }
    );

    if (!result) {
      throw new Error("Errore durante l'elaborazione dell'analisi di mercato.");
    }

    return NextResponse.json({
      success: true,
      data: result,
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
