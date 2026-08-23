import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getXAUUSD15mCandles } from "@/lib/marketData";
import { calculateTechnicalIndicators } from "@/lib/indicators";
import { checkPotentialOpportunity } from "@/lib/opportunityFilter";
import { sendTelegramMarketAlert } from "@/lib/telegram";
import { getMarketHoursStatus, isMarketOpen } from "@/lib/marketHours";
import {
  CheckMarketApiResponse,
  ExtendedMarketAnalysisResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";

// Modelli Gemini con fallback in ordine di priorità
const FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

const MAX_RETRIES_PER_MODEL = 2;

const EXTENDED_SYSTEM_PROMPT = `Sei un assistente esperto di analisi tecnica che aiuta a LEGGERE e interpretare il mercato XAUUSD (Oro) su timeframe 15m.
Il sistema di screening algoritmico ha identificato una POTENZIALE OPPORTUNITÀ tecnica (rottura di livelli, momentum RSI o espansione di volatilità).

Il tuo compito è analizzare la situazione tecnica e rispondere ESCLUSIVAMENTE in formato JSON con la seguente struttura:
{
  "conferma_opportunita": boolean (true se la configurazione tecnica giustifica un setup coerente, false se è falso segnale o mercato troppo incerto),
  "trend": "rialzista" | "ribassista" | "laterale",
  "forza_trend": "debole" | "moderata" | "forte",
  "volatilita": "bassa" | "media" | "alta",
  "livelli_chiave": ["string", "string"],
  "scenario_probabile": "string (2-3 frasi chiare che spiegano la dinamica dei prezzi)",
  "cosa_osservare": "string (1-2 frasi sui fattori scatenanti o conferme da attendere)",
  "parametri_operativi": {
    "opportunita_valida": boolean,
    "tipo_operazione": "long" | "short" | "nessuna",
    "entry_price": "string (es. $2350.50) o null se non opportuno",
    "stop_loss": "string (es. $2343.00 basato su supporti/ATR) o null",
    "take_profit": "string (es. $2365.00 basato su resistenze/RR) o null",
    "rischio": "string (IMPORTANTE: chiarisci SEMPRE in modo esplicito che questi livelli sono calcolati esclusivamente sui soli indicatori tecnici e non costituiscono garanzie di profitto né consigli finanziari)"
  },
  "mercato_chiuso": boolean
}

Regole fondamentali:
1. NON dare consigli finanziari o promesse di guadagno.
2. I parametri operativi (entry, stop loss, take profit) devono essere indicativi e strettamente coerenti con i supporti, le resistenze, le EMA e la volatilità ATR fornita.
3. Se il mercato è privo di una direzione pulita, imposta "conferma_opportunita": false e "tipo_operazione": "nessuna".
4. Il campo "rischio" deve SEMPRE contenere il disclaimer che i parametri sono calcolati puramente su indicatori tecnici.`;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Verifica l'autorizzazione della richiesta confrontando il segreto fornito
 * con la variabile d'ambiente CRON_SECRET.
 */
function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();

  // Se CRON_SECRET è impostato, verifica l'header Authorization o x-cron-secret
  if (!cronSecret) {
    // In ambiente senza segreto configurato (es. test locale iniziale), logghiamo un warning
    console.warn(
      "[CHECK-MARKET] CRON_SECRET non configurato nelle variabili d'ambiente."
    );
    return true;
  }

  const authHeader = req.headers.get("authorization")?.trim();
  const customHeader = req.headers.get("x-cron-secret")?.trim();
  const querySecret = req.nextUrl.searchParams.get("secret")?.trim();

  if (customHeader && customHeader === cronSecret) return true;
  if (querySecret && querySecret === cronSecret) return true;

  if (authHeader) {
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : authHeader;
    if (token === cronSecret) return true;
  }

  return false;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // --------------------------------------------------------------------------
  // PROTEZIONE ENDPOINT CON CRON_SECRET
  // --------------------------------------------------------------------------
  if (!isAuthorized(req)) {
    return NextResponse.json(
      {
        checked: false,
        alert: false,
        error:
          "Accesso non autorizzato. Header di autorizzazione (CRON_SECRET) non valido o mancante.",
      },
      { status: 401 }
    );
  }

  try {
    // --------------------------------------------------------------------------
    // STEP 1: CONTROLLO STATO MERCATO (ORARI FOREX/XAUUSD) - PRIMISSIMO STEP
    // Se il mercato è chiuso, restituisce subito senza fare alcun fetch né chiamate AI
    // --------------------------------------------------------------------------
    const marketStatus = getMarketHoursStatus();

    if (!marketStatus.isOpen || !isMarketOpen()) {
      return NextResponse.json(
        {
          checked: true,
          marketOpen: false,
          alert: false,
          reason: marketStatus.message,
          marketStatus: {
            isOpen: false,
            isClosed: true,
            message: marketStatus.message,
          },
        },
        { status: 200 }
      );
    }

    // --------------------------------------------------------------------------
    // STEP 2: RECUPERO DATI LIVE E CALCOLO INDICATORI TECNICI (MERCATO APERTO)
    // --------------------------------------------------------------------------
    const candles = await getXAUUSD15mCandles();
    if (!candles || candles.length === 0) {
      return NextResponse.json(
        {
          checked: false,
          marketOpen: true,
          alert: false,
          error: "Dati di mercato non disponibili da Twelve Data.",
        },
        { status: 502 }
      );
    }

    const indicators = calculateTechnicalIndicators(candles);

    // --------------------------------------------------------------------------
    // STEP 3: APPLICAZIONE DEL FILTRO LOCALE OPPORTUNITYFILTER
    // --------------------------------------------------------------------------
    const filterResult = checkPotentialOpportunity(indicators, candles);

    // --------------------------------------------------------------------------
    // STEP 4: SE NON C'È OPPORTUNITÀ, RESTITUISCE { checked: true, alert: false }
    // --------------------------------------------------------------------------
    if (!filterResult.potenzialeOpportunita) {
      const responsePayload: CheckMarketApiResponse = {
        checked: true,
        marketOpen: true,
        alert: false,
        reason: filterResult.motivazione,
        currentPrice: indicators.currentPrice,
        marketStatus: {
          isOpen: marketStatus.isOpen,
          isClosed: marketStatus.isClosed,
          message: marketStatus.message,
        },
        filterResult,
      };

      return NextResponse.json(responsePayload, { status: 200 });
    }

    // --------------------------------------------------------------------------
    // STEP 5: OPPORTUNITÀ RILEVATA -> CHIAMATA GEMINI AI CON PROMPT ESTESO
    // --------------------------------------------------------------------------
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      console.warn(
        "[CHECK-MARKET] GEMINI_API_KEY non configurata. Impossibile completare l'analisi AI."
      );
      return NextResponse.json({
        checked: true,
        marketOpen: true,
        alert: false,
        warning:
          "Opportunità rilevata dal filtro locale, ma GEMINI_API_KEY non configurata per validazione AI.",
        filterResult,
      });
    }

    // Preparazione prompt arricchito con dettagli del filtro
    const reasonsText = filterResult.motivi.join("\n- ");
    const userPrompt = `Stato Mercato: ${marketStatus.message} (Chiuso: ${marketStatus.isClosed ? "Sì" : "No"})
Filtro Locale Segnali Rilevati:
- ${reasonsText}

Dati Tecnici Attuali su XAUUSD (15m):
${indicators.promptSummary}

Valuta attentamente la configurazione. Se confermi l'opportunità, calcola i livelli indicativi di Entry, Stop Loss (basato su S1/S2 o ATR) e Take Profit (basato su R1/R2 o risk/reward) inserendo l'obbligatorio testo di chiarimento nel campo "rischio".`;

    const systemPrompt = EXTENDED_SYSTEM_PROMPT;

    const ai = new GoogleGenAI({ apiKey });
    let aiAnalysis: ExtendedMarketAnalysisResponse | null = null;
    let modelUsed: string | null = null;
    const attemptErrors: string[] = [];

    // Fallback automatico sui modelli Gemini disponibili
    for (const model of FALLBACK_MODELS) {
      for (let attempt = 1; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: userPrompt,
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: "application/json",
              temperature: 0.2,
            },
          });

          const responseText = response.text?.trim() || "";
          if (!responseText) {
            throw new Error(`Risposta vuota ricevuta dal modello ${model}`);
          }

          try {
            aiAnalysis = JSON.parse(responseText) as ExtendedMarketAnalysisResponse;
          } catch {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              aiAnalysis = JSON.parse(jsonMatch[0]) as ExtendedMarketAnalysisResponse;
            } else {
              throw new Error("Formato JSON non valido nella risposta AI");
            }
          }

          if (aiAnalysis) {
            aiAnalysis.mercato_chiuso = marketStatus.isClosed;
            modelUsed = model;
            break;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          attemptErrors.push(`[${model} tent ${attempt}]: ${errorMsg}`);
          if (attempt < MAX_RETRIES_PER_MODEL) {
            await sleep(350);
          }
        }
      }

      if (aiAnalysis) break;
    }

    if (!aiAnalysis) {
      console.error(
        "[CHECK-MARKET] Errore analisi AI:",
        attemptErrors.slice(-3).join(" | ")
      );
      return NextResponse.json({
        checked: true,
        marketOpen: true,
        alert: false,
        warning: "Filtro locale superato ma fallita l'elaborazione AI.",
        filterResult,
      });
    }

    // --------------------------------------------------------------------------
    // STEP 6: NOTIFICA TELEGRAM SE CONFERMATA DALL'AI
    // --------------------------------------------------------------------------
    const isAiConfirmed =
      aiAnalysis.conferma_opportunita !== false &&
      aiAnalysis.parametri_operativi?.opportunita_valida !== false;

    let telegramSent = false;
    let telegramError: string | undefined;

    if (isAiConfirmed) {
      const telegramResult = await sendTelegramMarketAlert({
        trend: aiAnalysis.trend,
        forza_trend: aiAnalysis.forza_trend,
        volatilita: aiAnalysis.volatilita,
        livelli_chiave: aiAnalysis.livelli_chiave,
        scenario_probabile: aiAnalysis.scenario_probabile,
        motivi_filtro: filterResult.motivi,
        entry_price: aiAnalysis.parametri_operativi?.entry_price,
        stop_loss: aiAnalysis.parametri_operativi?.stop_loss,
        take_profit: aiAnalysis.parametri_operativi?.take_profit,
        rischio: aiAnalysis.parametri_operativi?.rischio,
        currentPrice: indicators.currentPrice,
      });

      telegramSent = telegramResult.success;
      telegramError = telegramResult.error;
    }

    const responsePayload: CheckMarketApiResponse = {
      checked: true,
      marketOpen: true,
      alert: isAiConfirmed,
      telegramSent,
      telegramError,
      currentPrice: indicators.currentPrice,
      marketStatus: {
        isOpen: marketStatus.isOpen,
        isClosed: marketStatus.isClosed,
        message: marketStatus.message,
      },
      filterResult,
      aiAnalysis,
    };

    return NextResponse.json(
      {
        ...responsePayload,
        modelUsed,
      },
      { status: 200 }
    );
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Errore durante il controllo di mercato";
    console.error("[CHECK-MARKET API Error]:", err);

    return NextResponse.json(
      {
        checked: false,
        alert: false,
        error: errorMsg,
      },
      { status: 500 }
    );
  }
}
