import { NextRequest, NextResponse } from "next/server";
import { fetchCandlesWithCache } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const symbol = searchParams.get("symbol") || "XAU/USD";
    const timeframe = searchParams.get("timeframe") || "15M";
    const forceRefresh =
      searchParams.get("forceRefresh") === "true" ||
      searchParams.get("force") === "true";

    const data = await fetchCandlesWithCache({
      symbol,
      timeframe,
      outputsize: 100,
      forceRefresh,
    });

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Errore interno durante il recupero dei dati";
    const status = message.includes("Rate limit") ? 429 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

