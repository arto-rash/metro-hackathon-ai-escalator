import type { Signal, VideoItem } from "./types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";

export async function listVideos(): Promise<VideoItem[]> {
  const r = await fetch(`${API_URL}/api/videos`, { cache: "no-store" });
  if (!r.ok) throw new Error(`listVideos failed: ${r.status}`);
  const data = await r.json();
  return data.videos as VideoItem[];
}

export async function uploadVideo(file: File): Promise<VideoItem> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(`${API_URL}/api/videos/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  return (await r.json()) as VideoItem;
}

export function videoFileUrl(id: string): string {
  return `${API_URL}/api/videos/${encodeURIComponent(id)}/file`;
}

export function analyzeWsUrl(id: string, stride = 2, capacity = 12): string {
  return `${WS_URL}/ws/analyze/${encodeURIComponent(id)}?stride=${stride}&capacity=${capacity}`;
}

export async function submitFeedback(signal: Signal, verdict: "correct" | "incorrect", eventId?: string): Promise<void> {
  await fetch(`${API_URL}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signal, verdict, event_id: eventId }),
  });
}
