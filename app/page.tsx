import { ChartSection } from "@/components/ChartSection";
import { AnalysisPanel } from "@/components/AnalysisPanel";

export default function Home() {
  return (
    <main className="flex-1 p-3 sm:p-5 lg:p-6 max-w-7xl mx-auto w-full flex flex-col">
      {/* 2-column responsive layout: Desktop = side-by-side, Mobile = stacked */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 sm:gap-6 min-h-[calc(100vh-6rem)]">
        {/* Left Column: Candlestick Chart */}
        <ChartSection />

        {/* Right Column (stacks below on mobile): Analysis Panel */}
        <AnalysisPanel />
      </div>
    </main>
  );
}
