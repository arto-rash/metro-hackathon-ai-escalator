"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import type { FrameEvent, MetaEvent, Signal, StreamEvent, VideoItem } from "@/lib/types";
import { analyzeWsUrl, videoFileUrl, submitFeedback } from "@/lib/api";
import { SIGNAL_INFO } from "@/lib/signals";
import { DetectionOverlay } from "./DetectionOverlay";
import { RiskGauge } from "./RiskGauge";
import { StatPanel } from "./StatPanel";
import { AlertsFeed, type AlertItem } from "./AlertsFeed";
import { StopBanner } from "./StopBanner";
import type { PersonRisk } from "@/lib/types";

interface Props {
  video: VideoItem;
}

type ConnectionState = "idle" | "connecting" | "streaming" | "done" | "error";

const STOP_THRESHOLD = 95;
const STOP_COOLDOWN_MS = 30_000;
const ALT_WINDOW_MS = 5_000;
const ALT_AVG_THRESHOLD = 60;

// Platform/entrance → expected seconds until escalator impact
const PREDICTION_DELAY: Record<string, number> = {
  platform: 60,
  entrance: 90,
};

// How many platform people per escalator capacity slot (rough factor)
const PLATFORM_ESCALATOR_RATIO = 0.75;

export function Analyzer({ video }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [meta, setMeta] = useState<MetaEvent | null>(null);
  const [frames, setFrames] = useState<FrameEvent[]>([]);
  const [currentFrame, setCurrentFrame] = useState<FrameEvent | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [conn, setConn] = useState<ConnectionState>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const [stopActive, setStopActive] = useState(false);
  const [stopSignal, setStopSignal] = useState<Signal | null>(null);
  const stopCooldownUntil = useRef(0);

  const seenAlertIds = useRef<Set<string>>(new Set());

  const [feedbackPopup, setFeedbackPopup] = useState<{
    person: PersonRisk;
    x: number;
    y: number;
  } | null>(null);

  const handlePersonClick = useCallback((person: PersonRisk, x: number, y: number) => {
    if (videoRef.current) videoRef.current.pause();
    setFeedbackPopup({ person, x, y });
  }, []);

  const submitManualFeedback = async (signal: Signal, verdict: "correct" | "incorrect" = "correct") => {
    if (!feedbackPopup) return;
    try {
      await submitFeedback(signal, verdict);
    } catch (e) {
      console.error(e);
    }
    setFeedbackPopup(null);
  };

  useEffect(() => {
    setFrames([]);
    setCurrentFrame(null);
    setAlerts([]);
    setMeta(null);
    setErrorMsg(null);
    setStopActive(false);
    setStopSignal(null);
    seenAlertIds.current = new Set();
    stopCooldownUntil.current = 0;
    setFeedbackPopup(null);
    setConn("connecting");

    const ws = new WebSocket(analyzeWsUrl(video.id));
    wsRef.current = ws;

    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data) as StreamEvent;
      if (data.type === "meta") {
        setMeta(data);
        setConn("streaming");
      } else if (data.type === "frame") {
        setFrames((prev) => {
          const next = [...prev, data];
          if (next.length > 30000) next.shift();
          return next;
        });
        if (data.alerts.length > 0) {
          const fresh: AlertItem[] = [];
          for (const a of data.alerts) {
            if (seenAlertIds.current.has(a.id)) continue;
            seenAlertIds.current.add(a.id);
            fresh.push({
              id: a.id,
              ts: data.timestamp,
              signal: a.signal,
              message: a.message,
              severity: a.severity,
            });
          }
          if (fresh.length) setAlerts((prev) => [...fresh, ...prev].slice(0, 200));
        }
      } else if (data.type === "done") {
        setConn("done");
      } else if (data.type === "error") {
        setErrorMsg(data.message);
        setConn("error");
      }
    };

    ws.onerror = () => {
      // Suppressed per user request — the WS lifecycle ends in `onclose`
      // anyway, so we just let the close handler resolve the state.
    };
    ws.onclose = () => {
      setConn((c) => (c === "streaming" ? "done" : c));
    };

    return () => ws.close();
  }, [video.id]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      const t = el.currentTime;
      const arr = frames;
      if (arr.length > 0) {
        let lo = 0, hi = arr.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (arr[mid].timestamp <= t) { best = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
        setCurrentFrame(arr[best]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames]);

  useEffect(() => {
    if (!currentFrame || stopActive || Date.now() < stopCooldownUntil.current) return;
    // Stop banner is reserved for falls only — counterflow / running / facing /
    // sitting raise the risk gauge but never trigger an automatic stop.
    const fallPerson = currentFrame.persons.find((p) => p.flags.includes("fall"));
    if (fallPerson) {
      setStopSignal("fall" as Signal);
      setStopActive(true);
    }
  }, [currentFrame, stopActive]);

  const handleStopDismiss = useCallback(() => {
    setStopActive(false);
    setStopSignal(null);
    stopCooldownUntil.current = Date.now() + STOP_COOLDOWN_MS;
  }, []);

  const simulateStop = useCallback(() => {
    // Demo: reset cooldown and force the stop banner. The banner is reserved
    // for falls, so we always pass "fall" regardless of current dominant signal.
    // Playback is intentionally NOT paused so the demo stays live.
    stopCooldownUntil.current = 0;
    setStopSignal("fall" as Signal);
    setStopActive(true);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fileUrl = useMemo(() => videoFileUrl(video.id), [video.id]);

  const recommendAlternative = useMemo(() => {
    if (!currentFrame || frames.length < 4) return false;
    const tEnd = currentFrame.timestamp;
    const tStart = tEnd - ALT_WINDOW_MS / 1000;
    let sum = 0, n = 0;
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (f.timestamp > tEnd) continue;
      if (f.timestamp < tStart) break;
      sum += f.risk_score;
      n++;
    }
    return n > 0 && sum / n >= ALT_AVG_THRESHOLD;
  }, [currentFrame, frames]);

  const status = useMemo(() => {
    if (conn === "connecting") return { label: "Qoşulur…", color: "#a1a1aa" };
    if (conn === "streaming") return { label: `Analiz olunur · ${frames.length} kadr`, color: "#60a5fa" };
    if (conn === "done") return { label: `Tamamlandı · ${frames.length} kadr`, color: "#10b981" };
    if (conn === "error") return { label: "Xəta", color: "#ef4444" };
    return { label: "Hazır", color: "#71717a" };
  }, [conn, frames.length]);

  const handleExport = () => {
    if (frames.length === 0) return;

    const fmtTs = (t: number) =>
      `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, "0")}`;

    const BUCKET_SEC = 60;
    const totalSec = frames[frames.length - 1].timestamp;
    const bucketCount = Math.max(1, Math.ceil(totalSec / BUCKET_SEC));

    const alertCounts: Record<string, number> = {};
    for (const a of alerts) alertCounts[a.signal] = (alertCounts[a.signal] ?? 0) + 1;

    const allRisks = frames.map((f) => f.risk_score);
    const avgRisk = allRisks.reduce((s, v) => s + v, 0) / allRisks.length;
    const peakRisk = Math.max(...allRisks);
    const peakFrame = frames.find((f) => f.risk_score === peakRisk);
    const maxDensityPct = Math.round(Math.max(...frames.map((f) => f.density)) * 100);
    const avgPeople = Math.round(
      frames.reduce((s, f) => s + f.person_count, 0) / frames.length,
    );

    // ── Sheet 1: Xülasə (summary) ───────────────────────────────────────────
    const summaryRows: (string | number)[][] = [
      ["Hesabat tarixi",         new Date().toLocaleString("az-AZ")],
      ["Video adı",              video.name],
      ["Kateqoriya",             video.category ?? "escalator"],
      ["Müddət",                 `${Math.floor(totalSec / 60)}d ${Math.round(totalSec % 60)}s`],
      ["İşlənmiş kadr sayı",     frames.length],
      ["Effektiv FPS",           meta ? +(meta.fps / meta.stride).toFixed(1) : "—"],
      ["Yayım çözünürlüyü",      meta ? `${meta.width}×${meta.height}` : "—"],
      ["Zolaq sayı",             meta?.lanes ?? "—"],
      [],
      ["Orta risk balı",         Math.round(avgRisk)],
      ["Pik risk balı",          Math.round(peakRisk)],
      ["Pik risk anı",           peakFrame ? fmtTs(peakFrame.timestamp) : "—"],
      ["Maks. sıxlıq (%)",       maxDensityPct],
      ["Ortalama insan sayı",    avgPeople],
      ["Ümumi xəbərdarlıq",      alerts.length],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 26 }, { wch: 32 }];

    // ── Sheet 2: Xəbərdarlıq növləri (alert breakdown) ──────────────────────
    const breakdownRows: (string | number)[][] = [["Növ", "Etiket", "Say"]];
    for (const [sig, n] of Object.entries(alertCounts)) {
      breakdownRows.push([sig, SIGNAL_INFO[sig as Signal]?.label ?? sig, n]);
    }
    const breakdownSheet = XLSX.utils.aoa_to_sheet(breakdownRows);
    breakdownSheet["!cols"] = [{ wch: 16 }, { wch: 28 }, { wch: 8 }];

    // ── Sheet 3: Vaxt cədvəli (per-minute timeline) ─────────────────────────
    const timelineRows: (string | number)[][] = [
      ["Dövr", "Orta risk", "Pik risk", "Orta insan", "Maks sıxlıq %", "Xəbərdarlıq sayı"],
    ];
    for (let i = 0; i < bucketCount; i++) {
      const tStart = i * BUCKET_SEC;
      const tEnd = tStart + BUCKET_SEC;
      const bucket = frames.filter((f) => f.timestamp >= tStart && f.timestamp < tEnd);
      if (bucket.length === 0) continue;
      const bucketAlerts = alerts.filter((a) => a.ts >= tStart && a.ts < tEnd);
      const bucketRisks = bucket.map((f) => f.risk_score);
      timelineRows.push([
        `${fmtTs(tStart)} – ${fmtTs(tEnd)}`,
        Math.round(bucketRisks.reduce((s, v) => s + v, 0) / bucketRisks.length),
        Math.round(Math.max(...bucketRisks)),
        Math.round(bucket.reduce((s, f) => s + f.person_count, 0) / bucket.length),
        Math.round(Math.max(...bucket.map((f) => f.density)) * 100),
        bucketAlerts.length,
      ]);
    }
    const timelineSheet = XLSX.utils.aoa_to_sheet(timelineRows);
    timelineSheet["!cols"] = [{ wch: 16 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 14 }, { wch: 18 }];

    // ── Sheet 4: Xəbərdarlıqlar (full alert log) ────────────────────────────
    const alertRows: (string | number)[][] = [
      ["Vaxt", "Növ", "Etiket", "Səviyyə", "Mesaj"],
    ];
    for (const a of [...alerts].sort((x, y) => x.ts - y.ts)) {
      alertRows.push([
        fmtTs(a.ts),
        a.signal,
        SIGNAL_INFO[a.signal as Signal]?.label ?? a.signal,
        a.severity,
        a.message,
      ]);
    }
    const alertSheet = XLSX.utils.aoa_to_sheet(alertRows);
    alertSheet["!cols"] = [{ wch: 8 }, { wch: 14 }, { wch: 26 }, { wch: 10 }, { wch: 60 }];

    // ── Build & download ───────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet,   "Xülasə");
    XLSX.utils.book_append_sheet(wb, breakdownSheet, "Növlər");
    XLSX.utils.book_append_sheet(wb, timelineSheet,  "Vaxt cədvəli");
    XLSX.utils.book_append_sheet(wb, alertSheet,     "Xəbərdarlıqlar");

    const baseName = video.name.replace(/\.[^.]+$/, "");
    XLSX.writeFile(wb, `metro-hesabat-${baseName}-${Date.now()}.xlsx`);
  };

  const isPredictive = video.category === "platform" || video.category === "entrance";
  const predDelay = PREDICTION_DELAY[video.category ?? "escalator"] ?? 60;

  return (
    <div className="grid h-full gap-4 lg:grid-cols-[3fr_1.4fr]">
      {/* ── Feedback popup ── */}
      {feedbackPopup && (
        <FeedbackPopup
          person={feedbackPopup.person}
          x={feedbackPopup.x}
          y={feedbackPopup.y}
          onSubmit={submitManualFeedback}
          onClose={() => setFeedbackPopup(null)}
        />
      )}

      {/* ── Left column: video + status bar ── */}
      <div className="flex flex-col gap-3">
        <div
          ref={containerRef}
          className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-zinc-800"
        >
          <video
            ref={videoRef}
            src={fileUrl}
            controls
            playsInline
            className="absolute inset-0 h-full w-full"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              setSize({ w: v.clientWidth, h: v.clientHeight });
            }}
          />
          <DetectionOverlay
            frame={currentFrame}
            videoWidth={meta?.width ?? 0}
            videoHeight={meta?.height ?? 0}
            displayWidth={size.w}
            displayHeight={size.h}
            laneSeparators={isPredictive ? null : (meta?.lane_separators ?? null)}
            onPersonClick={isPredictive ? undefined : handlePersonClick}
          />
          <StopBanner active={stopActive} signal={stopSignal} onDismiss={handleStopDismiss} />

          {/* Predictive camera label */}
          {isPredictive && (
            <div className="absolute left-3 top-3 rounded-lg bg-zinc-900/90 px-3 py-1.5 text-xs ring-1 ring-zinc-700">
              <span className="text-zinc-400">
                {video.category === "platform" ? "Platforma Kamerası" : "Giriş Kamerası"}
              </span>
              <span className="ml-2 text-zinc-500">· eskalator yükünü ~{predDelay}s əvvəl proqnozlaşdırır</span>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between rounded-lg bg-zinc-900/60 px-4 py-2 ring-1 ring-zinc-800">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full" style={{ background: status.color }} />
            <span className="text-sm" style={{ color: status.color }}>{status.label}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              {meta
                ? `${meta.width}×${meta.height} · ${meta.fps.toFixed(1)} fps · stride ${meta.stride} · ${meta.lanes} lanes`
                : "—"}
            </span>
            {!isPredictive && (
              <button
                onClick={simulateStop}
                title="Demo: təcili dayandırma simulyasiyası"
                className="rounded bg-rose-900/60 px-3 py-1 text-xs font-medium text-rose-100 ring-1 ring-rose-800 hover:bg-rose-800"
              >
                ⚠ Demo Dayandır
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={frames.length === 0}
              className="rounded bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              Hesabat çıxar
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
            {errorMsg}
          </div>
        )}
      </div>

      {/* ── Right column: gauge, stats, predictive panel, alerts ── */}
      <div className="flex flex-col gap-4">
        {isPredictive ? (
          <PredictivePanel frame={currentFrame} delay={predDelay} category={video.category!} />
        ) : (
          <>
            <div className="rounded-xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800">
              <RiskGauge score={currentFrame?.risk_score ?? 0} label="Risk score" />
            </div>
            <StatPanel frame={currentFrame} recommendAlternative={recommendAlternative} />
          </>
        )}

        <div className="min-h-[18rem] flex-1">
          <AlertsFeed
            alerts={alerts}
            onJump={(ts) => {
              if (videoRef.current) videoRef.current.currentTime = ts;
            }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Feedback popup component ────────────────────────────────────────────────

interface FeedbackPopupProps {
  person: PersonRisk;
  x: number;
  y: number;
  onSubmit: (signal: Signal, verdict: "correct" | "incorrect") => void;
  onClose: () => void;
}

function FeedbackPopup({ person, x, y, onSubmit, onClose }: FeedbackPopupProps) {
  const winH = typeof window !== "undefined" ? window.innerHeight : 800;
  const winW = typeof window !== "undefined" ? window.innerWidth : 1200;
  const top = Math.max(8, Math.min(y + 12, winH - 380));
  const left = Math.max(8, Math.min(x + 12, winW - 296));

  const isFlagged = person.flags.length > 0;

  return (
    <div
      className="fixed z-50 w-72 rounded-xl bg-zinc-900 shadow-2xl ring-1 ring-zinc-700"
      style={{ top, left }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-200">Sərnişin #{person.track_id}</span>
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${
              isFlagged ? "bg-rose-900/60 text-rose-300" : "bg-emerald-900/50 text-emerald-300"
            }`}
          >
            {isFlagged ? "İşarələnib" : "Təhlükəsiz"}
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
        >
          ✕
        </button>
      </div>

      {/* Currently detected flags — allow marking wrong */}
      {isFlagged && (
        <div className="border-b border-zinc-800 px-4 py-3">
          <p className="mb-2 text-xs text-zinc-500">AI aşkarladı:</p>
          <div className="space-y-1">
            {person.flags.map((f) => (
              <div key={f} className="flex items-center justify-between gap-2">
                <span className="text-xs text-rose-300">{SIGNAL_INFO[f]?.label ?? f}</span>
                <button
                  onClick={() => onSubmit(f as Signal, "incorrect")}
                  className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-500 hover:bg-rose-900/50 hover:text-rose-300"
                >
                  ✗ səhv
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Report missed violation */}
      <div className="px-4 py-3">
        <p className="mb-2 text-xs text-zinc-500">
          {isFlagged ? "Həmçinin qaçırılan pozuntunu bildir:" : "Hansı qayda pozulur?"}
        </p>
        <div className="space-y-1">
          {(Object.entries(SIGNAL_INFO) as [string, { label: string; description: string }][])
            .filter(([k]) => k !== "density")
            .map(([sig, info]) => {
              const already = person.flags.includes(sig);
              return (
                <button
                  key={sig}
                  onClick={() => !already && onSubmit(sig as Signal, "correct")}
                  disabled={already}
                  title={info.description}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-xs transition-colors ${
                    already
                      ? "cursor-default bg-zinc-800/40 text-zinc-600"
                      : "bg-zinc-800 text-zinc-300 hover:bg-emerald-900/60 hover:text-emerald-200"
                  }`}
                >
                  <span className="text-left">{info.label}</span>
                  {already && <span className="shrink-0 text-zinc-700">aşkarlandı ✓</span>}
                </button>
              );
            })}
        </div>
      </div>

      <div className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-600">
        Geri bildiriş AI həssaslığını real vaxtda öyrədir
      </div>
    </div>
  );
}

// ── Predictive load panel ──────────────────────────────────────────────────

interface PredictivePanelProps {
  frame: FrameEvent | null;
  delay: number;
  category: string;
}

function PredictivePanel({ frame, delay, category }: PredictivePanelProps) {
  const count = frame?.person_count ?? 0;
  const predicted = Math.round(count * PLATFORM_ESCALATOR_RATIO);
  const densityPct = Math.round((frame?.density ?? 0) * 100);

  return (
    <div className="rounded-xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800 space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          {category === "platform" ? "Platforma" : "Giriş"} · Proqnoz Yükü
        </p>
        <p className="mt-0.5 text-xs text-zinc-600">
          Burada aşkarlanan insanlar ~{delay}s sonra eskalatora çatacaq
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-xs text-zinc-500">Cari Sayı</p>
          <p className="mt-1 text-2xl font-bold text-zinc-100">{count}</p>
          <p className="text-xs text-zinc-500">görünən insan</p>
        </div>
        <div className="rounded-lg bg-zinc-800 p-3">
          <p className="text-xs text-zinc-500">Proqnoz Eskalator Yükü</p>
          <p className="mt-1 text-2xl font-bold text-blue-300">+{predicted}</p>
          <p className="text-xs text-zinc-500">~{delay}s sonra</p>
        </div>
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-zinc-500">
          <span>{category === "platform" ? "Platforma" : "Sahə"} sıxlığı</span>
          <span>{densityPct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${densityPct}%`,
              background: densityPct > 70 ? "#ef4444" : densityPct > 45 ? "#f59e0b" : "#10b981",
            }}
          />
        </div>
      </div>

      {predicted > 8 && (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          ⚠ Yüksək proqnoz axını — indi ehtiyat eskalatoru hazırlayın
        </div>
      )}
    </div>
  );
}
