"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FrameEvent, MetaEvent, Signal, StreamEvent, VideoItem } from "@/lib/types";
import { analyzeWsUrl, videoFileUrl } from "@/lib/api";
import { DetectionOverlay } from "./DetectionOverlay";
import { RiskGauge } from "./RiskGauge";
import { StatPanel } from "./StatPanel";
import { AlertsFeed, type AlertItem } from "./AlertsFeed";
import { StopBanner } from "./StopBanner";

interface Props {
  video: VideoItem;
}

type ConnectionState = "idle" | "connecting" | "streaming" | "done" | "error";

const STOP_THRESHOLD = 95;
const STOP_COOLDOWN_MS = 30_000;
const ALT_WINDOW_MS = 5_000;
const ALT_AVG_THRESHOLD = 60;

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
      setErrorMsg("WebSocket connection failed");
      setConn("error");
    };
    ws.onclose = () => {
      setConn((c) => (c === "streaming" ? "done" : c));
    };

    return () => {
      ws.close();
    };
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
          if (arr[mid].timestamp <= t) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        setCurrentFrame(arr[best]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames]);

  useEffect(() => {
    if (!currentFrame) return;
    if (stopActive) return;
    if (Date.now() < stopCooldownUntil.current) return;
    if (currentFrame.risk_score >= STOP_THRESHOLD) {
      setStopSignal(currentFrame.dominant_signal);
      setStopActive(true);
    }
  }, [currentFrame, stopActive]);

  const handleStopDismiss = useCallback(() => {
    setStopActive(false);
    setStopSignal(null);
    stopCooldownUntil.current = Date.now() + STOP_COOLDOWN_MS;
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fileUrl = useMemo(() => videoFileUrl(video.id), [video.id]);

  const recommendAlternative = useMemo(() => {
    if (!currentFrame || frames.length < 4) return false;
    const tEnd = currentFrame.timestamp;
    const tStart = tEnd - ALT_WINDOW_MS / 1000;
    let sum = 0;
    let n = 0;
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
    if (conn === "connecting") return { label: "Connecting…", color: "#a1a1aa" };
    if (conn === "streaming") return { label: `Analyzing · ${frames.length} frames`, color: "#60a5fa" };
    if (conn === "done") return { label: `Done · ${frames.length} frames`, color: "#10b981" };
    if (conn === "error") return { label: "Error", color: "#ef4444" };
    return { label: "Idle", color: "#71717a" };
  }, [conn, frames.length]);

  const handleExport = () => {
    const payload = {
      video: { id: video.id, name: video.name },
      meta,
      exported_at: new Date().toISOString(),
      frames,
      alerts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `metro-escalator-${video.name.replace(/\.[^.]+$/, "")}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid h-full gap-4 lg:grid-cols-[3fr_1.4fr]">
      <div className="flex flex-col gap-3">
        <div ref={containerRef} className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-zinc-800">
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
            laneSeparators={meta?.lane_separators ?? null}
          />
          <StopBanner active={stopActive} signal={stopSignal} onDismiss={handleStopDismiss} />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-zinc-900/60 px-4 py-2 ring-1 ring-zinc-800">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full" style={{ background: status.color }} />
            <span className="text-sm" style={{ color: status.color }}>{status.label}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">
              {meta ? `${meta.width}×${meta.height} · ${meta.fps.toFixed(1)} fps · stride ${meta.stride} · ${meta.lanes} lanes` : "—"}
            </span>
            <button
              onClick={handleExport}
              disabled={frames.length === 0}
              className="rounded bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              Extract data
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800">
          <RiskGauge score={currentFrame?.risk_score ?? 0} label="Risk score" />
        </div>
        <StatPanel frame={currentFrame} recommendAlternative={recommendAlternative} />
        <div className="min-h-[18rem] flex-1">
          <AlertsFeed alerts={alerts} />
        </div>
      </div>
    </div>
  );
}
