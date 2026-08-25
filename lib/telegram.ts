/**
 * Helper per l'invio di notifiche e alert operativi al bot Telegram.
 */

export interface TelegramAlertPayload {
  symbol?: string;
  trend: string;
  forza_trend?: string;
  volatilita?: string;
  conferma_trend?: string;
  trend_1h?: string;
  livelli_chiave?: string[];
  scenario_probabile?: string;
  motivi_filtro?: string[];
  entry_price?: string | number | null;
  stop_loss?: string | number | null;
  take_profit?: string | number | null;
  rischio?: string | null;
  currentPrice?: number;
  appUrl?: string;
}

/**
 * Converte caratteri HTML speciali per evitare errori nel parse_mode HTML di Telegram
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Formatta e invia un messaggio di notifica opportunità a Telegram.
 */
export async function sendTelegramMarketAlert(
  payload: TelegramAlertPayload
): Promise<{ success: boolean; messageId?: number; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    return {
      success: false,
      error:
        "Variabili TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID non configurate nelle variabili d'ambiente.",
    };
  }

  const appUrl =
    payload.appUrl ||
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const symbol = payload.symbol || "XAU/USD";
  const isForex = (payload.currentPrice ?? 0) < 20;
  const pricePrefix = isForex ? "" : "$";
  const decimals = isForex ? 4 : 2;

  const trendEmoji =
    payload.trend.toLowerCase() === "rialzista"
      ? "🟢 <b>RIALZISTA (BULLISH)</b>"
      : payload.trend.toLowerCase() === "ribassista"
      ? "🔴 <b>RIBASSISTA (BEARISH)</b>"
      : "🟡 <b>LATERALE / CONSOLIDAMENTO</b>";

  let message = `🚨 <b>MARKET ALERT - ${escapeHtml(symbol)} (15M)</b> 🚨\n\n`;
  message += `📈 <b>Trend 15M:</b> ${trendEmoji}\n`;

  if (payload.conferma_trend || payload.trend_1h) {
    const cTrend = payload.conferma_trend || "concorde";
    const cEmoji = cTrend.toLowerCase().includes("concorde") ? "✅" : "⚠️";
    message += `${cEmoji} <b>Trend 1H:</b> ${escapeHtml(cTrend.toUpperCase())}${
      payload.trend_1h ? ` (${escapeHtml(payload.trend_1h.toUpperCase())})` : ""
    }\n`;
  }

  if (payload.forza_trend) {
    message += `💪 <b>Forza Trend:</b> ${escapeHtml(payload.forza_trend.toUpperCase())}\n`;
  }
  if (payload.volatilita) {
    message += `⚡ <b>Volatilità:</b> ${escapeHtml(payload.volatilita.toUpperCase())}\n`;
  }
  if (payload.currentPrice !== undefined) {
    message += `💵 <b>Prezzo Attuale:</b> ${pricePrefix}${payload.currentPrice.toFixed(decimals)}\n`;
  }

  message += `\n`;

  // Motivazione / Segnali rilevati dal filtro
  if (payload.motivi_filtro && payload.motivi_filtro.length > 0) {
    message += `🎯 <b>Fattori Tecnici Rilevati:</b>\n`;
    for (const motivo of payload.motivi_filtro) {
      message += `• ${escapeHtml(motivo)}\n`;
    }
    message += `\n`;
  }

  // Livelli Chiave
  if (payload.livelli_chiave && payload.livelli_chiave.length > 0) {
    message += `📊 <b>Livelli Chiave:</b>\n`;
    for (const livello of payload.livelli_chiave) {
      message += `• ${escapeHtml(livello)}\n`;
    }
    message += `\n`;
  }

  // Scenario Probabile
  if (payload.scenario_probabile) {
    message += `🧠 <b>Analisi Scenario:</b>\n${escapeHtml(payload.scenario_probabile)}\n\n`;
  }

  // Parametri operativi suggeriti
  const hasEntry = payload.entry_price !== undefined && payload.entry_price !== null;
  const hasSl = payload.stop_loss !== undefined && payload.stop_loss !== null;
  const hasTp = payload.take_profit !== undefined && payload.take_profit !== null;

  if (hasEntry || hasSl || hasTp) {
    message += `💡 <b>Parametri Operativi Indicativi:</b>\n`;
    if (hasEntry) {
      message += `• <b>Entry Price:</b> ${escapeHtml(String(payload.entry_price))}\n`;
    }
    if (hasSl) {
      message += `• <b>Stop Loss:</b> ${escapeHtml(String(payload.stop_loss))}\n`;
    }
    if (hasTp) {
      message += `• <b>Take Profit:</b> ${escapeHtml(String(payload.take_profit))}\n`;
    }
    message += `\n`;
  }

  // Nota di rischio obbligatoria
  const defaultRischio =
    "I livelli sopra indicati sono calcolati esclusivamente sui parametri tecnici e non costituiscono una sollecitazione all'investimento né garanzia di rendimento.";
  const notaRischio = payload.rischio ? payload.rischio : defaultRischio;
  message += `⚠️ <i>Nota di Rischio: ${escapeHtml(notaRischio)}</i>\n\n`;

  // Link all'app
  message += `🔗 <a href="${appUrl}"><b>Apri la Dashboard di Market Reader</b></a>`;

  try {
    const telegramUrl = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.ok) {
      console.error("Errore risposta Telegram API:", result);
      return {
        success: false,
        error: result.description || `Errore HTTP ${response.status}`,
      };
    }

    return {
      success: true,
      messageId: result.result?.message_id,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("Eccezione durante l'invio su Telegram:", errorMsg);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
