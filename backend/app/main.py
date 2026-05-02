"""FastAPI entrypoint: upload, list, stream, serve videos, and self-learning feedback."""
from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
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

# Explicit origins always allowed (local dev). Production HTTPS origins are
# covered by allow_origin_regex so no env var is needed for typical Vercel deploys.
_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:8000",
    *[o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()],
]

app = FastAPI(title="MetroEscalator Risk Analyzer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=r"https://.*",   # covers Vercel, Render, and any other HTTPS host
    allow_methods=["*"],
    allow_headers=["*"],
)


_VALID_CATEGORIES = {"escalator", "platform", "entrance"}


def _meta_path(video_id: str) -> Path:
    return UPLOAD_DIR / f"{video_id}.json"


def _get_category(video_id: str) -> str:
    p = _meta_path(video_id)
    if p.exists():
        try:
            return json.loads(p.read_text()).get("category", "escalator")
        except Exception:
            pass
    return "escalator"


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
                category = _get_category(path.stem) if source == "upload" else "escalator"
                items.append({"id": path.stem, "name": path.name, "source": source, "size": path.stat().st_size, "category": category})
    return {"videos": items}


@app.post("/api/videos/upload")
async def upload_video(file: UploadFile, category: str = Form("escalator")) -> dict:
    if category not in _VALID_CATEGORIES:
        category = "escalator"
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type {suffix!r}")
    video_id = uuid.uuid4().hex
    dest = UPLOAD_DIR / f"{video_id}{suffix}"
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    _meta_path(video_id).write_text(json.dumps({"category": category}))
    return {"id": video_id, "name": dest.name, "source": "upload", "size": dest.stat().st_size, "category": category}


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

    category = _get_category(video_id)
    mode = "count" if category in ("platform", "entrance") else "full"
    analyzer = VideoAnalyzer(path, stride=stride, capacity=capacity, mode=mode)
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
