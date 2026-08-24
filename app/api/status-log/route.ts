import { NextResponse } from "next/server";
import { getLastCheckLog, getCheckHistory } from "@/lib/kv";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [log, history] = await Promise.all([
      getLastCheckLog(),
      getCheckHistory(288),
    ]);
    return NextResponse.json({ success: true, log, history });
  } catch (err) {
    console.error("[API STATUS-LOG Error]:", err);
    return NextResponse.json(
      { success: false, error: "Impossibile recuperare i log da Redis" },
      { status: 500 }
    );
  }
}

