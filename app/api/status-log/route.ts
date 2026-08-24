import { NextResponse } from "next/server";
import { getLastCheckLog } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const log = await getLastCheckLog();
    return NextResponse.json({ success: true, log });
  } catch (err) {
    console.error("[API STATUS-LOG Error]:", err);
    return NextResponse.json(
      { success: false, error: "Impossibile recuperare i log da Redis" },
      { status: 500 }
    );
  }
}
