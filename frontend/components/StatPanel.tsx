"use client";

import type { FrameEvent } from "@/lib/types";

interface Props {
  frame: FrameEvent | null;
  recommendAlternative: boolean;
}

export function StatPanel({ frame, recommendAlternative }: Props) {
  const items = [
    { label: "İnsanlar", value: frame?.person_count ?? 0 },
    { label: "Sıxlıq", value: frame ? `${Math.round(frame.density * 100)}%` : "—" },
    { label: "Zolaqlar", value: frame ? frame.lane_directions.map((d) => d[0].toUpperCase()).join(" ") : "—" },
    { label: "Vaxt", value: frame ? `${frame.timestamp.toFixed(1)}s` : "—" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-lg bg-zinc-900/60 px-4 py-3 ring-1 ring-zinc-800">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{it.label}</div>
            <div className="mt-1 text-xl font-semibold text-zinc-100">{String(it.value)}</div>
          </div>
        ))}
      </div>
      {recommendAlternative && (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 px-4 py-2 text-sm text-amber-200">
          Davamlı yüksək risk — alternativ eskalatoru açmağı nəzərdən keçirin.
        </div>
      )}
    </div>
  );
}
