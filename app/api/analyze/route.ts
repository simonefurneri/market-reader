import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { MarketAnalysisResponse, TechnicalIndicatorsSummary } from "@/lib/types";
import { getMarketHoursStatus } from "@/lib/marketHours";

export const dynamic = "force-dynamic";

const BASE_SYSTEM_PROMPT = `Sei un assistente che aiuta un trader principiante a LEGGERE il mercato XAUUSD, non a decidere se operare. Dato un set di indicatori tecnici, rispondi SEMPRE in questo formato JSON:
{
  "trend": "rialzista" | "ribassista" | "laterale",
  "forza_trend": "debole" | "moderata" | "forte",
  "volatilita": "bassa" | "media" | "alta",
  "livelli_chiave": ["string", "string"],
  "scenario_probabile": "string (2-3 frasi, linguaggio semplice)",
  "cosa_osservare": "string (1-2 frasi su cosa monitorare dopo)",
  "mercato_chiuso": boolean
}
Non dare mai indicazioni dirette tipo 'apri long' o 'apri short'.
Non promettere risultati. Ricorda sempre che è un'analisi, non un consiglio di investimento.`;

// Lista modelli in ordine di priorità per il piano Google AI
const FALLBACK_MODELS = [
  "gemini-3.6-flash",       // Modello di punta Flash (massima qualità/ragionamento)
  "gemini-3.5-flash",       // Modello ad alta capacità per workflow complessi
  "gemini-3-flash-preview", // Modello Flash serie 3 con capacità multimodali e reasoning
  "gemini-3.5-flash-lite",  // Modello lightweight veloce serie 3.5
  "gemini-3.1-flash-lite",  // Modello ultra rapido a bassa latenza
  "gemini-flash-latest",    // Alias dinamico all'ultimo modello Flash stabile
];

const MAX_RETRIES_PER_MODEL = 2;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
    const ema20 = indicators.ema20 ?? body.ema20;
    const ema50 = indicators.ema50 ?? body.ema50;
    const rsi14 = indicators.rsi14 ?? body.rsi14;
    const atr14 = indicators.atr14 ?? body.atr14;
    const supports = indicators.supports ?? body.supports ?? [];
    const resistances = indicators.resistances ?? body.resistances ?? [];
    const promptSummary = indicators.promptSummary ?? body.promptSummary;

    if (currentPrice === undefined || currentPrice === null) {
      return NextResponse.json(
        {
          success: false,
          error: "Dati insufficienti: prezzo attuale (currentPrice) obbligatorio.",
        },
        { status: 400 }
      );
    }

    // Calcolo stato mercato (Aperto vs Chiuso nel weekend/fuori orario NY)
    const marketStatus = getMarketHoursStatus();

    // System prompt arricchito con lo stato attuale del mercato
    let systemPrompt = BASE_SYSTEM_PROMPT;
    if (marketStatus.isClosed) {
      systemPrompt += `\n\nIMPORTANTE CONTESTO ATTUALE: Il mercato XAUUSD è attualmente CHIUSO (${marketStatus.message}). Nel campo "scenario_probabile", tieni conto che i prezzi sono fermi per la chiusura del mercato e che alla riapertura potrebbero verificarsi gap di prezzo o spread allargati. Imposta "mercato_chiuso": true nel JSON.`;
    }

    // Costruzione del prompt utente
    const userPrompt = promptSummary
      ? `Stato Mercato: ${marketStatus.message} (Chiuso: ${marketStatus.isClosed ? "Sì" : "No"})\n\nAnalizza la seguente situazione tecnica su XAUUSD:\n\n${promptSummary}`
      : `Stato Mercato: ${marketStatus.message} (Chiuso: ${marketStatus.isClosed ? "Sì" : "No"})
Analizza la seguente situazione tecnica su XAUUSD (timeframe 15m):
- Prezzo attuale: $${currentPrice}
- EMA 20: ${ema20 !== undefined && ema20 !== null ? `$${ema20}` : "N/D"}
- EMA 50: ${ema50 !== undefined && ema50 !== null ? `$${ema50}` : "N/D"}
- RSI 14: ${rsi14 !== undefined && rsi14 !== null ? rsi14 : "N/D"}
- ATR 14 (Volatilità): ${atr14 !== undefined && atr14 !== null ? `$${atr14}` : "N/D"}
- Supporti chiave: ${supports.length > 0 ? supports.map((s: number) => `$${s}`).join(", ") : "N/D"}
- Resistenze chiave: ${resistances.length > 0 ? resistances.map((r: number) => `$${r}`).join(", ") : "N/D"}`;

    const ai = new GoogleGenAI({ apiKey: apiKey.trim() });

    let parsedResult: MarketAnalysisResponse | null = null;
    let successfulModel: string | null = null;
    const attemptErrors: string[] = [];

    // Ciclo di fallback sui modelli in ordine di priorità
    for (const model of FALLBACK_MODELS) {
      for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model: model,
            contents: userPrompt,
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          const responseText = response.text?.trim() || "";
          if (!responseText) {
            throw new Error(`Risposta vuota ricevuta da ${model}`);
          }

          try {
            parsedResult = JSON.parse(responseText) as MarketAnalysisResponse;
          } catch {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              parsedResult = JSON.parse(jsonMatch[0]) as MarketAnalysisResponse;
            } else {
              throw new Error("Formato JSON non valido nella risposta del modello");
            }
          }

          // Garantiamo che il campo booleano mercato_chiuso sia coerente
          if (parsedResult) {
            parsedResult.mercato_chiuso = marketStatus.isClosed;
          }

          successfulModel = model;
          break;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          attemptErrors.push(`[${model} tent ${attempt}]: ${errorMsg}`);
          console.warn(`Tentativo ${attempt} con ${model} fallito: ${errorMsg}`);

          if (attempt < MAX_RETRIES_PER_MODEL) {
            await sleep(400);
          }
        }
      }

      if (parsedResult) {
        break;
      }
    }

    if (!parsedResult) {
      throw new Error(
        `Tutti i modelli AI disponibili sono falliti dopo molteplici tentativi. Dettagli: ${attemptErrors.slice(-3).join(" | ")}`
      );
    }

    return NextResponse.json({
      success: true,
      data: parsedResult,
      modelUsed: successfulModel,
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
