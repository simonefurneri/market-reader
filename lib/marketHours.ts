/**
 * Calcola se il mercato forex/metalli (XAU/USD) è attualmente aperto o chiuso.
 *
 * Orari standard di mercato (New York Time - America/New_York):
 * - Apertura: Domenica alle 17:00 NY time
 * - Chiusura: Venerdì alle 17:00 NY time
 * - Chiuso nel weekend: Da Venerdì 17:00 a Domenica 17:00 NY time
 * - Chiuso/bassa liquidità durante il rollover giornaliero: Lunedì-Giovedì 17:00 - 18:00 NY time
 */
export interface MarketStatus {
  isOpen: boolean;
  isClosed: boolean;
  dayOfWeekNY: string;
  hourNY: number;
  minuteNY: number;
  message: string;
}

export function getMarketHoursStatus(date: Date = new Date()): MarketStatus {
  // Otteniamo componenti di data e ora nel fuso orario di New York
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  let dayOfWeekNY = "Mon";
  let hourNY = 0;
  let minuteNY = 0;

  for (const part of parts) {
    if (part.type === "weekday") dayOfWeekNY = part.value;
    if (part.type === "hour") hourNY = parseInt(part.value, 10);
    if (part.type === "minute") minuteNY = parseInt(part.value, 10);
  }

  // Correzione per eventuale formato "24" restituito da alcuni ambienti
  if (hourNY === 24) hourNY = 0;

  let isOpen = true;
  let message = "Mercato aperto (Sessione attiva)";

  if (dayOfWeekNY === "Sat") {
    // Sabato: tutto il giorno chiuso
    isOpen = false;
    message = "Mercato chiuso (Weekend)";
  } else if (dayOfWeekNY === "Sun") {
    // Domenica: chiuso prima delle 17:00 NY time
    if (hourNY < 17) {
      isOpen = false;
      message = "Mercato chiuso (Riapertura Domenica alle 17:00 NY / 23:00 CET)";
    } else {
      isOpen = true;
      message = "Mercato aperto (Apertura sessione asiatica / domenica sera NY)";
    }
  } else if (dayOfWeekNY === "Fri") {
    // Venerdì: aperto fino alle 17:00 NY time
    if (hourNY >= 17) {
      isOpen = false;
      message = "Mercato chiuso (Chiusura weekend dalle 17:00 NY)";
    } else {
      isOpen = true;
      message = "Mercato aperto (Sessione del venerdì)";
    }
  } else {
    // Lunedì, Martedì, Mercoledì, Giovedì
    // Pausa tecnica giornaliera / rollover tra le 17:00 e le 18:00 NY time
    if (hourNY === 17) {
      isOpen = false;
      message = "Mercato in pausa rollover giornaliero (17:00 - 18:00 NY)";
    } else {
      isOpen = true;
      message = "Mercato aperto 24h";
    }
  }

  return {
    isOpen,
    isClosed: !isOpen,
    dayOfWeekNY,
    hourNY,
    minuteNY,
    message,
  };
}

/**
 * Ritorna un semplice booleano: true se il mercato è aperto, false se è chiuso.
 */
export function isMarketOpen(date: Date = new Date()): boolean {
  return getMarketHoursStatus(date).isOpen;
}
