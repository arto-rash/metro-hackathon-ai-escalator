"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoItem } from "@/lib/types";
import { listVideos, uploadVideo } from "@/lib/api";

interface Props {
  selected: VideoItem | null;
  onSelect: (video: VideoItem) => void;
}

export function VideoSelector({ selected, onSelect }: Props) {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    try {
      setLoading(true);
      setError(null);
      const v = await listVideos();
      setVideos(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setLoading(true);
      const item = await uploadVideo(file);
      await refresh();
      onSelect(item);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  return (
    <div className="rounded-lg bg-zinc-900/60 p-4 ring-1 ring-zinc-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm uppercase tracking-wider text-zinc-400">Source</h2>
        <button
          onClick={refresh}
          className="text-xs text-zinc-500 hover:text-zinc-300"
          disabled={loading}
        >
          {loading ? "…" : "refresh"}
        </button>
      </div>

      <div className="mb-3 max-h-48 overflow-auto rounded border border-zinc-800">
        {videos.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-zinc-600">
            Drop videos in <code className="text-zinc-400">backend/videos/</code> or upload below.
          </div>
        ) : (
          <ul>
            {videos.map((v) => (
              <li key={v.id}>
                <button
                  onClick={() => onSelect(v)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-zinc-800 ${
                    selected?.id === v.id ? "bg-zinc-800/80 text-white" : "text-zinc-300"
                  }`}
                >
                  <span className="truncate">{v.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-zinc-500">{v.source}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <label className="block">
        <span className="sr-only">Upload video</span>
        <input
          ref={fileInput}
          type="file"
          accept="video/*"
          onChange={handleUpload}
          className="block w-full text-sm text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-zinc-200 hover:file:bg-zinc-700"
        />
      </label>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
