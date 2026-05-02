"use client";

import { useState } from "react";
import { Analyzer } from "@/components/Analyzer";
import { VideoSelector } from "@/components/VideoSelector";
import { StationDashboard } from "@/components/StationDashboard";
import type { VideoItem } from "@/lib/types";

type Tab = "analysis" | "stations";

export default function Home() {
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [tab, setTab] = useState<Tab>("analysis");

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 px-6 py-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            MetroEscalator{" "}
            <span className="text-zinc-500">/ Risk Analizatoru</span>
          </h1>
          <p className="text-sm text-zinc-500">
            Real vaxtda təhlükəsizlik aşkarlanması · Bakı Metrosu
          </p>
        </div>

        <nav className="flex gap-1 rounded-xl bg-zinc-900 p-1 ring-1 ring-zinc-800">
          <TabButton active={tab === "analysis"} onClick={() => setTab("analysis")}>
            Eskalator Analizi
          </TabButton>
          <TabButton active={tab === "stations"} onClick={() => setTab("stations")}>
            Stansiya İcmalı
          </TabButton>
        </nav>
      </header>

      {tab === "analysis" && (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <aside>
            <VideoSelector selected={video} onSelect={setVideo} />
          </aside>
          <section className="min-h-[80vh]">
            {video ? (
              <Analyzer video={video} />
            ) : (
              <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-3 rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800">
                <p className="text-sm text-zinc-500">
                  Analizi başlatmaq üçün soldan video seçin.
                </p>
                <p className="text-xs text-zinc-600">
                  Eskalator, platforma və giriş kamera axınlarını dəstəkləyir.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "stations" && (
        <div className="rounded-xl bg-zinc-900/30 p-6 ring-1 ring-zinc-800">
          <StationDashboard />
        </div>
      )}
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-700 text-zinc-100"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}
