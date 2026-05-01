"use client";

import { useEffect, useRef, useState } from "react";
import type { Signal } from "@/lib/types";
import { submitFeedback } from "@/lib/api";

interface Props {
  active: boolean;
  signal: Signal | null;
  onDismiss: () => void;
}

type Phase = "stop" | "stopped" | "hidden";

export function StopBanner({ active, signal, onDismiss }: Props) {
  const [phase, setPhase] = useState<Phase>("hidden");
  const phaseRef = useRef<Phase>("hidden");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!active) return;
    if (phaseRef.current !== "hidden") return;
    setPhase("stop");
    timerRef.current = setTimeout(() => {
      if (phaseRef.current !== "stop") return;
      setPhase("stopped");
      timerRef.current = setTimeout(() => {
        setPhase("hidden");
        onDismiss();
      }, 5000);
    }, 8000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, onDismiss]);

  const handleIgnore = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (signal && signal !== "density") {
      submitFeedback(signal, "incorrect").catch(() => {});
    }
    setPhase("hidden");
    onDismiss();
  };

  if (phase === "hidden") return null;

  if (phase === "stopped") {
    return (
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center bg-red-950/90 px-4 py-3 text-center text-lg font-semibold text-red-100 ring-2 ring-red-700">
        Stopped myself
      </div>
    );
  }

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-4 bg-red-600/95 px-5 py-4 ring-2 ring-red-300 shadow-lg shadow-red-900/50">
      <div className="text-2xl font-bold uppercase tracking-widest text-white">
        Stop
      </div>
      <div className="flex-1 text-sm text-red-50">
        Critical risk{signal ? ` · ${signal}` : ""}. Auto-stop in 8s if not ignored.
      </div>
      <button
        onClick={handleIgnore}
        className="rounded bg-white/95 px-4 py-1.5 text-sm font-semibold text-red-700 hover:bg-white"
      >
        Ignore
      </button>
    </div>
  );
}
