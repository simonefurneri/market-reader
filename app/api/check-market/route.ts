import { NextRequest, NextResponse } from "next/server";
import { fetchCandlesWithCache } from "@/lib/marketData";
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

const MONITORED_SYMBOLS = ["XAU/USD", "EUR/USD"];

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
    // STEP 1: CONTROLLO STATO MERCATO (ORARI FOREX/XAUUSD)
    // Se il mercato è chiuso, salva il log ed esce subito
    // --------------------------------------------------------------------------
    const marketStatus = getMarketHoursStatus();

    if (!marketStatus.isOpen || !isMarketOpen()) {
      const now = Date.now();
      for (const sym of MONITORED_SYMBOLS) {
        await saveLastCheckLog({
          timestamp: now,
          symbol: sym,
          marketOpen: false,
          signalDetected: false,
          consecutiveSignalCount: 0,
          alertSent: false,
          message: `Mercato chiuso (${marketStatus.message})`,
          authType,
          rsi: null,
          atr: null,
          atrAvg: null,
          breakoutDetected: false,
          levelBroken: null,
          breakoutType: null,
          trend1h: null,
          confermaTrend: null,
        });
      }

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
    // STEP 2: ITERAZIONE SU TUTTI I SIMBOLI CONFIGURATI
    // --------------------------------------------------------------------------
    const symbolResults: Array<{
      symbol: string;
      checked: boolean;
      signalDetected: boolean;
      signalObserving?: boolean;
      cooldownActive?: boolean;
      consecutiveSignalCount: number;
      alertSent: boolean;
      currentPrice?: number;
      message: string;
      filterResult?: unknown;
      aiAnalysis?: ExtendedMarketAnalysisResponse | null;
    }> = [];

    let totalAlertsSent = 0;

    for (const symbol of MONITORED_SYMBOLS) {
      try {
        const isForex = symbol.toUpperCase().includes("EUR");
        const decimals = isForex ? 4 : 2;

        // 1. Candele 15M SEMPRE fresche (forceRefresh = true: bypass cache TwelveData, poi salva su Redis)
        const candles15m = await fetchCandlesWithCache({
          symbol,
          timeframe: "15M",
          outputsize: 100,
          forceRefresh: true,
        });

        if (!candles15m || candles15m.length === 0) {
          await saveLastCheckLog({
            timestamp: Date.now(),
            symbol,
            marketOpen: true,
            signalDetected: false,
            consecutiveSignalCount: 0,
            alertSent: false,
            message: `Errore recupero candele 15M per ${symbol}`,
            authType,
            rsi: null,
            atr: null,
            atrAvg: null,
            breakoutDetected: false,
            levelBroken: null,
            breakoutType: null,
            trend1h: null,
            confermaTrend: null,
          });

          symbolResults.push({
            symbol,
            checked: false,
            signalDetected: false,
            consecutiveSignalCount: 0,
            alertSent: false,
            message: `Dati 15M non disponibili da Twelve Data per ${symbol}`,
          });
          continue;
        }

        // 2. Candele 1H da cache condivisa (TTL 18 min, se presente altrimenti fetch TwelveData e salva in cache)
        const candles1h = await fetchCandlesWithCache({
          symbol,
          timeframe: "1H",
          outputsize: 100,
          forceRefresh: false,
        }).catch((err) => {
          console.warn(`[CHECK-MARKET] Warning prelievo candele 1H per ${symbol}:`, err);
          return null;
        });

        // 3. Calcolo indicatori tecnici sul 15M e sull'1H
        const indicators15m = calculateTechnicalIndicators(candles15m, symbol, "15m");
        const indicators1h =
          candles1h && candles1h.length >= 20
            ? calculateTechnicalIndicators(candles1h, symbol, "1h")
            : undefined;

        // 4. Applicazione del filtro locale opportunita sul 15M (>= 2 condizioni su 3)
        const filterResult = checkPotentialOpportunity(indicators15m, candles15m);

        // Indicatori grezzi per log / dashboard
        const rawRsi = filterResult.dettagli.rsiValore ?? indicators15m.rsi14 ?? null;
        const rawAtr = filterResult.dettagli.atrAttuale ?? indicators15m.atr14 ?? null;
        const rawAtrAvg = filterResult.dettagli.atrMediaStorica ?? null;
        const rawBreakoutDetected = Boolean(
          filterResult.dettagli.breakoutResistenza || filterResult.dettagli.breakoutSupporto
        );
        const rawLevelBroken = filterResult.dettagli.livelloRotto ?? null;
        const rawBreakoutType = filterResult.dettagli.tipoBreakout ?? null;

        // 5. Calcolo direzione trend sull'1H confrontando EMA20 vs EMA50
        let trend1h: "rialzista" | "ribassista" | "laterale" = "laterale";
        if (indicators1h && indicators1h.ema20 !== null && indicators1h.ema50 !== null) {
          if (indicators1h.ema20 > indicators1h.ema50) {
            trend1h = "rialzista";
          } else if (indicators1h.ema20 < indicators1h.ema50) {
            trend1h = "ribassista";
          }
        }

        // Calcolo direzione implicita del segnale 15M
        let direction15m: "rialzista" | "ribassista" | "neutrale" = "neutrale";
        let bullishPoints = 0;
        let bearishPoints = 0;

        if (filterResult.dettagli.breakoutResistenza) bullishPoints += 2;
        if (filterResult.dettagli.breakoutSupporto) bearishPoints += 2;

        if (filterResult.dettagli.rsiValore !== null && filterResult.dettagli.rsiValore !== undefined) {
          if (filterResult.dettagli.rsiValore >= 60) bullishPoints += 1;
          else if (filterResult.dettagli.rsiValore <= 40) bearishPoints += 1;
        }

        if (indicators15m.emaTrend === "bullish") bullishPoints += 1;
        else if (indicators15m.emaTrend === "bearish") bearishPoints += 1;

        if (bullishPoints > bearishPoints) direction15m = "rialzista";
        else if (bearishPoints > bullishPoints) direction15m = "ribassista";

        // Verifica concordanza multi-timeframe (15M vs 1H)
        let isConcorde = false;
        let isDiscorde = false;

        if (direction15m === "rialzista" && trend1h === "rialzista") {
          isConcorde = true;
        } else if (direction15m === "ribassista" && trend1h === "ribassista") {
          isConcorde = true;
        } else if (
          (direction15m === "rialzista" && trend1h === "ribassista") ||
          (direction15m === "ribassista" && trend1h === "rialzista")
        ) {
          isDiscorde = true;
        }

        const confermaTrendLabel = isConcorde
          ? "concorde"
          : isDiscorde
          ? "discorde"
          : "neutrale";

        // 6. Il segnale è valido SOLO se 15M ha 2+ condizioni E la direzione 15M è concorde con 1H
        const isSignalValid = filterResult.potenzialeOpportunita && isConcorde;

        // CASO A: Nessun segnale valido (non soddisfa 15M o discorde con 1H)
        if (!isSignalValid) {
          await resetConsecutiveSignalCount(symbol);

          const failureReason = filterResult.potenzialeOpportunita && isDiscorde
            ? `Filtro 15M rilevato ma scartato: trend 1H discorde (15M ${direction15m} vs 1H ${trend1h})`
            : "Nessun segnale (mercato in consolidamento)";

          await saveLastCheckLog({
            timestamp: Date.now(),
            symbol,
            marketOpen: true,
            signalDetected: false,
            consecutiveSignalCount: 0,
            alertSent: false,
            message: failureReason,
            currentPrice: indicators15m.currentPrice,
            authType,
            condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
            motivi: filterResult.motivi,
            rsi: rawRsi,
            atr: rawAtr,
            atrAvg: rawAtrAvg,
            breakoutDetected: rawBreakoutDetected,
            levelBroken: rawLevelBroken,
            breakoutType: rawBreakoutType,
            trend1h,
            confermaTrend: confermaTrendLabel,
          });

          symbolResults.push({
            symbol,
            checked: true,
            signalDetected: false,
            consecutiveSignalCount: 0,
            alertSent: false,
            currentPrice: indicators15m.currentPrice,
            message: failureReason,
            filterResult,
          });
          continue;
        }

        // CASO B: Segnale valido e concorde -> Gestione persistenza per-simbolo
        const consecutiveSignalCount = await incrementConsecutiveSignalCount(symbol);
        const storageState = await getMarketStorageState(symbol);

        // B1: Segnale in osservazione (< REQUIRED_CONSECUTIVE_SIGNALS)
        if (consecutiveSignalCount < REQUIRED_CONSECUTIVE_SIGNALS) {
          const msg = `Segnale in osservazione (${consecutiveSignalCount}/${REQUIRED_CONSECUTIVE_SIGNALS}) - Trend 1H concorde`;

          await saveLastCheckLog({
            timestamp: Date.now(),
            symbol,
            marketOpen: true,
            signalDetected: true,
            consecutiveSignalCount,
            alertSent: false,
            message: msg,
            currentPrice: indicators15m.currentPrice,
            authType,
            condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
            motivi: filterResult.motivi,
            rsi: rawRsi,
            atr: rawAtr,
            atrAvg: rawAtrAvg,
            breakoutDetected: rawBreakoutDetected,
            levelBroken: rawLevelBroken,
            breakoutType: rawBreakoutType,
            trend1h,
            confermaTrend: "concorde",
          });

          symbolResults.push({
            symbol,
            checked: true,
            signalDetected: true,
            signalObserving: true,
            consecutiveSignalCount,
            alertSent: false,
            currentPrice: indicators15m.currentPrice,
            message: msg,
            filterResult,
          });
          continue;
        }

        // B2: Segnale persistente (>= 3 verifiche) -> Controllo Cooldown per-simbolo
        const now = Date.now();
        const lastAlertTimestamp = storageState.lastAlertTimestamp || 0;
        const msSinceLastAlert = now - lastAlertTimestamp;
        const minutesSinceLastAlert =
          lastAlertTimestamp > 0 ? Math.floor(msSinceLastAlert / (1000 * 60)) : 9999;

        if (lastAlertTimestamp > 0 && minutesSinceLastAlert < ALERT_COOLDOWN_MINUTES) {
          const msg = `Segnale valido persistente ma alert in cooldown (${minutesSinceLastAlert}/${ALERT_COOLDOWN_MINUTES} min)`;

          await saveLastCheckLog({
            timestamp: now,
            symbol,
            marketOpen: true,
            signalDetected: true,
            consecutiveSignalCount,
            alertSent: false,
            message: msg,
            currentPrice: indicators15m.currentPrice,
            authType,
            condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
            motivi: filterResult.motivi,
            rsi: rawRsi,
            atr: rawAtr,
            atrAvg: rawAtrAvg,
            breakoutDetected: rawBreakoutDetected,
            levelBroken: rawLevelBroken,
            breakoutType: rawBreakoutType,
            trend1h,
            confermaTrend: "concorde",
          });

          symbolResults.push({
            symbol,
            checked: true,
            signalDetected: true,
            cooldownActive: true,
            consecutiveSignalCount,
            alertSent: false,
            currentPrice: indicators15m.currentPrice,
            message: msg,
            filterResult,
          });
          continue;
        }

        // 7. Segnale persistente e cooldown superato -> Analisi Gemini AI Multi-Timeframe
        let aiAnalysis: ExtendedMarketAnalysisResponse | null = null;
        try {
          aiAnalysis = await analyzeMarket(indicators15m, {
            symbol,
            skipGeminiIfNoSignal: true,
            candles: candles15m,
            candles1h: candles1h || undefined,
            indicators1h,
          });
        } catch (aiErr) {
          console.error(`[CHECK-MARKET] Errore AI per ${symbol}:`, aiErr);
        }

        const isAiConfirmed =
          aiAnalysis &&
          aiAnalysis.conferma_opportunita !== false &&
          aiAnalysis.parametri_operativi?.opportunita_valida !== false;

        let telegramSent = false;
        let telegramError: string | undefined;

        if (isAiConfirmed && aiAnalysis) {
          const mtfMotive = `Trend 1H concorde: EMA20 (${indicators1h?.ema20?.toFixed(decimals)}) ${
            trend1h === "rialzista" ? ">" : "<"
          } EMA50 (${indicators1h?.ema50?.toFixed(decimals)}) [${trend1h.toUpperCase()}]`;

          const telegramResult = await sendTelegramMarketAlert({
            symbol,
            trend: aiAnalysis.trend,
            forza_trend: aiAnalysis.forza_trend,
            volatilita: aiAnalysis.volatilita,
            conferma_trend: "concorde",
            trend_1h: trend1h,
            livelli_chiave: aiAnalysis.livelli_chiave,
            scenario_probabile: aiAnalysis.scenario_probabile,
            motivi_filtro: [...filterResult.motivi, mtfMotive],
            entry_price: aiAnalysis.parametri_operativi?.entry_price,
            stop_loss: aiAnalysis.parametri_operativi?.stop_loss,
            take_profit: aiAnalysis.parametri_operativi?.take_profit,
            rischio: aiAnalysis.parametri_operativi?.rischio,
            currentPrice: indicators15m.currentPrice,
          });

          telegramSent = telegramResult.success;
          telegramError = telegramResult.error;

          if (telegramSent) {
            totalAlertsSent += 1;
          }

          // Aggiornamento storage per questo simbolo: salva timestamp e azzera contatore
          await recordAlertSent(symbol, now);
        }

        const outcomeMessage = isAiConfirmed
          ? telegramSent
            ? `Alert inviato con successo su Telegram per ${symbol}`
            : `Alert confermato dall'AI per ${symbol} (errore invio Telegram)`
          : `Segnale persistente per ${symbol} non confermato dall'analisi AI`;

        await saveLastCheckLog({
          timestamp: Date.now(),
          symbol,
          marketOpen: true,
          signalDetected: true,
          consecutiveSignalCount,
          alertSent: telegramSent,
          message: outcomeMessage,
          currentPrice: indicators15m.currentPrice,
          authType,
          condizioniSoddisfatte: filterResult.dettagli.condizioniSoddisfatte,
          motivi: filterResult.motivi,
          rsi: rawRsi,
          atr: rawAtr,
          atrAvg: rawAtrAvg,
          breakoutDetected: rawBreakoutDetected,
          levelBroken: rawLevelBroken,
          breakoutType: rawBreakoutType,
          trend1h,
          confermaTrend: "concorde",
        });

        symbolResults.push({
          symbol,
          checked: true,
          signalDetected: true,
          consecutiveSignalCount,
          alertSent: telegramSent,
          currentPrice: indicators15m.currentPrice,
          message: outcomeMessage,
          filterResult,
          aiAnalysis,
        });
      } catch (symbolErr) {
        console.error(`[CHECK-MARKET] Errore elaborazione simbolo ${symbol}:`, symbolErr);
      }
    }

    return NextResponse.json(
      {
        checked: true,
        marketOpen: true,
        alert: totalAlertsSent > 0,
        symbolsChecked: MONITORED_SYMBOLS,
        totalAlertsSent,
        results: symbolResults,
        marketStatus: {
          isOpen: marketStatus.isOpen,
          isClosed: marketStatus.isClosed,
          message: marketStatus.message,
        },
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
      symbol: "XAU/USD",
      marketOpen: true,
      signalDetected: false,
      consecutiveSignalCount: 0,
      alertSent: false,
      message: `Errore di sistema: ${errorMsg}`,
      authType,
      rsi: null,
      atr: null,
      atrAvg: null,
      breakoutDetected: false,
      levelBroken: null,
      breakoutType: null,
      trend1h: null,
      confermaTrend: null,
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

