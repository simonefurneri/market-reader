import { NextResponse } from "next/server";
import { getXAUUSD15mCandles } from "@/lib/marketData";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getXAUUSD15mCandles();
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Errore interno durante il recupero dei dati";
    const status = message.includes("Rate limit") ? 429 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
