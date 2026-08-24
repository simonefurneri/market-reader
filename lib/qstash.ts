import { Receiver } from "@upstash/qstash";

/**
 * Inizializza il Receiver QStash leggendo le chiavi di firma dalle variabili d'ambiente.
 */
export function getQStashReceiver(): Receiver | null {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY?.trim();
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY?.trim();

  if (!currentSigningKey || !nextSigningKey) {
    return null;
  }

  return new Receiver({
    currentSigningKey,
    nextSigningKey,
  });
}

/**
 * Verifica la firma della richiesta HTTP proveniente da Upstash QStash.
 *
 * @param signature Header Upstash-Signature inviato da QStash
 * @param body Corpo della richiesta (stringa vuota per richieste GET)
 * @param url URL della richiesta ricevuta
 * @returns true se la firma è valida, false altrimenti
 */
export async function verifyQStashSignature(
  signature: string | null | undefined,
  body: string = "",
  url?: string
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  const receiver = getQStashReceiver();
  if (!receiver) {
    console.warn(
      "[QStash Receiver] Variabili QSTASH_CURRENT_SIGNING_KEY e/o QSTASH_NEXT_SIGNING_KEY non configurate."
    );
    return false;
  }

  try {
    const isValid = await receiver.verify({
      signature,
      body,
      url,
    });
    return isValid;
  } catch (error) {
    console.warn("[QStash Receiver] Verifica della firma fallita:", error);
    return false;
  }
}
