"use client";

import { useEffect, useRef } from "react";
import type { FrameEvent, LaneSeparator } from "@/lib/types";
import { riskColor } from "./RiskGauge";

interface Props {
  frame: FrameEvent | null;
  videoWidth: number;
  videoHeight: number;
  displayWidth: number;
  displayHeight: number;
  laneSeparators: LaneSeparator[] | null;
  onPersonClick?: (person: import("@/lib/types").PersonRisk, x: number, y: number) => void;
}

export function DetectionOverlay({ frame, videoWidth, videoHeight, displayWidth, displayHeight, laneSeparators, onPersonClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!frame || videoWidth === 0 || videoHeight === 0) return;

    const sx = displayWidth / videoWidth;
    const sy = displayHeight / videoHeight;

    const seps = laneSeparators ?? [];
    if (seps.length > 0) {
      const lanes = seps.length + 1;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(56, 189, 248, 0.9)";
      ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
      ctx.shadowBlur = 4;
      for (const [[tx, ty], [bx, by]] of seps) {
        ctx.beginPath();
        ctx.moveTo(tx * displayWidth, ty * displayHeight);
        ctx.lineTo(bx * displayWidth, by * displayHeight);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;

      const bottomYs: number[] = [0, ...seps.map((s) => s[1][0]), 1];
      ctx.font = "bold 12px ui-sans-serif, system-ui";
      ctx.textBaseline = "middle";
      for (let i = 0; i < lanes; i++) {
        const cxNorm = (bottomYs[i] + bottomYs[i + 1]) / 2;
        const cx = cxNorm * displayWidth;
        const cy = displayHeight - 18;
        const dir = frame.lane_directions?.[i] ?? "unknown";
        const dirAz = dir === "up" ? "yuxarı" : dir === "down" ? "aşağı" : "—";
        const text = `Zolaq ${i + 1} · ${dirAz}`;
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(2, 6, 23, 0.75)";
        ctx.fillRect(cx - tw / 2 - 6, cy - 10, tw + 12, 20);
        ctx.fillStyle = "rgba(56, 189, 248, 1)";
        ctx.fillText(text, cx - tw / 2, cy);
      }
      ctx.textBaseline = "alphabetic";
      ctx.restore();
    }

    ctx.font = "12px ui-sans-serif, system-ui";
    ctx.lineWidth = 2;

    for (const obj of frame.objects ?? []) {
      const [x1, y1, x2, y2] = obj.bbox;
      const x = x1 * sx;
      const y = y1 * sy;
      const w = (x2 - x1) * sx;
      const h = (y2 - y1) * sy;
      ctx.strokeStyle = obj.stationary ? "#a855f7" : "#a8a29e";
      ctx.setLineDash(obj.stationary ? [] : [3, 3]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      const label = obj.stationary ? `${obj.cls} (qoyulmuş)` : obj.cls;
      ctx.fillStyle = obj.stationary ? "#a855f7" : "#a8a29e";
      const tw = ctx.measureText(label).width + 8;
      ctx.fillRect(x, y - 16, tw, 16);
      ctx.fillStyle = "#0a0a0f";
      ctx.fillText(label, x + 4, y - 4);
    }

    for (const p of frame.persons) {
      const [x1, y1, x2, y2] = p.bbox;
      const x = x1 * sx;
      const y = y1 * sy;
      const w = (x2 - x1) * sx;
      const h = (y2 - y1) * sy;

      const color = riskColor(p.risk * 100);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = p.flags.length ? 2.5 : 1;
      ctx.strokeRect(x, y, w, h);

      if (p.head_bbox) {
        const [hx1, hy1, hx2, hy2] = p.head_bbox;
        ctx.lineWidth = 2;
        ctx.strokeRect(hx1 * sx, hy1 * sy, (hx2 - hx1) * sx, (hy2 - hy1) * sy);
      }

      const label = `#${p.track_id}·L${p.lane + 1}${p.flags.length ? " " + p.flags.join(",") : ""}`;
      ctx.lineWidth = 2;
      const tw = ctx.measureText(label).width + 8;
      ctx.fillRect(x, y - 16, tw, 16);
      ctx.fillStyle = "#0a0a0f";
      ctx.fillText(label, x + 4, y - 4);
    }
  }, [frame, videoWidth, videoHeight, displayWidth, displayHeight, laneSeparators]);

  const sx = videoWidth > 0 ? displayWidth / videoWidth : 1;
  const sy = videoHeight > 0 ? displayHeight / videoHeight : 1;

  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
      {frame && onPersonClick && videoWidth > 0 && videoHeight > 0 && frame.persons.map((p) => (
        <div
          key={p.track_id}
          className="absolute cursor-pointer rounded transition-all hover:bg-white/5 hover:ring-1 hover:ring-white/20"
          title={p.flags.length > 0 ? `#${p.track_id} üçün düzəliş / əlavə bildiriş` : `#${p.track_id} üçün qaçırılan pozuntu bildirişi`}
          style={{
            left: p.bbox[0] * sx,
            top: p.bbox[1] * sy,
            width: (p.bbox[2] - p.bbox[0]) * sx,
            height: (p.bbox[3] - p.bbox[1]) * sy,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onPersonClick(p, e.clientX, e.clientY);
          }}
        />
      ))}
    </>
  );
}
