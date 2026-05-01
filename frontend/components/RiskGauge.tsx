"use client";

interface Props {
  score: number;
  label?: string;
}

export function riskColor(score: number): string {
  if (score >= 95) return "#7f1d1d";
  if (score >= 85) return "#ef4444";
  if (score >= 60) return "#f97316";
  if (score >= 40) return "#f59e0b";
  return "#10b981";
}

export function RiskGauge({ score, label = "Risk" }: Props) {
  const pct = Math.max(0, Math.min(100, score));
  const color = riskColor(pct);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-44 w-44">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          <circle cx="80" cy="80" r={radius} stroke="#1f2937" strokeWidth="14" fill="none" />
          <circle
            cx="80"
            cy="80"
            r={radius}
            stroke={color}
            strokeWidth="14"
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 200ms linear, stroke 200ms linear" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-semibold" style={{ color }}>
            {Math.round(pct)}
          </span>
          <span className="text-xs uppercase tracking-wider text-zinc-500">{label}</span>
        </div>
      </div>
    </div>
  );
}
