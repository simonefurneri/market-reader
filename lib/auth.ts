export const AUTH_COOKIE_NAME = "auth";
export const AUTH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 giorni in secondi

/**
 * Calcola l'hash SHA-256 di una stringa usando Web Crypto API
 * (pienamente compatibile sia con Edge Runtime di Next.js Middleware sia con Node.js).
 */
export async function getPasswordHash(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + "_market_reader_auth_salt_v1");
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Verifica se un token fornito dal cookie "auth" corrisponde all'hash della password configurata.
 */
export async function verifyAuthToken(token?: string | null): Promise<boolean> {
  if (!token) return false;
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword || appPassword.trim() === "") {
    return false;
  }
  const expectedHash = await getPasswordHash(appPassword.trim());
  return token === expectedHash;
}
