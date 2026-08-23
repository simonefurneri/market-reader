import { CandleData, TechnicalIndicatorsSummary } from "@/lib/types";

// ============================================================================
// SOGLIE E COSTANTI CONFIGURABILI
// ============================================================================

/**
 * Numero minimo di condizioni tecniche (tra Breakout, RSI fuori fascia, Espansione ATR)
 * che devono verificarsi CONTEMPORANEAMENTE per confermare una potenziale opportunità.
 * Default: 2 su 3 (evita falsi segnali isolati).
 */
export const MIN_REQUIRED_CONDITIONS = 2;

/**
 * Soglia inferiore dell'RSI.
 * Un valore inferiore a questa soglia indica uscita dalla fascia neutrale
 * verso una zona di ipervenduto / forte pressione ribassista.
 */
export const RSI_LOWER_THRESHOLD = 40;

/**
 * Soglia superiore dell'RSI.
 * Un valore superiore a questa soglia indica uscita dalla fascia neutrale
 * verso una zona di ipercomprato / forte spinta rialzista.
 */
export const RSI_UPPER_THRESHOLD = 60;

/**
 * Soglia estrema di ipervenduto classico (RSI <= 30).
 */
export const RSI_EXTREME_OVERSOLD = 30;

/**
 * Soglia estrema di ipercomprato classico (RSI >= 70).
 */
export const RSI_EXTREME_OVERBOUGHT = 70;

/**
 * Numero di candele storiche su cui calcolare la media della volatilità (ATR / True Range).
 */
export const ATR_LOOKBACK_PERIOD = 20;

/**
 * Fattore moltiplicativo di espansione della volatilità ATR.
 * Es. 1.20 = l'ATR attuale deve superare del 20% la media delle ultime 20 candele
 * per indicare un risveglio o ritorno di volatilità dopo una fase di compressione.
 */
export const ATR_EXPANSION_MULTIPLIER = 1.2;

/**
 * Margine percentuale minimo di conferma per considerare valida una rottura (breakout)
 * di supporto o resistenza (0.0002 = 0.02% del prezzo, 0 = chiusura oltre il livello).
 */
export const BREAKOUT_CONFIRMATION_MARGIN = 0.0002;

/**
 * Numero minimo di candele richiesto per valutare la serie storica.
 */
export const MIN_CANDLES_FOR_HISTORY = 2;

// ============================================================================
// TIPI E INTERFACCE
// ============================================================================

export interface OpportunityFilterInput {
  currentPrice: number;
  ema20?: number | null;
  ema50?: number | null;
  rsi14?: number | null;
  atr14?: number | null;
  supports?: number[];
  resistances?: number[];
  candles?: CandleData[];
}

export interface OpportunityFilterDetails {
  breakoutResistenza: boolean;
  breakoutSupporto: boolean;
  livelloRotto?: number | null;
  tipoBreakout?: "resistenza" | "supporto" | null;
  rsiUscitaFascia: boolean;
  rsiValore: number | null;
  rsiStato: "ipercomprato" | "ipervenduto" | "neutrale";
  atrEspansione: boolean;
  atrAttuale: number | null;
  atrMediaStorica: number | null;
  atrIncrementoPercentuale: number | null;
  trendEma: "bullish" | "bearish" | "neutral";
  condizioniSoddisfatte: number;
  condizioniMinimeRichieste: number;
}

export interface OpportunityFilterResult {
  potenzialeOpportunita: boolean;
  motivazione: string;
  motivi: string[];
  dettagli: OpportunityFilterDetails;
}

// ============================================================================
// FUNZIONI DI SUPPORTO INTERNE
// ============================================================================

/**
 * Calcola la media del True Range delle ultime N candele per misurare
 * la volatilità di riferimento di breve-medio periodo.
 */
function calculateHistoricalAverageTrueRange(
  candles: CandleData[],
  lookback: number = ATR_LOOKBACK_PERIOD
): number | null {
  if (!candles || candles.length < 2) {
    return null;
  }

  const sampleCandles = candles.slice(-Math.max(lookback + 1, 2));
  const trueRanges: number[] = [];

  for (let i = 1; i < sampleCandles.length; i++) {
    const current = sampleCandles[i];
    const previous = sampleCandles[i - 1];

    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length === 0) return null;

  const sum = trueRanges.reduce((acc, val) => acc + val, 0);
  return Number((sum / trueRanges.length).toFixed(2));
}

// ============================================================================
// FUNZIONE PRINCIPALE: FILTRO OPPORTUNITÀ
// ============================================================================

/**
 * Valuta in modo deterministico e rule-based (senza chiamare AI) se la situazione
 * attuale del mercato presenta una potenziale opportunità operativa.
 *
 * RAFFORZAMENTO CONCORRENTE:
 * Richiede che almeno 2 delle seguenti 3 condizioni siano vere contemporaneamente:
 * 1. Rottura di Supporto o Resistenza con chiusura oltre il livello
 * 2. RSI che esce dalla fascia neutrale 40-60 (ipercomprato/ipervenduto o forte momentum)
 * 3. ATR che aumenta significativamente rispetto alla media delle ultime 20 candele (espansione di volatilità)
 *
 * @param indicators Indicatori tecnici calcolati o oggetto di input
 * @param candles (Opzionale) Ultime candele storiche ordinate cronologicamente
 * @returns OpportunityFilterResult con esito booleano, motivazione testuale e dettagli
 */
export function checkPotentialOpportunity(
  indicators: TechnicalIndicatorsSummary | OpportunityFilterInput,
  candles?: CandleData[]
): OpportunityFilterResult {
  const currentPrice = indicators.currentPrice;
  const rsi14 = indicators.rsi14 ?? null;
  const atr14 = indicators.atr14 ?? null;
  const supports = indicators.supports ?? [];
  const resistances = indicators.resistances ?? [];
  const ema20 = indicators.ema20 ?? null;
  const ema50 = indicators.ema50 ?? null;

  // Risoluzione candele (passate come secondo argomento o all'interno dell'oggetto input)
  const candleList = candles ?? (indicators as OpportunityFilterInput).candles ?? [];

  const motivi: string[] = [];

  let breakoutResistenza = false;
  let breakoutSupporto = false;
  let livelloRotto: number | null = null;
  let tipoBreakout: "resistenza" | "supporto" | null = null;

  // --------------------------------------------------------------------------
  // 1. CONDIZIONE 1: ROTTURA SUPPORTO / RESISTENZA (BREAKOUT)
  // --------------------------------------------------------------------------
  if (candleList.length >= 2) {
    const lastCandle = candleList[candleList.length - 1];
    const prevCandle = candleList[candleList.length - 2];

    // Verifica rottura resistenze (almeno una tra R1, R2)
    for (const res of resistances) {
      const margin = res * BREAKOUT_CONFIRMATION_MARGIN;
      const brokenAbove =
        lastCandle.close > res + margin && prevCandle.close <= res + margin;

      if (brokenAbove) {
        breakoutResistenza = true;
        livelloRotto = res;
        tipoBreakout = "resistenza";
        motivi.push(
          `Rottura rialzista della resistenza a $${res.toFixed(2)} con chiusura a $${lastCandle.close.toFixed(2)}`
        );
        break;
      }
    }

    // Verifica rottura supporti (almeno uno tra S1, S2)
    for (const sup of supports) {
      const margin = sup * BREAKOUT_CONFIRMATION_MARGIN;
      const brokenBelow =
        lastCandle.close < sup - margin && prevCandle.close >= sup - margin;

      if (brokenBelow) {
        breakoutSupporto = true;
        livelloRotto = sup;
        tipoBreakout = "supporto";
        motivi.push(
          `Rottura ribassista del supporto a $${sup.toFixed(2)} con chiusura a $${lastCandle.close.toFixed(2)}`
        );
        break;
      }
    }
  } else {
    // Fallback se abbiamo solo i livelli e il currentPrice
    const nearestRes = resistances.length > 0 ? resistances[0] : null;
    const nearestSup = supports.length > 0 ? supports[0] : null;

    if (nearestRes !== null && currentPrice > nearestRes) {
      breakoutResistenza = true;
      livelloRotto = nearestRes;
      tipoBreakout = "resistenza";
      motivi.push(
        `Prezzo attuale ($${currentPrice.toFixed(2)}) posizionato oltre la resistenza chiave a $${nearestRes.toFixed(2)}`
      );
    } else if (nearestSup !== null && currentPrice < nearestSup) {
      breakoutSupporto = true;
      livelloRotto = nearestSup;
      tipoBreakout = "supporto";
      motivi.push(
        `Prezzo attuale ($${currentPrice.toFixed(2)}) posizionato sotto il supporto chiave a $${nearestSup.toFixed(2)}`
      );
    }
  }

  const condizioneBreakout = breakoutResistenza || breakoutSupporto;

  // --------------------------------------------------------------------------
  // 2. CONDIZIONE 2: RSI CHE ESCE DALLA FASCIA 40-60
  // --------------------------------------------------------------------------
  let rsiUscitaFascia = false;
  let rsiStato: "ipercomprato" | "ipervenduto" | "neutrale" = "neutrale";

  if (rsi14 !== null && !isNaN(rsi14)) {
    if (rsi14 >= RSI_EXTREME_OVERBOUGHT) {
      rsiUscitaFascia = true;
      rsiStato = "ipercomprato";
      motivi.push(
        `RSI a ${rsi14.toFixed(1)} in forte ipercomprato (>= ${RSI_EXTREME_OVERBOUGHT})`
      );
    } else if (rsi14 > RSI_UPPER_THRESHOLD) {
      rsiUscitaFascia = true;
      rsiStato = "ipercomprato";
      motivi.push(
        `RSI a ${rsi14.toFixed(1)} uscito al rialzo dalla fascia neutrale (> ${RSI_UPPER_THRESHOLD})`
      );
    } else if (rsi14 <= RSI_EXTREME_OVERSOLD) {
      rsiUscitaFascia = true;
      rsiStato = "ipervenduto";
      motivi.push(
        `RSI a ${rsi14.toFixed(1)} in forte ipervenduto (<= ${RSI_EXTREME_OVERSOLD})`
      );
    } else if (rsi14 < RSI_LOWER_THRESHOLD) {
      rsiUscitaFascia = true;
      rsiStato = "ipervenduto";
      motivi.push(
        `RSI a ${rsi14.toFixed(1)} uscito al ribasso dalla fascia neutrale (< ${RSI_LOWER_THRESHOLD})`
      );
    }
  }

  const condizioneRsi = rsiUscitaFascia;

  // --------------------------------------------------------------------------
  // 3. CONDIZIONE 3: ATR & ESPANSIONE DI VOLATILITÀ RISPETTO ALLE ULTIME 20 CANDELE
  // --------------------------------------------------------------------------
  let atrEspansione = false;
  let atrMediaStorica: number | null = null;
  let atrIncrementoPercentuale: number | null = null;

  if (candleList.length >= 2) {
    atrMediaStorica = calculateHistoricalAverageTrueRange(
      candleList,
      ATR_LOOKBACK_PERIOD
    );
  }

  const effectiveAtr = atr14 ?? (candleList.length >= 2 ? atrMediaStorica : null);

  if (effectiveAtr !== null && atrMediaStorica !== null && atrMediaStorica > 0) {
    const ratio = effectiveAtr / atrMediaStorica;
    atrIncrementoPercentuale = Number(((ratio - 1) * 100).toFixed(1));

    if (ratio >= ATR_EXPANSION_MULTIPLIER) {
      atrEspansione = true;
      motivi.push(
        `Espansione di volatilità: ATR ($${effectiveAtr.toFixed(2)}) +${atrIncrementoPercentuale}% vs media a ${ATR_LOOKBACK_PERIOD} periodi ($${atrMediaStorica.toFixed(2)})`
      );
    }
  }

  const condizioneAtr = atrEspansione;

  // --------------------------------------------------------------------------
  // 4. VALUTAZIONE TREND EMA
  // --------------------------------------------------------------------------
  let trendEma: "bullish" | "bearish" | "neutral" = "neutral";
  if (ema20 !== null && ema50 !== null) {
    if (ema20 > ema50 && currentPrice >= ema20) {
      trendEma = "bullish";
    } else if (ema20 < ema50 && currentPrice <= ema20) {
      trendEma = "bearish";
    }
  }

  // --------------------------------------------------------------------------
  // 5. DETERMINAZIONE OPPORTUNITÀ: ALMENO 2 CONDIZIONI SU 3 CONTEMPORANEE
  // --------------------------------------------------------------------------
  const condizioniSoddisfatte = [
    condizioneBreakout,
    condizioneRsi,
    condizioneAtr,
  ].filter(Boolean).length;

  const potenzialeOpportunita = condizioniSoddisfatte >= MIN_REQUIRED_CONDITIONS;

  let motivazione: string;

  if (potenzialeOpportunita) {
    motivazione = `Potenziale opportunità confermata (${condizioniSoddisfatte}/3 condizioni contemporanee): ${motivi.join("; ")}.`;
  } else if (condizioniSoddisfatte === 1) {
    motivazione = `Segnale isolato non confermato (1/3 condizioni: ${motivi.join("; ")}). Richieste almeno ${MIN_REQUIRED_CONDITIONS} condizioni simultanee (Breakout, RSI, Espansione ATR).`;
  } else {
    motivazione =
      "Nessuna opportunità rilevata (0/3 condizioni). Il mercato è in consolidamento nei livelli chiave con RSI e volatilità nella norma.";
  }

  return {
    potenzialeOpportunita,
    motivazione,
    motivi,
    dettagli: {
      breakoutResistenza,
      breakoutSupporto,
      livelloRotto,
      tipoBreakout,
      rsiUscitaFascia,
      rsiValore: rsi14,
      rsiStato,
      atrEspansione,
      atrAttuale: effectiveAtr,
      atrMediaStorica,
      atrIncrementoPercentuale,
      trendEma,
      condizioniSoddisfatte,
      condizioniMinimeRichieste: MIN_REQUIRED_CONDITIONS,
    },
  };
}

// Alias esportati per flessibilità di utilizzo
export const filterOpportunity = checkPotentialOpportunity;
export const evaluateOpportunity = checkPotentialOpportunity;
export default checkPotentialOpportunity;
