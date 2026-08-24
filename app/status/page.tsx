import { getLastCheckLog, getCheckHistory } from "@/lib/kv";
import { StatusDashboard } from "./StatusDashboard";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const [lastCheckLog, checkHistory] = await Promise.all([
    getLastCheckLog(),
    getCheckHistory(288),
  ]);

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto w-full">
      <StatusDashboard
        initialLog={lastCheckLog}
        initialHistory={checkHistory}
      />
    </main>
  );
}

