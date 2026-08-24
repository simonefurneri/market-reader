import { GoogleGenAI } from "@google/genai";
import { checkPotentialOpportunity } from "@/lib/opportunityFilter";
import { getMarketHoursStatus } from "@/lib/marketHours";
import {
  CandleData,
  ExtendedMarketAnalysisResponse,
  OpportunityFilterInput,
  OpportunityFilterResult,
  TechnicalIndicatorsSummary,
} from "@/lib/types";

// ============================================================================
// SYSTEM PROMPTS: BASE & EXTENDED
// ============================================================================

const BASE_SYSTEM_PROMPT = `Sei un assistente che aiuta un trader a LEGGERE il mercato XAUUSD (Oro) su timeframe 15m, non a decidere se operare. Dato un set di indicatori tecnici, rispondi SEMPRE in questo formato JSON:
{
  "trend": "rialzista" | "ribassista" | "laterale",
  "forza_trend": "debole" | "moderata" | "forte",
  "volatilita": "bassa" | "media" | "alta",
  "livelli_chiave": ["string", "string"],
  "scenario_probabile": "string (2-3 frasi chiare, linguaggio semplice)",
  "cosa_osservare": "string (1-2 frasi su cosa monitorare dopo)",
  "mercato_chiuso": boolean
}
Non dare mai indicazioni dirette tipo 'apri long' o 'apri short'.
Non promettere risultati. Ricorda sempre che è un'analisi, non un consiglio di investimento.`;

const EXTENDED_SYSTEM_PROMPT = `Sei un assistente esperto di analisi tecnica che aiuta a LEGGERE e interpretare il mercato XAUUSD (Oro) su timeframe 15m.
Il sistema di screening algoritmico ha identificato un SEGNALE TECNICO RILEVANTE (almeno 2 condizioni tecniche soddisfatte simultaneamente tra rottura livelli, momentum RSI ed espansione ATR).

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

// Lista modelli in ordine di priorità per il piano Google AI
const FALLBACK_MODELS = [
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest",
];

const MAX_RETRIES_PER_MODEL = 2;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AnalyzeMarketOptions {
  skipGeminiIfNoSignal: boolean;
  candles?: CandleData[];
  apiKey?: string;
}

export interface AnalyzeMarketResponse extends ExtendedMarketAnalysisResponse {
  filterResult?: OpportunityFilterResult;
  modelUsed?: string | null;
}

/**
 * Funzione unificata per l'analisi di mercato:
 * 1. Applica opportunityFilter agli indicatori tecnici.
 * 2. Se NON rileva segnale E options.skipGeminiIfNoSignal è true -> restituisce null (zero token consumati).
 * 3. Se rileva segnale -> chiama Gemini con il prompt esteso (comprensivo di parametri operativi e disclaimer rischio).
 * 4. Se NON rileva segnale ma options.skipGeminiIfNoSignal è false -> chiama comunque Gemini con il prompt base (solo trend/scenario).
 *
 * @param indicators Indicatori tecnici calcolati
 * @param options Opzioni di analisi ({ skipGeminiIfNoSignal: boolean, candles?: CandleData[], apiKey?: string })
 * @returns AnalyzeMarketResponse o null se il controllo viene saltato
 */
export async function analyzeMarket(
  indicators: TechnicalIndicatorsSummary | OpportunityFilterInput,
  options: AnalyzeMarketOptions
): Promise<AnalyzeMarketResponse | null> {
  const { skipGeminiIfNoSignal, candles, apiKey: customApiKey } = options;

  // 1. Esecuzione del filtro locale deterministico
  const filterResult = checkPotentialOpportunity(indicators, candles);

  // 2. Se NON rileva segnale E skipGeminiIfNoSignal è true -> Ritorna subito null
  if (!filterResult.potenzialeOpportunita && skipGeminiIfNoSignal) {
    return null;
  }

  // Risoluzione chiave API Gemini
  const apiKey = customApiKey || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Chiave GEMINI_API_KEY mancante. Configura GEMINI_API_KEY per abilitare l'analisi AI."
    );
  }

  const marketStatus = getMarketHoursStatus();
  const isSignal = filterResult.potenzialeOpportunita;

  // 3 & 4. Scelta del prompt (Esteso con parametri operativi vs Base)
  let systemPrompt = isSignal ? EXTENDED_SYSTEM_PROMPT : BASE_SYSTEM_PROMPT;

  if (marketStatus.isClosed) {
    systemPrompt += `\n\nIMPORTANTE CONTESTO ATTUALE: Il mercato XAUUSD è attualmente CHIUSO (${marketStatus.message}). Nel campo "scenario_probabile", tieni conto che i prezzi sono fermi per la chiusura del mercato e che alla riapertura potrebbero verificarsi gap di prezzo o spread allargati. Imposta "mercato_chiuso": true nel JSON.`;
  }

  // Costruzione user prompt
  let userPrompt: string;
  const promptSummary =
    "promptSummary" in indicators && indicators.promptSummary
      ? indicators.promptSummary
      : `Prezzo attuale: $${indicators.currentPrice}
- EMA 20: ${indicators.ema20 !== undefined && indicators.ema20 !== null ? `$${indicators.ema20}` : "N/D"}
- EMA 50: ${indicators.ema50 !== undefined && indicators.ema50 !== null ? `$${indicators.ema50}` : "N/D"}
- RSI 14: ${indicators.rsi14 !== undefined && indicators.rsi14 !== null ? indicators.rsi14 : "N/D"}
- ATR 14: ${indicators.atr14 !== undefined && indicators.atr14 !== null ? `$${indicators.atr14}` : "N/D"}
- Supporti: ${indicators.supports?.length ? indicators.supports.map((s: number) => `$${s}`).join(", ") : "N/D"}
- Resistenze: ${indicators.resistances?.length ? indicators.resistances.map((r: number) => `$${r}`).join(", ") : "N/D"}`;

  if (isSignal) {
    const reasonsText = filterResult.motivi.join("\n- ");
    userPrompt = `Stato Mercato: ${marketStatus.message} (Chiuso: ${marketStatus.isClosed ? "Sì" : "No"})
Filtro Locale Segnali Rilevati (${filterResult.dettagli.condizioniSoddisfatte ?? 2}/3 condizioni soddisfatte):
- ${reasonsText}

Dati Tecnici Attuali su XAUUSD (15m):
${promptSummary}

Valuta attentamente la configurazione. Se confermi l'opportunità, suggerisci i livelli indicativi di Entry Price, Stop Loss e Take Profit inserendo l'obbligatorio testo di chiarimento nel campo "rischio".`;
  } else {
    userPrompt = `Stato Mercato: ${marketStatus.message} (Chiuso: ${marketStatus.isClosed ? "Sì" : "No"})

Analizza la seguente situazione tecnica su XAUUSD (timeframe 15m):
${promptSummary}`;
  }

  const ai = new GoogleGenAI({ apiKey });
  let parsedResult: ExtendedMarketAnalysisResponse | null = null;
  let successfulModel: string | null = null;
  const attemptErrors: string[] = [];

  // Ciclo di fallback sui modelli Gemini disponibili
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
          throw new Error(`Risposta vuota ricevuta da ${model}`);
        }

        try {
          parsedResult = JSON.parse(responseText) as ExtendedMarketAnalysisResponse;
        } catch {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsedResult = JSON.parse(jsonMatch[0]) as ExtendedMarketAnalysisResponse;
          } else {
            throw new Error("Formato JSON non valido nella risposta del modello");
          }
        }

        if (parsedResult) {
          parsedResult.mercato_chiuso = marketStatus.isClosed;
          successfulModel = model;
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

    if (parsedResult) break;
  }

  if (!parsedResult) {
    throw new Error(
      `Tutti i modelli AI disponibili sono falliti dopo molteplici tentativi. Dettagli: ${attemptErrors.slice(-3).join(" | ")}`
    );
  }

  return {
    ...parsedResult,
    filterResult,
    modelUsed: successfulModel,
  };
}
