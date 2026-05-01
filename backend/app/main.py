"""FastAPI entrypoint: upload, list, stream, serve videos, and self-learning feedback."""
from __future__ import annotations

import json
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import learner
from .analyzer import VideoAnalyzer

BASE_DIR = Path(__file__).resolve().parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
SAMPLE_DIR = BASE_DIR / "videos"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}

app = FastAPI(title="MetroEscalator Risk Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_video(video_id: str) -> Path:
    for root in (UPLOAD_DIR, SAMPLE_DIR):
        for path in root.iterdir():
            if path.is_file() and path.stem == video_id and path.suffix.lower() in ALLOWED_EXTS:
                return path
    raise HTTPException(status_code=404, detail=f"Video '{video_id}' not found")


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/videos")
def list_videos() -> dict:
    items = []
    for root, source in ((SAMPLE_DIR, "sample"), (UPLOAD_DIR, "upload")):
        for path in sorted(root.iterdir()):
            if path.is_file() and path.suffix.lower() in ALLOWED_EXTS:
                items.append({"id": path.stem, "name": path.name, "source": source, "size": path.stat().st_size})
    return {"videos": items}


@app.post("/api/videos/upload")
async def upload_video(file: UploadFile) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type {suffix!r}")
    video_id = uuid.uuid4().hex
    dest = UPLOAD_DIR / f"{video_id}{suffix}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    return {"id": video_id, "name": dest.name, "source": "upload", "size": dest.stat().st_size}


@app.get("/api/videos/{video_id}/file")
def serve_video(video_id: str) -> FileResponse:
    path = _resolve_video(video_id)
    return FileResponse(path, media_type="video/mp4", filename=path.name)


class FeedbackBody(BaseModel):
    signal: str
    verdict: str  # "correct" | "incorrect"
    event_id: str | None = None


@app.get("/api/feedback")
def feedback_state() -> dict:
    return {"offsets": learner.get_offsets()}


@app.post("/api/feedback")
def submit_feedback(body: FeedbackBody) -> dict:
    try:
        offsets = learner.record_feedback(body.signal, body.verdict)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"offsets": offsets}


@app.post("/api/feedback/reset")
def reset_feedback() -> dict:
    return {"offsets": learner.reset()}


@app.websocket("/ws/analyze/{video_id}")
async def ws_analyze(
    ws: WebSocket,
    video_id: str,
    stride: int = 2,
    capacity: int = 12,
) -> None:
    await ws.accept()
    try:
        path = _resolve_video(video_id)
    except HTTPException as e:
        await ws.send_text(json.dumps({"type": "error", "message": e.detail}))
        await ws.close()
        return

    analyzer = VideoAnalyzer(path, stride=stride, capacity=capacity)
    try:
        async for event in analyzer.stream():
            await ws.send_text(json.dumps(event))
    except WebSocketDisconnect:
        return
    except Exception as e:  # noqa: BLE001
        await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
    finally:
        try:
            await ws.close()
        except RuntimeError:
            pass
