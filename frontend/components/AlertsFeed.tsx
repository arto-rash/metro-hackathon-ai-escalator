"use client";

import { useState } from "react";
import type { Signal } from "@/lib/types";
import { submitFeedback } from "@/lib/api";

export interface AlertItem {
  id: string;
  ts: number;
  signal: Signal;
  message: string;
  severity: "warn" | "danger";
}

interface Props {
  alerts: AlertItem[];
  onJump?: (ts: number) => void;
}

const BORDER: Record<AlertItem["severity"], string> = {
  warn: "#f59e0b",
  danger: "#ef4444",
};

export function AlertsFeed({ alerts, onJump }: Props) {
  const [verdicts, setVerdicts] = useState<Record<string, "correct" | "incorrect">>({});

  const handleVerdict = async (e: React.MouseEvent, a: AlertItem, verdict: "correct" | "incorrect") => {
    e.stopPropagation(); // prevent jumping when clicking feedback
    if (verdicts[a.id]) return;
    if (a.signal === "density") return;
    setVerdicts((v) => ({ ...v, [a.id]: verdict }));
    try {
      await submitFeedback(a.signal, verdict, a.id);
    } catch {
      setVerdicts((v) => {
        const next = { ...v };
        delete next[a.id];
        return next;
      });
    }
  };

  return (
    <div className="flex h-full flex-col rounded-lg bg-zinc-900/60 ring-1 ring-zinc-800">
      <div className="border-b border-zinc-800 px-4 py-2 text-xs uppercase tracking-wider text-zinc-500">
        Live alerts
      </div>
      <div className="flex-1 overflow-auto p-3">
        {alerts.length === 0 ? (
          <div className="py-6 text-center text-sm text-zinc-600">No alerts yet</div>
        ) : (
          <ul className="space-y-2">
            {alerts.slice(0, 60).map((a) => {
              const v = verdicts[a.id];
              const teachable = a.signal !== "density";
              return (
                <li
                  key={a.id}
                  onClick={() => onJump && onJump(a.ts)}
                  className={`rounded border-l-2 bg-zinc-950/60 px-3 py-2 text-sm ${onJump ? "cursor-pointer hover:bg-zinc-900/80" : ""}`}
                  style={{ borderColor: BORDER[a.severity] }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-zinc-500">{a.ts.toFixed(1)}s · {a.signal}</span>
                    {teachable && (
                      <span className="flex gap-1 text-xs">
                        <button
                          onClick={(e) => handleVerdict(e, a, "correct")}
                          disabled={!!v}
                          className={`rounded px-2 py-0.5 ${
                            v === "correct"
                              ? "bg-emerald-700 text-emerald-50"
                              : "bg-zinc-800 text-zinc-400 hover:bg-emerald-900 hover:text-emerald-200 disabled:opacity-40"
                          }`}
                        >
                          ✓ correct
                        </button>
                        <button
                          onClick={(e) => handleVerdict(e, a, "incorrect")}
                          disabled={!!v}
                          className={`rounded px-2 py-0.5 ${
                            v === "incorrect"
                              ? "bg-rose-700 text-rose-50"
                              : "bg-zinc-800 text-zinc-400 hover:bg-rose-900 hover:text-rose-200 disabled:opacity-40"
                          }`}
                        >
                          ✗ incorrect
                        </button>
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-zinc-200">{a.message}</div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
