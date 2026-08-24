import { getLastCheckLog } from "@/lib/kv";
import { StatusDashboard } from "./StatusDashboard";

export const dynamic = "force-dynamic";

export default async function StatusPage() {
  const lastCheckLog = await getLastCheckLog();

  return (
    <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto w-full">
      <StatusDashboard initialLog={lastCheckLog} />
    </main>
  );
}
