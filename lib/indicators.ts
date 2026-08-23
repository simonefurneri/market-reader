import { EMA, RSI, ATR } from "technicalindicators";
import { CandleData, TechnicalIndicatorsSummary } from "@/lib/types";

/**
 * Trova i livelli di supporto e resistenza più rilevanti tra i massimi e minimi locali.
 *
 * @param candles Array di candele ordinate cronologicamente
 * @param currentPrice Prezzo di chiusura corrente
 * @param atr Valore medio di volatilità (ATR) per il clustering dei livelli
 * @returns Oggetto con i 2 supporti (S1, S2) e le 2 resistenze (R1, R2) più rilevanti
 */
function calculateSupportResistanceLevels(
  candles: CandleData[],
  currentPrice: number,
  atr: number
): { supports: number[]; resistances: number[] } {
  if (candles.length < 5) {
    return { supports: [], resistances: [] };
  }

  const pivotHighs: number[] = [];
  const pivotLows: number[] = [];

  // Finestra di swing (2 candele a sinistra e 2 a destra per identificare i pivot locali)
  const windowSize = 2;

  for (let i = windowSize; i < candles.length - windowSize; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    let isHigh = true;
    let isLow = true;

    for (let j = i - windowSize; j <= i + windowSize; j++) {
      if (j === i) continue;
      if (candles[j].high > currentHigh) isHigh = false;
      if (candles[j].low < currentLow) isLow = false;
    }

    if (isHigh) pivotHighs.push(currentHigh);
    if (isLow) pivotLows.push(currentLow);
  }

  // Include anche il massimo e minimo assoluto delle 100 candele come riferimenti chiave
  const absoluteHigh = Math.max(...candles.map((c) => c.high));
  const absoluteLow = Math.min(...candles.map((c) => c.low));
  if (!pivotHighs.includes(absoluteHigh)) pivotHighs.push(absoluteHigh);
  if (!pivotLows.includes(absoluteLow)) pivotLows.push(absoluteLow);

  // Soglia di raggruppamento (cluster) per evitare livelli quasi identici (es. 0.3 * ATR oppure 0.15% del prezzo)
  const clusterThreshold = atr > 0 ? atr * 0.4 : currentPrice * 0.0015;

  const clusterLevels = (levels: number[]): number[] => {
    const sorted = [...levels].sort((a, b) => a - b);
    const clustered: number[] = [];

    for (const level of sorted) {
      if (clustered.length === 0) {
        clustered.push(level);
      } else {
        const last = clustered[clustered.length - 1];
        if (Math.abs(level - last) > clusterThreshold) {
          clustered.push(level);
        } else {
          // Media ponderata/aggiornata del cluster
          clustered[clustered.length - 1] = Number(((last + level) / 2).toFixed(2));
        }
      }
    }
    return clustered;
  };

  // Separa i livelli in Resistenze (> currentPrice) e Supporti (< currentPrice)
  const candidateResistances = clusterLevels(pivotHighs.filter((p) => p > currentPrice));
  const candidateSupports = clusterLevels(pivotLows.filter((p) => p < currentPrice));

  // Le 2 resistenze più vicine al prezzo corrente (R1 = più vicina, R2 = successiva)
  let resistances: number[] = candidateResistances
    .sort((a, b) => a - b) // Ordine crescente (più vicina prima)
    .slice(0, 2);

  // Se non ci sono 2 livelli sopra il prezzo corrente, prendi i 2 massimi più alti
  if (resistances.length < 2) {
    const allHighsClustered = clusterLevels(pivotHighs).sort((a, b) => b - a);
    resistances = allHighsClustered.slice(0, 2).sort((a, b) => a - b);
  }

  // I 2 supporti più vicini al prezzo corrente (S1 = più vicino, S2 = successivo inferiore)
  let supports: number[] = candidateSupports
    .sort((a, b) => b - a) // Ordine decrescente (più vicino prima)
    .slice(0, 2);

  // Se non ci sono 2 livelli sotto il prezzo corrente, prendi i 2 minimi più bassi
  if (supports.length < 2) {
    const allLowsClustered = clusterLevels(pivotLows).sort((a, b) => a - b);
    supports = allLowsClustered.slice(0, 2).sort((a, b) => b - a);
  }

  return {
    supports: supports.map((s) => Number(s.toFixed(2))),
    resistances: resistances.map((r) => Number(r.toFixed(2))),
  };
}

/**
 * Calcola gli indicatori tecnici (EMA 20, EMA 50, RSI 14, ATR 14, Supporti e Resistenze)
 * a partire dai dati delle candele e genera un riassunto strutturato pronto per un prompt AI.
 *
 * @param candles Array di candele (minimo 50 candele per calcolare l'EMA a 50 periodi)
 * @returns TechnicalIndicatorsSummary con tutti i valori e il testo pronto per l'AI
 */
export function calculateTechnicalIndicators(
  candles: CandleData[]
): TechnicalIndicatorsSummary {
  if (!candles || candles.length === 0) {
    throw new Error("Impossibile calcolare gli indicatori: array candele vuoto");
  }

  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);

  const currentPrice = Number(closes[closes.length - 1].toFixed(2));

  // 1. EMA 20 periodi
  const ema20Array = EMA.calculate({ period: 20, values: closes });
  const rawEma20 = ema20Array.length > 0 ? ema20Array[ema20Array.length - 1] : null;
  const ema20 = rawEma20 !== null ? Number(rawEma20.toFixed(2)) : null;

  // 2. EMA 50 periodi
  const ema50Array = EMA.calculate({ period: 50, values: closes });
  const rawEma50 = ema50Array.length > 0 ? ema50Array[ema50Array.length - 1] : null;
  const ema50 = rawEma50 !== null ? Number(rawEma50.toFixed(2)) : null;

  // Valutazione trend EMA
  let emaTrend: "bullish" | "bearish" | "neutral" = "neutral";
  if (ema20 !== null && ema50 !== null) {
    if (ema20 > ema50 && currentPrice >= ema20) {
      emaTrend = "bullish";
    } else if (ema20 < ema50 && currentPrice <= ema20) {
      emaTrend = "bearish";
    }
  }

  // 3. RSI 14 periodi
  const rsiArray = RSI.calculate({ period: 14, values: closes });
  const rawRsi = rsiArray.length > 0 ? rsiArray[rsiArray.length - 1] : null;
  const rsi14 = rawRsi !== null ? Number(rawRsi.toFixed(2)) : null;

  // Valutazione condizione RSI
  let rsiCondition: "oversold" | "overbought" | "neutral" = "neutral";
  if (rsi14 !== null) {
    if (rsi14 >= 70) rsiCondition = "overbought";
    else if (rsi14 <= 30) rsiCondition = "oversold";
  }

  // 4. ATR 14 periodi
  const atrArray = ATR.calculate({
    period: 14,
    high: highs,
    low: lows,
    close: closes,
  });
  const rawAtr = atrArray.length > 0 ? atrArray[atrArray.length - 1] : null;
  const atr14 = rawAtr !== null ? Number(rawAtr.toFixed(2)) : null;

  // 5. Supporti e Resistenze più rilevanti
  const { supports, resistances } = calculateSupportResistanceLevels(
    candles,
    currentPrice,
    atr14 ?? 0
  );

  // 6. Generazione del testo formattato pronto per prompt AI
  const promptSummary = `
### DATI DI MERCATO & INDICATORI TECNICI (Timeframe 15m)
- **Prezzo Attuale (Close)**: $${currentPrice.toFixed(2)}
- **EMA 20**: ${ema20 !== null ? `$${ema20.toFixed(2)}` : "Dati insufficienti"}
- **EMA 50**: ${ema50 !== null ? `$${ema50.toFixed(2)}` : "Dati insufficienti"}
- **Trend EMA (20 vs 50)**: ${emaTrend.toUpperCase()} ${
    ema20 !== null && ema50 !== null
      ? `(EMA20 ${ema20 > ema50 ? ">" : "<"} EMA50)`
      : ""
  }
- **RSI (14)**: ${rsi14 !== null ? `${rsi14.toFixed(2)} (${rsiCondition})` : "N/D"}
- **ATR (14 - Volatilità media)**: ${atr14 !== null ? `$${atr14.toFixed(2)}` : "N/D"}
- **Livelli Chiave di Resistenza**:
  - R1 (Prima Resistenza): ${resistances[0] ? `$${resistances[0].toFixed(2)}` : "N/D"}
  - R2 (Seconda Resistenza): ${resistances[1] ? `$${resistances[1].toFixed(2)}` : "N/D"}
- **Livelli Chiave di Supporto**:
  - S1 (Primo Supporto): ${supports[0] ? `$${supports[0].toFixed(2)}` : "N/D"}
  - S2 (Secondo Supporto): ${supports[1] ? `$${supports[1].toFixed(2)}` : "N/D"}
`.trim();

  return {
    currentPrice,
    ema20,
    ema50,
    emaTrend,
    rsi14,
    rsiCondition,
    atr14,
    supports,
    resistances,
    promptSummary,
  };
}

// Alias esportato per compatibilità
export const calculateIndicators = calculateTechnicalIndicators;
