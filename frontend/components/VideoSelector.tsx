"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoCategory, VideoItem } from "@/lib/types";
import { listVideos, uploadVideo } from "@/lib/api";

interface Props {
  selected: VideoItem | null;
  onSelect: (video: VideoItem) => void;
}

const CAT_LABELS: Record<VideoCategory, string> = {
  escalator: "Escalator",
  platform: "Platform",
  entrance: "Entrance",
};

const CAT_COLORS: Record<VideoCategory, string> = {
  escalator: "#60a5fa",
  platform: "#a78bfa",
  entrance: "#34d399",
};

export function VideoSelector({ selected, onSelect }: Props) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadCategory, setUploadCategory] = useState<VideoCategory>("escalator");
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      setVideos(await listVideos());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const item = await uploadVideo(file, uploadCategory);
      await refresh();
      onSelect(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  // Group by category for display
  const byCategory = (["escalator", "platform", "entrance"] as VideoCategory[])
    .map((cat) => ({
      cat,
      items: videos.filter((v) => (v.category ?? "escalator") === cat),
    }))
    .filter(({ items }) => items.length > 0);

  return (
    <div className="rounded-xl bg-zinc-900/60 p-4 ring-1 ring-zinc-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Sources</h2>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          {loading ? "…" : "refresh"}
        </button>
      </div>

      {/* Video list grouped by camera type */}
      <div className="mb-4 max-h-52 overflow-auto rounded-lg border border-zinc-800">
        {videos.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-zinc-600">
            Drop videos in <code className="text-zinc-400">backend/videos/</code> or upload below.
          </div>
        ) : (
          <>
            {byCategory.map(({ cat, items }) => (
              <div key={cat}>
                <div
                  className="sticky top-0 flex items-center gap-1.5 border-b border-zinc-800 bg-zinc-900 px-3 py-1.5"
                >
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: CAT_COLORS[cat] }}
                  />
                  <span className="text-xs font-medium" style={{ color: CAT_COLORS[cat] }}>
                    {CAT_LABELS[cat]}
                  </span>
                </div>
                {items.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => onSelect(v)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-800 ${
                      selected?.id === v.id ? "bg-zinc-800/80 text-white" : "text-zinc-300"
                    }`}
                  >
                    <span className="truncate">{v.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-zinc-500">{v.source}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Upload section */}
      <div className="space-y-2">
        <div>
          <label className="mb-1 block text-xs text-zinc-500">Camera type</label>
          <div className="grid grid-cols-3 gap-1">
            {(["escalator", "platform", "entrance"] as VideoCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setUploadCategory(cat)}
                className={`rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                  uploadCategory === cat
                    ? "ring-1"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                }`}
                style={
                  uploadCategory === cat
                    ? { background: CAT_COLORS[cat] + "22", color: CAT_COLORS[cat], borderColor: CAT_COLORS[cat] + "66" }
                    : {}
                }
              >
                {CAT_LABELS[cat]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-zinc-600">
            {uploadCategory === "platform"
              ? "Platform feed · predicts escalator load ~60s ahead"
              : uploadCategory === "entrance"
              ? "Entrance feed · predicts escalator load ~90s ahead"
              : "Escalator feed · real-time safety monitoring"}
          </p>
        </div>

        <label className="block">
          <span className="sr-only">Upload video</span>
          <input
            ref={fileInput}
            type="file"
            accept="video/*"
            onChange={handleUpload}
            disabled={loading}
            className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-700 disabled:opacity-50"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
