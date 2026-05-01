"use client";

import { useState } from "react";
import { Analyzer } from "@/components/Analyzer";
import { VideoSelector } from "@/components/VideoSelector";
import type { VideoItem } from "@/lib/types";

export default function Home() {
  const [video, setVideo] = useState<VideoItem | null>(null);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 px-6 py-5">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">
            MetroEscalator <span className="text-zinc-500">/ Risk Analyzer</span>
          </h1>
          <p className="text-sm text-zinc-500">Real-time fall, counterflow and density detection.</p>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside>
          <VideoSelector selected={video} onSelect={setVideo} />
        </aside>
        <section className="min-h-[80vh]">
          {video ? (
            <Analyzer video={video} />
          ) : (
            <div className="flex h-full min-h-[60vh] items-center justify-center rounded-xl bg-zinc-900/40 ring-1 ring-zinc-800">
              <p className="text-sm text-zinc-500">Select a video on the left to begin analysis.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
