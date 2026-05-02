"use client";

import { useEffect, useState } from "react";

interface Station {
  id: string;
  name: string;
  line: 1 | 2 | 3;
  transfer?: boolean;
}

const LINE_META = {
  1: { label: "Line 1", color: "#ef4444", bg: "#450a0a" },
  2: { label: "Line 2", color: "#10b981", bg: "#052e16" },
  3: { label: "Line 3", color: "#a855f7", bg: "#3b0764" },
} as const;

const STATIONS: Station[] = [
  // Line 1 — Red
  { id: "hezi",       name: "Həzi Aslanov",      line: 1 },
  { id: "ahmedli",    name: "Ahmədli",            line: 1 },
  { id: "8noyabr",    name: "8 Noyabr",           line: 1, transfer: true },
  { id: "neftciler",  name: "Neftçilər",          line: 1, transfer: true },
  { id: "xalqlar",    name: "Xalqlar Dostluğu",   line: 1 },
  { id: "insaatci",   name: "İnşaatçılar",        line: 1, transfer: true },
  { id: "20yanvar",   name: "20 Yanvar",           line: 1 },
  { id: "herbi",      name: "Hərbi Hissə",        line: 1 },
  { id: "bakmil",     name: "Bakmil",             line: 1, transfer: true },
  { id: "ulduz",      name: "Ulduz",              line: 1 },
  { id: "koroglu",    name: "Koroğlu",            line: 1 },
  { id: "qaraqa",     name: "Qara Qarayev",       line: 1 },
  { id: "dernegul",   name: "Dərnəgül",           line: 1 },
  // Line 2 — Green
  { id: "avtovagzal", name: "Avtovağzal",         line: 2 },
  { id: "memar2",     name: "Memar Əcəmi 2",      line: 2 },
  { id: "memar1",     name: "Memar Əcəmi",        line: 2 },
  { id: "iceri",      name: "İçərişəhər",         line: 2 },
  { id: "sahil",      name: "Sahil",              line: 2 },
  { id: "28may",      name: "28 May",             line: 2, transfer: true },
  { id: "genclik",    name: "Gənclik",            line: 2 },
  { id: "neriman",    name: "Nəriman Nərimanov",  line: 2 },
  // Line 3 — Purple
  { id: "hovsan",     name: "Hövsan",             line: 3 },
  { id: "kenar",      name: "Kənar",              line: 3 },
  { id: "nizami",     name: "Nizami",             line: 3 },
  { id: "elmler",     name: "Elmlar Akademiyası", line: 3 },
  { id: "azadliq",    name: "Azadlıq Prospekti", line: 3 },
];

function initDensities(): Record<string, number> {
  const d: Record<string, number> = {};
  for (const s of STATIONS) {
    // Transfer stations start slightly busier
    d[s.id] = s.transfer ? 40 + Math.random() * 40 : 10 + Math.random() * 60;
  }
  return d;
}

function densityColor(d: number): string {
  // smooth green → yellow → orange → red spectrum
  if (d <= 33) {
    const t = d / 33;
    const r = Math.round(16 + (234 - 16) * t);
    const g = Math.round(185 - (185 - 179) * t);
    const b = Math.round(129 - (129 - 8) * t);
    return `rgb(${r},${g},${b})`;
  }
  if (d <= 66) {
    const t = (d - 33) / 33;
    const r = Math.round(234 + (249 - 234) * t);
    const g = Math.round(179 - (179 - 115) * t);
    const b = Math.round(8 + (22 - 8) * t);
    return `rgb(${r},${g},${b})`;
  }
  const t = (d - 66) / 34;
  const r = Math.round(249 - (249 - 220) * t);
  const g = Math.round(115 - 115 * t);
  const b = Math.round(22 - 22 * t);
  return `rgb(${r},${g},${b})`;
}

function densityLabel(d: number): string {
  if (d < 30) return "Low";
  if (d < 55) return "Moderate";
  if (d < 75) return "High";
  return "Critical";
}

function densityBg(d: number): string {
  const c = densityColor(d);
  return c.replace("rgb(", "rgba(").replace(")", ", 0.12)");
}

interface StationDetailProps {
  station: Station;
  density: number;
  onClose: () => void;
}

function StationDetail({ station, density, onClose }: StationDetailProps) {
  const lm = LINE_META[station.line];
  const wait = Math.round((density / 10) * 1.8);
  const rec =
    density > 75
      ? "⚠ Activate secondary escalator immediately"
      : density > 55
      ? "Monitor — consider secondary escalator"
      : "Normal operations";

  return (
    <div className="mt-4 rounded-xl bg-zinc-900 p-5 ring-1 ring-zinc-700">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-zinc-100">{station.name}</span>
            {station.transfer && (
              <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">Transfer</span>
            )}
          </div>
          <span className="text-xs" style={{ color: lm.color }}>{lm.label}</span>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          close ×
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Escalator Density", value: `${Math.round(density)}%`, color: densityColor(density) },
          { label: "Status", value: densityLabel(density), color: "#d4d4d8" },
          { label: "Est. Escalator Wait", value: `~${wait}s`, color: "#d4d4d8" },
          { label: "Recommendation", value: rec, color: density > 75 ? "#fca5a5" : "#d4d4d8" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg bg-zinc-800 p-3">
            <div className="mb-1 text-xs text-zinc-500">{label}</div>
            <div className="text-sm font-medium leading-snug" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-zinc-500">
          <span>Density</span>
          <span>{Math.round(density)}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full transition-all duration-1000"
            style={{ width: `${density}%`, background: densityColor(density) }}
          />
        </div>
      </div>
    </div>
  );
}

export function StationDashboard() {
  const [densities, setDensities] = useState<Record<string, number>>(initDensities);
  const [selected, setSelected] = useState<Station | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setDensities((prev) => {
        const next = { ...prev };
        for (const s of STATIONS) {
          const mean = s.transfer ? 55 : 40;
          const nudge = (mean - prev[s.id]) * 0.04;
          const delta = (Math.random() - 0.5) * 14 + nudge;
          next[s.id] = Math.max(2, Math.min(98, prev[s.id] + delta));
        }
        return next;
      });
    }, 2500);
    return () => clearInterval(id);
  }, []);

  const lines = ([1, 2, 3] as const).map((ln) => ({
    ...LINE_META[ln],
    line: ln,
    stations: STATIONS.filter((s) => s.line === ln),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Station Overview</h2>
          <p className="text-xs text-zinc-500">
            Baku Metro · Escalator density simulation · updates every 2.5 s
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
          {[
            { label: "Low", color: "#10b981" },
            { label: "Moderate", color: "#eab308" },
            { label: "High", color: "#f97316" },
            { label: "Critical", color: "#ef4444" },
          ].map(({ label, color }) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Lines */}
      {lines.map(({ line, label, color, stations }) => (
        <div key={line}>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: color }} />
            <span className="text-xs font-semibold tracking-wide text-zinc-400">{label}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {stations.map((s) => {
              const d = densities[s.id] ?? 50;
              const dc = densityColor(d);
              const isSelected = selected?.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected((cur) => (cur?.id === s.id ? null : s))}
                  className={`group relative rounded-xl border px-3 py-2.5 text-left transition-all duration-300 hover:scale-[1.02] hover:shadow-lg ${
                    isSelected ? "ring-2 ring-white/20" : ""
                  }`}
                  style={{
                    borderColor: dc + "55",
                    background: densityBg(d),
                  }}
                >
                  <div className="mb-1.5 flex items-start justify-between gap-1">
                    <span className="text-xs font-semibold leading-tight text-zinc-200">
                      {s.name}
                    </span>
                    <span
                      className="mt-0.5 h-2 w-2 shrink-0 rounded-full transition-colors duration-1000"
                      style={{ background: dc, boxShadow: `0 0 5px ${dc}88` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{densityLabel(d)}</span>
                    <span className="text-xs font-medium" style={{ color: dc }}>
                      {Math.round(d)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${d}%`, background: dc }}
                    />
                  </div>
                  {s.transfer && (
                    <div
                      className="absolute right-1.5 top-1.5 rounded px-1 text-[9px] font-medium text-zinc-400"
                      style={{ background: "#18181b" }}
                    >
                      ⇄
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Detail panel */}
      {selected && (
        <StationDetail
          station={selected}
          density={densities[selected.id] ?? 50}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
