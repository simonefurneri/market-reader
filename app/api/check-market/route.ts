import { NextRequest, NextResponse } from "next/server";
import { getXAUUSD15mCandles } from "@/lib/marketData";
import { calculateTechnicalIndicators } from "@/lib/indicators";
import { checkPotentialOpportunity } from "@/lib/opportunityFilter";
import { analyzeMarket } from "@/lib/analyzeMarket";
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
    // STEP 5: SEGNALE PERSISTENTE E COOLDOWN SUPERATO -> ANALISI GEMINI UNIFICATA
    // --------------------------------------------------------------------------
    let aiAnalysis: ExtendedMarketAnalysisResponse | null = null;
    let modelUsed: string | null = null;

    try {
      const analyzeResponse = await analyzeMarket(indicators, {
        skipGeminiIfNoSignal: true,
        candles,
      });

      if (!analyzeResponse) {
        // Se null (nessun segnale valido per analyzeMarket), esce pulito
        return NextResponse.json({
          checked: true,
          marketOpen: true,
          alert: false,
          reason: filterResult.motivazione,
          filterResult,
        });
      }

      aiAnalysis = analyzeResponse;
      modelUsed = analyzeResponse.modelUsed || null;
    } catch (aiErr) {
      console.error("[CHECK-MARKET] Errore elaborazione AI:", aiErr);
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
