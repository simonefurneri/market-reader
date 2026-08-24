import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { getXAUUSD15mCandles } from "@/lib/marketData";
import { calculateTechnicalIndicators } from "@/lib/indicators";
import { checkPotentialOpportunity } from "@/lib/opportunityFilter";
import { sendTelegramMarketAlert } from "@/lib/telegram";
import { getMarketHoursStatus, isMarketOpen } from "@/lib/marketHours";
import { verifyQStashSignature } from "@/lib/qstash";
import {
  getMarketStorageState,
  incrementConsecutiveSignalCount,
  resetConsecutiveSignalCount,
  recordAlertSent,
  saveLastCheckLog,
} from "@/lib/kv";
import {
  CheckMarketApiResponse,
  ExtendedMarketAnalysisResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";

// ============================================================================
// CONFIGURAZIONE PERSISTENZA E COOLDOWN ALERT
// ============================================================================

/**
 * Numero di controlli consecutivi con potenziale opportunità richiesti
 * prima di procedere con l'analisi Gemini e l'eventuale notifica Telegram.
 * Default: 3 (il segnale deve persistere per 3 controlli di fila).
 */
const REQUIRED_CONSECUTIVE_SIGNALS = 3;

/**
 * Intervallo minimo di cooldown in minuti tra un alert inviato e il successivo.
 * Default: 60 minuti.
 */
const ALERT_COOLDOWN_MINUTES = 60;

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
Il sistema di screening algoritmico ha identificato un SEGNALE CONFERMATO persistente (almeno 2 condizioni tecniche contemporanee confermate per più controlli consecutivi).

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
 * Verifica l'autenticazione della richiesta:
 * 1. Tramite firma crittografica Upstash QStash (header `Upstash-Signature`)
 * 2. Oppure tramite header segreto `CRON_SECRET` come fallback per test manuali
 */
async function authenticateRequest(
  req: NextRequest,
  rawBody: string
): Promise<{ isAuthorized: boolean; authType: "qstash" | "cron_secret" | "none" }> {
  // 1. Verifica firma QStash (se presente)
  const qstashSignature =
    req.headers.get("upstash-signature") || req.headers.get("Upstash-Signature");

  if (qstashSignature) {
    const isValidQStash = await verifyQStashSignature(
      qstashSignature,
      rawBody,
      req.url
    );

    if (isValidQStash) {
      return { isAuthorized: true, authType: "qstash" };
    }
  }

  // 2. Fallback su CRON_SECRET per chiamate manuali / curl / scheduler alternativi
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (cronSecret) {
    const authHeader = req.headers.get("authorization")?.trim();
    const customHeader = req.headers.get("x-cron-secret")?.trim();
    const querySecret = req.nextUrl.searchParams.get("secret")?.trim();

    if (customHeader && customHeader === cronSecret) {
      return { isAuthorized: true, authType: "cron_secret" };
    }
    if (querySecret && querySecret === cronSecret) {
      return { isAuthorized: true, authType: "cron_secret" };
    }
    if (authHeader) {
      const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : authHeader;
      if (token === cronSecret) {
        return { isAuthorized: true, authType: "cron_secret" };
      }
    }
  } else if (!qstashSignature) {
    console.warn(
      "[CHECK-MARKET] Nessun metodo di sicurezza (QSTASH o CRON_SECRET) configurato."
    );
    return { isAuthorized: true, authType: "none" };
  }

  return { isAuthorized: false, authType: "none" };
}

/**
 * Gestore unificato per le richieste di controllo mercato (supporta GET e POST).
 */
async function handleCheckMarket(req: NextRequest): Promise<NextResponse> {
  let rawBody = "";
  try {
    if (req.method === "POST") {
      rawBody = await req.text();
    }
  } catch (err) {
    console.warn("[CHECK-MARKET] Impossibile leggere body richiesta:", err);
  }

  // --------------------------------------------------------------------------
  // PROTEZIONE ENDPOINT: VERIFICA QSTASH / CRON_SECRET
  // --------------------------------------------------------------------------
  const { isAuthorized, authType } = await authenticateRequest(req, rawBody);

  if (!isAuthorized) {
    return NextResponse.json(
      {
        checked: false,
        alert: false,
        error:
          "Accesso non autorizzato. Firma Upstash QStash non valida o header CRON_SECRET mancante.",
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
      await saveLastCheckLog({
        timestamp: Date.now(),
        marketOpen: false,
        signalDetected: false,
        consecutiveSignalCount: 0,
        alertSent: false,
        message: `Mercato chiuso (${marketStatus.message})`,
        authType,
      });

      return NextResponse.json(
        {
          checked: true,
          marketOpen: false,
          alert: false,
          authType,
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
    // STEP 2: RECUPERO DATI LIVE E CALCOLO INDICATORI TECNICI
    // --------------------------------------------------------------------------
    const candles = await getXAUUSD15mCandles();
    if (!candles || candles.length === 0) {
      await saveLastCheckLog({
        timestamp: Date.now(),
        marketOpen: true,
        signalDetected: false,
        consecutiveSignalCount: 0,
        alertSent: false,
        message: "Errore recupero candele Twelve Data",
        authType,
      });

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
    // STEP 3: APPLICAZIONE DEL FILTRO LOCALE RAFFORZATO (>= 2 condizioni su 3)
    // --------------------------------------------------------------------------
    const filterResult = checkPotentialOpportunity(indicators, candles);

    // --------------------------------------------------------------------------
    // STEP 4: GESTIONE PERSISTENZA SEGNALI CON VERCEL KV / UPSTASH REDIS
    // --------------------------------------------------------------------------

    // CASO A: Il filtro NON rileva alcun segnale -> Reset contatore segnali continui
    if (!filterResult.potenzialeOpportunita) {
      await resetConsecutiveSignalCount();

      await saveLastCheckLog({
        timestamp: Date.now(),
        marketOpen: true,
        signalDetected: false,
        consecutiveSignalCount: 0,
        alertSent: false,
        message: "Nessun segnale (mercato in consolidamento)",
        currentPrice: indicators.currentPrice,
        authType,
        condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
        motivi: filterResult.motivi,
      });

      const responsePayload: CheckMarketApiResponse = {
        checked: true,
        marketOpen: true,
        alert: false,
        signalObserving: false,
        consecutiveSignalCount: 0,
        requiredConsecutiveSignals: REQUIRED_CONSECUTIVE_SIGNALS,
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

    // CASO B: Il filtro rileva una potenziale opportunità -> Incremento contatore
    const consecutiveSignalCount = await incrementConsecutiveSignalCount();
    const storageState = await getMarketStorageState();

    // SOTTO-CASO B1: Segnale in osservazione (sotto la soglia di N controlli consecutivi)
    if (consecutiveSignalCount < REQUIRED_CONSECUTIVE_SIGNALS) {
      await saveLastCheckLog({
        timestamp: Date.now(),
        marketOpen: true,
        signalDetected: true,
        consecutiveSignalCount,
        alertSent: false,
        message: `Segnale in osservazione (${consecutiveSignalCount}/${REQUIRED_CONSECUTIVE_SIGNALS})`,
        currentPrice: indicators.currentPrice,
        authType,
        condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
        motivi: filterResult.motivi,
      });

      const responsePayload: CheckMarketApiResponse = {
        checked: true,
        marketOpen: true,
        alert: false,
        signalObserving: true,
        consecutiveSignalCount,
        requiredConsecutiveSignals: REQUIRED_CONSECUTIVE_SIGNALS,
        reason: `Segnale in osservazione: rilevazione ${consecutiveSignalCount}/${REQUIRED_CONSECUTIVE_SIGNALS} consecutive. In attesa di persistenza prima dell'analisi AI.`,
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

    // SOTTO-CASO B2: Segnale persistente raggiunto (>= REQUIRED_CONSECUTIVE_SIGNALS)
    // Verifica del cooldown dall'ultimo alert inviato (default 60 min)
    const now = Date.now();
    const lastAlertTimestamp = storageState.lastAlertTimestamp || 0;
    const msSinceLastAlert = now - lastAlertTimestamp;
    const minutesSinceLastAlert =
      lastAlertTimestamp > 0 ? Math.floor(msSinceLastAlert / (1000 * 60)) : 9999;

    if (lastAlertTimestamp > 0 && minutesSinceLastAlert < ALERT_COOLDOWN_MINUTES) {
      await saveLastCheckLog({
        timestamp: Date.now(),
        marketOpen: true,
        signalDetected: true,
        consecutiveSignalCount,
        alertSent: false,
        message: `Segnale valido ma alert in cooldown (${minutesSinceLastAlert}/${ALERT_COOLDOWN_MINUTES} min)`,
        currentPrice: indicators.currentPrice,
        authType,
        condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
        motivi: filterResult.motivi,
      });

      const responsePayload: CheckMarketApiResponse = {
        checked: true,
        marketOpen: true,
        alert: false,
        cooldownActive: true,
        minutesSinceLastAlert,
        cooldownMinutes: ALERT_COOLDOWN_MINUTES,
        consecutiveSignalCount,
        requiredConsecutiveSignals: REQUIRED_CONSECUTIVE_SIGNALS,
        reason: `Segnale valido persistente (${consecutiveSignalCount} consecutivi), ma alert in cooldown (${minutesSinceLastAlert}/${ALERT_COOLDOWN_MINUTES} min trascorsi dall'ultima notifica).`,
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
    // STEP 5: SEGNALE PERSISTENTE E COOLDOWN SUPERATO -> CHIAMATA GEMINI AI
    // --------------------------------------------------------------------------
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      await saveLastCheckLog({
        timestamp: Date.now(),
        marketOpen: true,
        signalDetected: true,
        consecutiveSignalCount,
        alertSent: false,
        message: "Segnale persistente ma GEMINI_API_KEY non configurata",
        currentPrice: indicators.currentPrice,
        authType,
        condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
        motivi: filterResult.motivi,
      });

      return NextResponse.json({
        checked: true,
        marketOpen: true,
        alert: false,
        warning:
          "Segnale persistente confermato dal filtro locale, ma GEMINI_API_KEY non configurata.",
        filterResult,
      });
    }

    // Preparazione prompt arricchito con dettagli del filtro
    const reasonsText = filterResult.motivi.join("\n- ");
    const userPrompt = `Stato Mercato: ${marketStatus.message} (Chiuso: ${marketStatus.isClosed ? "Sì" : "No"})
Filtro Locale Segnali Rilevati (${consecutiveSignalCount} controlli consecutivi):
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
      await saveLastCheckLog({
        timestamp: Date.now(),
        marketOpen: true,
        signalDetected: true,
        consecutiveSignalCount,
        alertSent: false,
        message: "Filtro superato ma elaborazione AI fallita",
        currentPrice: indicators.currentPrice,
        authType,
        condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
        motivi: filterResult.motivi,
      });

      return NextResponse.json({
        checked: true,
        marketOpen: true,
        alert: false,
        warning: "Filtro locale superato ma fallita l'elaborazione AI.",
        filterResult,
      });
    }

    // --------------------------------------------------------------------------
    // STEP 6: NOTIFICA TELEGRAM SE CONFERMATA DALL'AI E AGGIORNAMENTO STORAGE
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

      // Aggiornamento storage: salva lastAlertTimestamp e resetta consecutiveSignalCount
      await recordAlertSent(now);
    }

    const outcomeMessage = isAiConfirmed
      ? telegramSent
        ? "Alert inviato con successo su Telegram"
        : "Alert confermato dall'AI (errore nell'invio Telegram)"
      : "Segnale persistente non confermato dall'analisi AI";

    await saveLastCheckLog({
      timestamp: Date.now(),
      marketOpen: true,
      signalDetected: true,
      consecutiveSignalCount: isAiConfirmed ? 0 : consecutiveSignalCount,
      alertSent: telegramSent,
      message: outcomeMessage,
      currentPrice: indicators.currentPrice,
      authType,
      condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
      motivi: filterResult.motivi,
    });

    const responsePayload: CheckMarketApiResponse = {
      checked: true,
      marketOpen: true,
      alert: isAiConfirmed,
      telegramSent,
      telegramError,
      consecutiveSignalCount: isAiConfirmed ? 0 : consecutiveSignalCount,
      requiredConsecutiveSignals: REQUIRED_CONSECUTIVE_SIGNALS,
      minutesSinceLastAlert: isAiConfirmed ? 0 : minutesSinceLastAlert,
      cooldownMinutes: ALERT_COOLDOWN_MINUTES,
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
        authType,
      },
      { status: 200 }
    );
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Errore durante il controllo di mercato";
    console.error("[CHECK-MARKET API Error]:", err);

    await saveLastCheckLog({
      timestamp: Date.now(),
      marketOpen: true,
      signalDetected: false,
      consecutiveSignalCount: 0,
      alertSent: false,
      message: `Errore di sistema: ${errorMsg}`,
      authType,
    });

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  return handleCheckMarket(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return handleCheckMarket(req);
}
