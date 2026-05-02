"use client";

import { useState } from "react";
import type { Signal } from "@/lib/types";
import { SIGNAL_INFO } from "@/lib/signals";
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

const SEV_COLOR: Record<AlertItem["severity"], { border: string; badge: string; text: string }> = {
  warn: { border: "#f59e0b", badge: "bg-amber-900/60 text-amber-300", text: "text-amber-400" },
  danger: { border: "#ef4444", badge: "bg-rose-900/60 text-rose-300", text: "text-rose-400" },
};

export function AlertsFeed({ alerts, onJump }: Props) {
  const [verdicts, setVerdicts] = useState<Record<string, "correct" | "incorrect">>({});

  const handleVerdict = async (
    e: React.MouseEvent,
    a: AlertItem,
    verdict: "correct" | "incorrect",
  ) => {
    e.stopPropagation();
    if (verdicts[a.id] || a.signal === "density") return;
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
    <div className="flex h-full flex-col rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Canlı Xəbərdarlıqlar
        </span>
        {alerts.length > 0 && (
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400">
            {alerts.length}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {alerts.length === 0 ? (
          <div className="py-8 text-center text-sm text-zinc-600">Hələ xəbərdarlıq yoxdur</div>
        ) : (
          <ul className="space-y-2">
            {alerts.slice(0, 60).map((a) => {
              const v = verdicts[a.id];
              const teachable = a.signal !== "density";
              const sev = SEV_COLOR[a.severity];
              const info = SIGNAL_INFO[a.signal];
              return (
                <li
                  key={a.id}
                  onClick={() => onJump && onJump(a.ts)}
                  className="group rounded-lg border-l-2 bg-zinc-950/60 transition-colors"
                  style={{ borderColor: sev.border }}
                  title={onJump ? "Bu vaxta keçid üçün klikləyin" : undefined}
                >
                  <div className={`px-3 py-2.5 ${onJump ? "cursor-pointer hover:bg-zinc-900/80" : ""}`}>
                    {/* Top row: time + signal badge + jump hint */}
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs text-zinc-500">{a.ts.toFixed(1)}s</span>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${sev.badge}`}>
                        {info?.label ?? a.signal}
                      </span>
                      {onJump && (
                        <span className="ml-auto text-xs text-zinc-700 opacity-0 transition-opacity group-hover:opacity-100">
                          ↱ keçid
                        </span>
                      )}
                    </div>

                    {/* Message */}
                    <p className="text-xs text-zinc-300">{a.message}</p>

                    {/* Feedback row */}
                    {teachable && (
                      <div className="mt-2 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {v ? (
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-medium ${
                              v === "correct"
                                ? "bg-emerald-900/60 text-emerald-300"
                                : "bg-rose-900/60 text-rose-300"
                            }`}
                          >
                            {v === "correct" ? "✓ Təsdiqləndi" : "✗ Səhv işarələndi"}
                          </span>
                        ) : (
                          <>
                            <span className="text-xs text-zinc-600">Bu doğru idi?</span>
                            <button
                              onClick={(e) => handleVerdict(e, a, "correct")}
                              className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 hover:bg-emerald-900/60 hover:text-emerald-200"
                            >
                              ✓ Bəli
                            </button>
                            <button
                              onClick={(e) => handleVerdict(e, a, "incorrect")}
                              className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400 hover:bg-rose-900/60 hover:text-rose-200"
                            >
                              ✗ Xeyr
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-600">
          İstənilən xəbərdarlığa klikləyərək həmin vaxta keçin
        </div>
      )}
    </div>
  );
}
