import { NextRequest, NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Percorsi pubblici o protetti da secret dedicato esclusi dal controllo del cookie di sessione
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/check-market") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".") || // Risorse statiche (.png, .svg, .ico, etc.)
    pathname === "/favicon.ico"
  ) {
    // Se l'utente è già loggato e tenta di andare su /login, reindirizza alla home
    if (pathname === "/login") {
      const authCookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
      const isValid = await verifyAuthToken(authCookie);
      if (isValid) {
        return NextResponse.redirect(new URL("/", req.url));
      }
    }
    return NextResponse.next();
  }

  // Verifica del cookie "auth"
  const authCookie = req.cookies.get(AUTH_COOKIE_NAME)?.value;
  const isAuthenticated = await verifyAuthToken(authCookie);

  if (!isAuthenticated) {
    // Per le chiamate API non autenticate, restituiamo 401 Unauthorized
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { success: false, error: "Accesso non autorizzato. Effettua il login." },
        { status: 401 }
      );
    }

    // Per le pagine normali, reindirizziamo al login
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
