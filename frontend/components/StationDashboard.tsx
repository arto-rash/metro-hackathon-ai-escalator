"use client";

import { useEffect, useMemo, useState } from "react";

type LineId = 1 | 2 | 3 | 4;

interface Station {
  id: string;
  name: string;
  line: LineId;
  transfer?: boolean;
}

interface SpecialEvent {
  id: string;
  name: string;
  date: string;          // YYYY-MM-DD
  allDay: boolean;
  startTime?: string;    // HH:MM
  endTime?: string;
  stationIds: string[];
  type: "high" | "low";
}

interface StationModel {
  version: number;
  model?: string;                  // e.g. "prophet" (v2)
  bins_per_day: number;
  trained_from: string;
  trained_to: string;
  forecast_from?: string;          // v2: first ds in `forecast`
  forecast_to?: string;
  forecast_horizon_days?: number;
  stations: Record<string, {
    name: string;
    p95_15min: number;
    by_dow_bin: number[][];                  // [7][96] — historical fallback
    forecast?: Record<string, number[]>;     // v2: YYYY-MM-DD → [96] Prophet yhat
  }>;
}

const LINE_META: Record<LineId, { label: string; color: string }> = {
  1: { label: "Qırmızı xətt",        color: "#ef4444" },
  2: { label: "Yaşıl xətt",          color: "#10b981" },
  3: { label: "Açıq yaşıl xətt",     color: "#84cc16" },
  4: { label: "Bənövşəyi xətt",      color: "#a855f7" },
};

const STATIONS: Station[] = [
  // Qırmızı (Line 1)
  { id: "iceri",      name: "İçərişəhər",         line: 1 },
  { id: "sahil",      name: "Sahil",              line: 1 },
  { id: "28may",      name: "28 May",             line: 1, transfer: true },
  { id: "genclik",    name: "Gənclik",            line: 1 },
  { id: "neriman",    name: "Nəriman Nərimanov",  line: 1 },
  { id: "bakmil",     name: "Bakmil",             line: 1, transfer: true },
  { id: "ulduz",      name: "Ulduz",              line: 1 },
  { id: "koroglu",    name: "Koroğlu",            line: 1 },
  { id: "qaraqa",     name: "Qara Qarayev",       line: 1 },
  { id: "neftciler",  name: "Neftçilər",          line: 1, transfer: true },
  { id: "xalqlar",    name: "Xalqlar Dostluğu",   line: 1 },
  { id: "ahmedli",    name: "Əhmədli",            line: 1 },
  { id: "hezi",       name: "Həzi Aslanov",       line: 1 },
  // Yaşıl (Line 2)
  { id: "nizami",     name: "Nizami",             line: 2 },
  { id: "elmler",     name: "Elmlər Akademiyası", line: 2 },
  { id: "insaatci",   name: "İnşaatçılar",        line: 2, transfer: true },
  { id: "20yanvar",   name: "20 Yanvar",          line: 2 },
  { id: "memar",      name: "Memar Əcəmi",        line: 2, transfer: true },
  { id: "nesimi",     name: "Nəsimi",             line: 2 },
  { id: "azadliq",    name: "Azadlıq Prospekti",  line: 2 },
  { id: "dernegul",   name: "Dərnəgül",           line: 2 },
  // Açıq yaşıl (Line 3)
  { id: "xetai",      name: "Şah İsmayıl Xətai",  line: 3, transfer: true },
  { id: "cefer",      name: "Cəfər Cabbarlı",     line: 3, transfer: true },
  // Bənövşəyi (Line 4)
  { id: "avtovagzal", name: "Avtovağzal",         line: 4 },
  { id: "memar2",     name: "Memar Əcəmi-2",      line: 4, transfer: true },
  { id: "8noyabr",    name: "8 Noyabr",           line: 4 },
  { id: "xocesen",    name: "Xocəsən",            line: 4 },
];

const STATION_BY_ID: Record<string, Station> = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

// ── Density utilities ──────────────────────────────────────────────────────

function densityColor(d: number): string {
  if (d <= 33) {
    const t = d / 33;
    return `rgb(${Math.round(16 + (234 - 16) * t)},${Math.round(185 - (185 - 179) * t)},${Math.round(129 - (129 - 8) * t)})`;
  }
  if (d <= 66) {
    const t = (d - 33) / 33;
    return `rgb(${Math.round(234 + (249 - 234) * t)},${Math.round(179 - (179 - 115) * t)},${Math.round(8 + (22 - 8) * t)})`;
  }
  const t = (d - 66) / 34;
  return `rgb(${Math.round(249 - (249 - 220) * t)},${Math.round(115 - 115 * t)},${Math.round(22 - 22 * t)})`;
}

function densityBg(d: number) {
  return densityColor(d).replace("rgb(", "rgba(").replace(")", ", 0.12)");
}

function densityLabel(d: number) {
  if (d < 30) return "Aşağı";
  if (d < 55) return "Orta";
  if (d < 75) return "Yüksək";
  return "Kritik";
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function fmtDate(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function fmtTime(d: Date) { return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

/** Look up Prophet's forecast for (station, date, hh:mm); fall back to historical
 * dow×bin average for dates outside the forecast horizon. Result is normalised
 * to a 0..99 density via the per-station p95. */
function trainedPassengers(stationId: string, dt: Date, model: StationModel | null): number {
  if (!model) return 0;
  const s = model.stations[stationId];
  if (!s) return 0;
  const bin = Math.floor((dt.getHours() * 60 + dt.getMinutes()) / 15); // 0..95
  const ymd = fmtDate(dt);
  const fcRow = s.forecast?.[ymd];
  if (fcRow && bin < fcRow.length) return fcRow[bin] ?? 0;
  const dow = dt.getDay();                                             // Sunday=0..Saturday=6
  return s.by_dow_bin[dow]?.[bin] ?? 0;
}

function trainedDensity(stationId: string, dt: Date, model: StationModel | null): number {
  if (!model) return 25;
  const s = model.stations[stationId];
  if (!s) return 25;
  const avg = trainedPassengers(stationId, dt, model);
  const ref = s.p95_15min || 1;
  // p95 → 95 density; values above p95 push toward 99.
  return Math.max(2, Math.min(99, Math.round((avg / ref) * 95)));
}

// Stable 0..1 hash so each (event, station) gets its own spike fingerprint
// instead of every flagged station landing on the same number.
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function eventMatches(e: SpecialEvent, stationId: string, dt: Date): boolean {
  if (e.date !== fmtDate(dt)) return false;
  if (!e.stationIds.includes(stationId)) return false;
  if (e.allDay) return true;
  const hm = fmtTime(dt);
  if (e.startTime && hm < e.startTime) return false;
  if (e.endTime && hm > e.endTime) return false;
  return true;
}

/** Model-driven event boost. High events push density into the 80–99% band by
 * anchoring above the station's *own* historical peak (from by_dow_bin) and
 * modulating by time-of-day, transfer status, and a per-event seed — instead
 * of a flat ×2 multiplier that under-shoots quiet stations. */
function applyEventBoost(
  baseDensity: number,
  stationId: string,
  dt: Date,
  model: StationModel | null,
  event: SpecialEvent,
): number {
  if (event.type === "low") {
    const seed = hashSeed(event.id + stationId);
    const cut = 0.20 + seed * 0.16; // 0.20..0.36, stable per (event, station)
    return Math.max(6, Math.min(40, Math.round(baseDensity * cut)));
  }

  // Anchor: the station's own peak density on this weekday (relative to its p95).
  let peakDensity = 70;
  const station = model?.stations[stationId];
  if (station) {
    const dowRow = station.by_dow_bin[dt.getDay()] ?? [];
    const dailyPeak = dowRow.length ? Math.max(...dowRow) : station.p95_15min;
    const ref = station.p95_15min || 1;
    peakDensity = Math.max(55, Math.min(99, (dailyPeak / ref) * 95));
  }

  // Rush windows surge harder; deep night softens but still clears the 80 floor.
  const hour = dt.getHours();
  let timeFactor = 0.82;
  if ((hour >= 7 && hour <= 10) || (hour >= 17 && hour <= 20)) timeFactor = 1.0;
  else if ((hour >= 11 && hour <= 16) || (hour >= 21 && hour <= 22)) timeFactor = 0.92;
  else if (hour >= 23 || hour <= 5) timeFactor = 0.72;

  const transferBonus = STATION_BY_ID[stationId]?.transfer ? 1.04 : 1.0;
  const variation = 0.92 + hashSeed(event.id + stationId) * 0.08; // 0.92..1.00

  // Climb the headroom above the station's natural peak toward saturation.
  const headroom = 99 - peakDensity;
  const target = peakDensity + headroom * timeFactor * transferBonus * variation;

  // Floor at 80 — flagged "high traffic" days should always read at least Yüksək.
  const blended = Math.max(target, baseDensity);
  return Math.max(80, Math.min(99, Math.round(blended)));
}

function forecastDensity(
  stationId: string,
  dt: Date,
  model: StationModel | null,
  events: SpecialEvent[],
): number {
  let d = trainedDensity(stationId, dt, model);
  for (const e of events) {
    if (!eventMatches(e, stationId, dt)) continue;
    d = applyEventBoost(d, stationId, dt, model, e);
  }
  return Math.max(2, Math.min(99, Math.round(d)));
}

/** Passenger count consistent with `forecastDensity` — scales the trained
 * 15-min figure by the same density ratio the boost produced, so the detail
 * card doesn't show a baseline number next to a saturated density bar. */
function forecastPassengers(
  stationId: string,
  dt: Date,
  model: StationModel | null,
  events: SpecialEvent[],
): number {
  const basePax = trainedPassengers(stationId, dt, model);
  if (!model) return Math.round(basePax);
  const baseD = trainedDensity(stationId, dt, model);
  const boostedD = forecastDensity(stationId, dt, model, events);
  const ratio = baseD > 0 ? boostedD / baseD : 1;
  return Math.round(basePax * ratio);
}

// ── Hooks ──────────────────────────────────────────────────────────────────

function useStationModel(): StationModel | null {
  const [model, setModel] = useState<StationModel | null>(null);
  useEffect(() => {
    let cancelled = false;
    // `no-cache` revalidates with the server (304 if unchanged) — guarantees
    // the dashboard picks up a freshly retrained station_model.json without
    // serving a stale `force-cache` copy.
    fetch("/station_model.json", { cache: "no-cache" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setModel(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return model;
}

/** Live densities = trained baseline at the current real time, with light jitter (±6%). */
function useLiveDensities(model: StationModel | null) {
  const [d, setD] = useState<Record<string, number>>({});
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setD(() => {
        const next: Record<string, number> = {};
        for (const s of STATIONS) {
          const baseline = trainedDensity(s.id, now, model);
          const jitter = (Math.random() - 0.5) * 12;
          next[s.id] = Math.max(2, Math.min(99, Math.round(baseline + jitter)));
        }
        return next;
      });
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => clearInterval(id);
  }, [model]);
  return d;
}

function useEvents() {
  const [events, setEvents] = useState<SpecialEvent[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("metro_special_events");
      if (raw) setEvents(JSON.parse(raw));
    } catch {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem("metro_special_events", JSON.stringify(events)); } catch {}
  }, [events]);
  return [events, setEvents] as const;
}

// ── Main ───────────────────────────────────────────────────────────────────

type Mode = "live" | "forecast";

export function StationDashboard() {
  const [mode, setMode] = useState<Mode>("live");
  const model = useStationModel();
  const liveDensities = useLiveDensities(model);
  const [events, setEvents] = useEvents();
  const [selected, setSelected] = useState<Station | null>(null);

  const tomorrow = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d;
  }, []);
  const [forecastDate, setForecastDate] = useState<string>(fmtDate(tomorrow));
  const [forecastTime, setForecastTime] = useState<string>("08:30");

  const forecastDensities = useMemo(() => {
    const dt = new Date(`${forecastDate}T${forecastTime}:00`);
    if (isNaN(dt.getTime())) return {} as Record<string, number>;
    const r: Record<string, number> = {};
    for (const s of STATIONS) r[s.id] = forecastDensity(s.id, dt, model, events);
    return r;
  }, [forecastDate, forecastTime, events, model]);

  const densities = mode === "forecast" ? forecastDensities : liveDensities;

  const activeEvents = useMemo(() => {
    if (mode !== "forecast") return [];
    return events.filter((e) => {
      if (e.date !== forecastDate) return false;
      if (e.allDay) return true;
      if (e.startTime && forecastTime < e.startTime) return false;
      if (e.endTime && forecastTime > e.endTime) return false;
      return true;
    });
  }, [mode, events, forecastDate, forecastTime]);

  const lines = ([1, 2, 3, 4] as LineId[]).map((ln) => ({
    ...LINE_META[ln],
    line: ln,
    stations: STATIONS.filter((s) => s.line === ln),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100">Stansiya İcmalı</h2>
          <p className="text-xs text-zinc-500">
            Bakı Metrosu ·{" "}
            {mode === "live"
              ? "canlı sıxlıq · real ridership profili (15 dəq) · hər 2.5 s yenilənir"
              : `proqnoz modeli${model?.model === "prophet" ? " · Prophet (trend + həftəlik/günlük/illik mövsümlülük + bayramlar)" : ""}`}
            {model && (
              <span className="ml-1 text-zinc-600">
                · öyrətmə: {model.trained_from} → {model.trained_to}
                {model.forecast_to && ` · proqnoz: → ${model.forecast_to}`}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ModeSwitch mode={mode} onChange={setMode} />
          <div className="flex flex-wrap gap-2 text-xs text-zinc-500">
            {[
              { label: "Aşağı", color: "#10b981" },
              { label: "Orta", color: "#eab308" },
              { label: "Yüksək", color: "#f97316" },
              { label: "Kritik", color: "#ef4444" },
            ].map(({ label, color }) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Forecast controls */}
      {mode === "forecast" && (
        <div className="rounded-xl bg-zinc-900/70 p-4 ring-1 ring-zinc-800">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Proqnoz tarixi</label>
              <input
                type="date"
                value={forecastDate}
                min={fmtDate(new Date())}
                onChange={(e) => setForecastDate(e.target.value)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Vaxt</label>
              <input
                type="time"
                value={forecastTime}
                onChange={(e) => setForecastTime(e.target.value)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
              />
            </div>
            <div className="ml-auto rounded-lg bg-blue-950/40 px-3 py-1.5 text-xs text-blue-300 ring-1 ring-blue-900/60">
              Proqnoz: {new Date(`${forecastDate}T${forecastTime}:00`).toLocaleString("az-AZ", {
                weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
              })}
            </div>
          </div>

          {activeEvents.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {activeEvents.map((e) => (
                <span
                  key={e.id}
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    e.type === "high" ? "bg-rose-900/60 text-rose-200" : "bg-emerald-900/60 text-emerald-200"
                  }`}
                  title={e.stationIds.map((id) => STATION_BY_ID[id]?.name ?? id).join(", ")}
                >
                  {e.type === "high" ? "▲" : "▼"} {e.name} · {e.stationIds.length} stansiya
                </span>
              ))}
            </div>
          )}

          {!model && (
            <div className="mt-3 rounded-lg bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
              Proqnoz modeli yüklənir... (station_model.json)
            </div>
          )}
        </div>
      )}

      {/* Lines + station cards */}
      {lines.map(({ line, label, color, stations }) => (
        <div key={line}>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-3 w-3 rounded-full" style={{ background: color }} />
            <span className="text-xs font-semibold tracking-wide text-zinc-400">{label}</span>
            <span className="text-xs text-zinc-600">· {stations.length} stansiya</span>
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
                  style={{ borderColor: dc + "55", background: densityBg(d) }}
                >
                  <div className="mb-1.5 flex items-start justify-between gap-1">
                    <span className="text-xs font-semibold leading-tight text-zinc-200">{s.name}</span>
                    <span
                      className="mt-0.5 h-2 w-2 shrink-0 rounded-full transition-colors duration-1000"
                      style={{ background: dc, boxShadow: `0 0 5px ${dc}88` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{densityLabel(d)}</span>
                    <span className="text-xs font-medium" style={{ color: dc }}>{Math.round(d)}%</span>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${d}%`, background: dc }}
                    />
                  </div>
                  {s.transfer && (
                    <div className="absolute right-1.5 top-1.5 rounded bg-zinc-900 px-1 text-[9px] font-medium text-zinc-400">⇄</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {/* Detail */}
      {selected && (
        <StationDetail
          station={selected}
          density={densities[selected.id] ?? 50}
          mode={mode}
          model={model}
          events={events}
          forecastDate={mode === "forecast" ? forecastDate : null}
          forecastTime={mode === "forecast" ? forecastTime : null}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Special events */}
      <SpecialEventsPanel
        events={events}
        onAdd={(e) => setEvents((cur) => [...cur, e])}
        onRemove={(id) => setEvents((cur) => cur.filter((e) => e.id !== id))}
        defaultDate={forecastDate}
      />
    </div>
  );
}

// ── Subcomponents ──────────────────────────────────────────────────────────

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex rounded-lg bg-zinc-900 p-0.5 ring-1 ring-zinc-800">
      {(["live", "forecast"] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            mode === m ? "bg-zinc-700 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          {m === "live" ? "Canlı" : "Proqnoz"}
        </button>
      ))}
    </div>
  );
}

interface StationDetailProps {
  station: Station;
  density: number;
  mode: Mode;
  model: StationModel | null;
  events: SpecialEvent[];
  forecastDate: string | null;
  forecastTime: string | null;
  onClose: () => void;
}

function StationDetail({ station, density, mode, model, events, forecastDate, forecastTime, onClose }: StationDetailProps) {
  const lm = LINE_META[station.line];
  const wait = Math.round((density / 10) * 1.8);
  const rec =
    density > 75 ? "⚠ Ehtiyat eskalatoru dərhal işə salın"
    : density > 55 ? "Monitor — ehtiyat eskalatoru nəzərdən keçirin"
    : "Normal iş rejimi";

  // Passenger count for this 15-min slot. In forecast mode we apply the same
  // event boost as the density tile so the two readouts agree.
  const avgPax = useMemo(() => {
    if (!model) return null;
    const s = model.stations[station.id];
    if (!s) return null;
    const dt = mode === "forecast" && forecastDate && forecastTime
      ? new Date(`${forecastDate}T${forecastTime}:00`)
      : new Date();
    return mode === "forecast"
      ? forecastPassengers(station.id, dt, model, events)
      : Math.round(trainedPassengers(station.id, dt, model));
  }, [model, station.id, mode, events, forecastDate, forecastTime]);

  return (
    <div className="rounded-xl bg-zinc-900 p-5 ring-1 ring-zinc-700">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-zinc-100">{station.name}</span>
            {station.transfer && (
              <span className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">Keçid</span>
            )}
            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              mode === "forecast" ? "bg-blue-900/60 text-blue-300" : "bg-emerald-900/60 text-emerald-300"
            }`}>
              {mode === "forecast" ? "PROQNOZ" : "CANLI"}
            </span>
          </div>
          <span className="text-xs" style={{ color: lm.color }}>{lm.label}</span>
        </div>
        <button onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300">bağla ×</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Eskalator Sıxlığı", value: `${Math.round(density)}%`, color: densityColor(density) },
          { label: "Status", value: densityLabel(density), color: "#d4d4d8" },
          {
            label: "Sərnişin (15 dəq)",
            value: avgPax !== null ? `~${avgPax.toLocaleString("az-AZ")}` : "—",
            color: "#d4d4d8",
          },
          { label: "Tövsiyə", value: rec, color: density > 75 ? "#fca5a5" : "#d4d4d8" },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg bg-zinc-800 p-3">
            <div className="mb-1 text-xs text-zinc-500">{label}</div>
            <div className="text-sm font-medium leading-snug" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-zinc-500">
          <span>Sıxlıq</span>
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

interface SpecialEventsPanelProps {
  events: SpecialEvent[];
  onAdd: (e: SpecialEvent) => void;
  onRemove: (id: string) => void;
  defaultDate: string;
}

function SpecialEventsPanel({ events, onAdd, onRemove, defaultDate }: SpecialEventsPanelProps) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const sorted = useMemo(
    () => [...events].sort((a, b) => a.date.localeCompare(b.date)),
    [events],
  );

  return (
    <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-200">Xüsusi Günlər</span>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">{events.length}</span>
        </div>
        <span className="text-xs text-zinc-500">{open ? "▲ gizlət" : "▼ göstər"}</span>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-4">
          <p className="mb-3 text-xs text-zinc-500">
            Bayram, idman tədbiri, tətil və s. — proqnoz modeli bu günlərdə müvafiq stansiyalarda axını artırır və ya azaldır.
          </p>

          {sorted.length > 0 && (
            <ul className="mb-3 space-y-2">
              {sorted.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-950/60 px-3 py-2 ring-1 ring-zinc-800"
                >
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                    e.type === "high" ? "bg-rose-900/60 text-rose-200" : "bg-emerald-900/60 text-emerald-200"
                  }`}>
                    {e.type === "high" ? "▲ yüksək" : "▼ az"}
                  </span>
                  <span className="text-sm font-medium text-zinc-200">{e.name}</span>
                  <span className="text-xs text-zinc-500">
                    · {e.date}
                    {e.allDay ? " · bütün gün" : ` · ${e.startTime}–${e.endTime}`}
                  </span>
                  <span className="text-xs text-zinc-500">
                    · {e.stationIds.length === STATIONS.length ? "bütün stansiyalar" : `${e.stationIds.length} stansiya`}
                  </span>
                  <button
                    onClick={() => onRemove(e.id)}
                    className="ml-auto rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500 hover:bg-rose-900/60 hover:text-rose-200"
                  >
                    sil
                  </button>
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <AddEventForm
              defaultDate={defaultDate}
              onCancel={() => setAdding(false)}
              onSubmit={(e) => {
                onAdd(e);
                setAdding(false);
              }}
            />
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="w-full rounded-lg bg-zinc-800 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700"
            >
              + Xüsusi gün əlavə et
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface AddEventFormProps {
  defaultDate: string;
  onSubmit: (e: SpecialEvent) => void;
  onCancel: () => void;
}

function AddEventForm({ defaultDate, onSubmit, onCancel }: AddEventFormProps) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("17:00");
  const [endTime, setEndTime] = useState("21:00");
  const [type, setType] = useState<"high" | "low">("high");
  const [stationIds, setStationIds] = useState<string[]>([]);

  const toggleStation = (id: string) =>
    setStationIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const valid = name.trim() && date && stationIds.length > 0 && (allDay || (startTime && endTime));

  const submit = () => {
    if (!valid) return;
    onSubmit({
      id: (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : Date.now().toString(36),
      name: name.trim(),
      date,
      allDay,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime,
      stationIds,
      type,
    });
  };

  const lines = ([1, 2, 3, 4] as LineId[]).map((ln) => ({
    ...LINE_META[ln],
    line: ln,
    stations: STATIONS.filter((s) => s.line === ln),
  }));

  return (
    <div className="space-y-3 rounded-lg bg-zinc-950/60 p-4 ring-1 ring-zinc-800">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Tədbir adı</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Məs. Novruz Bayramı, futbol matçı..."
            className="w-full rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Tarix</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-700 focus:outline-none focus:ring-zinc-500"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => setAllDay(e.target.checked)}
            className="h-4 w-4 rounded bg-zinc-800"
          />
          Bütün gün
        </label>
        {!allDay && (
          <>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Başlama</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-700"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-zinc-500">Bitmə</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 ring-1 ring-zinc-700"
              />
            </div>
          </>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-zinc-500">Gözlənilən axın</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setType("high")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              type === "high" ? "bg-rose-900/70 text-rose-100 ring-1 ring-rose-700" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            ▲ Yüksək axın
          </button>
          <button
            type="button"
            onClick={() => setType("low")}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              type === "low" ? "bg-emerald-900/70 text-emerald-100 ring-1 ring-emerald-700" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            ▼ Az axın
          </button>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="block text-xs text-zinc-500">
            Aid stansiyalar <span className="text-zinc-600">({stationIds.length}/{STATIONS.length})</span>
          </label>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setStationIds(STATIONS.map((s) => s.id))}
              className="text-zinc-500 hover:text-zinc-300"
            >
              hamısını seç
            </button>
            <span className="text-zinc-700">·</span>
            <button
              type="button"
              onClick={() => setStationIds([])}
              className="text-zinc-500 hover:text-zinc-300"
            >
              təmizlə
            </button>
          </div>
        </div>
        <div className="space-y-2 rounded-lg bg-zinc-900 p-2 ring-1 ring-zinc-800">
          {lines.map(({ line, label, color, stations }) => (
            <div key={line}>
              <div className="mb-1 flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                <span className="text-zinc-500">{label}</span>
                <button
                  type="button"
                  onClick={() => {
                    const lineIds = stations.map((s) => s.id);
                    const allSelected = lineIds.every((id) => stationIds.includes(id));
                    if (allSelected) setStationIds((cur) => cur.filter((id) => !lineIds.includes(id)));
                    else setStationIds((cur) => [...new Set([...cur, ...lineIds])]);
                  }}
                  className="ml-auto text-zinc-600 hover:text-zinc-400"
                >
                  xətti seç
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {stations.map((s) => {
                  const checked = stationIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => toggleStation(s.id)}
                      className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
                        checked
                          ? "bg-zinc-100 text-zinc-900"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      }`}
                    >
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          Ləğv et
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!valid}
          className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-50 hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Əlavə et
        </button>
      </div>
    </div>
  );
}
