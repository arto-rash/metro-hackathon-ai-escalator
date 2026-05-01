"""Video analyzer: YOLOv8 person + bag detection, IoU tracking, risk scoring.

Single small model (yolov8n.pt) shared for two passes:
- persons (class 0): the head bbox is approximated as the top portion of the
  person bbox (per the standard `head ≈ top 30%` heuristic), since YOLOv8n
  is not trained on a 'head' class.
- bags (24 backpack, 26 handbag, 28 suitcase): used for "stuff on escalator".
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import AsyncIterator

import cv2
import numpy as np

from .risk import FrameRisk, RiskEngine
from .tracker import Detection, IoUTracker, ObjectTracker


_MODEL = None
_MODEL_LOCK = asyncio.Lock()

_HEAD_FRACTION = 0.30  # head ≈ top 30% of person bbox
_HEAD_NARROW = 0.65    # narrow head bbox to 65% of person width

_STUFF_CLASSES = {24: "backpack", 26: "handbag", 28: "suitcase"}


async def _get_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    async with _MODEL_LOCK:
        if _MODEL is None:
            from ultralytics import YOLO
            _MODEL = YOLO("yolov8n.pt")
    return _MODEL


def _head_bbox_from_person(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = bbox
    h = y2 - y1
    w = x2 - x1
    cx = (x1 + x2) / 2.0
    half = w * _HEAD_NARROW / 2.0
    return (cx - half, y1, cx + half, y1 + h * _HEAD_FRACTION)


def _person_inside(person_bbox: tuple[float, float, float, float], obj_bbox: tuple[float, float, float, float]) -> bool:
    x1, y1, x2, y2 = obj_bbox
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    return person_bbox[0] <= cx <= person_bbox[2] and person_bbox[1] <= cy <= person_bbox[3]


def frame_risk_to_dict(fr: FrameRisk) -> dict:
    return {
        "frame_idx": fr.frame_idx,
        "timestamp": round(fr.timestamp, 3),
        "person_count": fr.person_count,
        "density": round(fr.density, 3),
        "lane_directions": fr.lane_directions,
        "lanes": fr.lanes,
        "frame_width": fr.frame_width,
        "frame_height": fr.frame_height,
        "risk_score": round(fr.risk_score, 1),
        "dominant_signal": fr.dominant_signal,
        "alerts": [
            {
                "id": a.id,
                "signal": a.signal,
                "track_id": a.track_id,
                "severity": a.severity,
                "message": a.message,
            }
            for a in fr.alerts
        ],
        "persons": [
            {
                "track_id": p.track_id,
                "bbox": [round(c, 1) for c in p.bbox],
                "head_bbox": [round(c, 1) for c in p.head_bbox] if p.head_bbox else None,
                "lane": p.lane,
                "risk": round(p.risk, 3),
                "flags": p.flags,
            }
            for p in fr.persons
        ],
        "objects": [
            {
                "track_id": o.track_id,
                "bbox": [round(c, 1) for c in o.bbox],
                "cls": o.cls,
                "stationary": o.stationary,
            }
            for o in fr.objects
        ],
    }


class VideoAnalyzer:
    def __init__(
        self,
        video_path: Path,
        stride: int = 2,
        confidence: float = 0.35,
        capacity: int = 12,
    ) -> None:
        self.video_path = video_path
        self.stride = max(1, stride)
        self.confidence = confidence
        self.capacity = capacity

    def open_capture(self) -> tuple[cv2.VideoCapture, dict]:
        cap = cv2.VideoCapture(str(self.video_path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Cannot open video: {self.video_path}")
        meta = {
            "fps": cap.get(cv2.CAP_PROP_FPS) or 25.0,
            "frame_count": int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0),
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0),
        }
        return cap, meta

    async def stream(self) -> AsyncIterator[dict]:
        model = await _get_model()
        cap, meta = self.open_capture()
        engine = RiskEngine(
            fps=meta["fps"] / self.stride,
            frame_width=meta["width"],
            frame_height=meta["height"],
            capacity=self.capacity,
        )
        person_tracker = IoUTracker()
        object_tracker = ObjectTracker()

        yield {
            "type": "meta",
            **meta,
            "stride": self.stride,
            "lanes": engine.lanes,
            "lane_separators": [
                [[round(tx, 4), round(ty, 4)], [round(bx, 4), round(by, 4)]]
                for (tx, ty), (bx, by) in engine.lane_separators
            ],
        }

        try:
            frame_idx = 0
            processed = 0
            while True:
                ok, frame = cap.read()
                if not ok:
                    break
                frame_idx += 1
                if (frame_idx - 1) % self.stride != 0:
                    continue

                detections, obj_dets = await asyncio.to_thread(self._detect, model, frame)
                tracks = person_tracker.update(detections)
                obj_tracks = object_tracker.update(obj_dets)
                fr = engine.evaluate(processed, tracks, obj_tracks)
                processed += 1
                yield {"type": "frame", **frame_risk_to_dict(fr)}

                await asyncio.sleep(0)
        finally:
            cap.release()
            yield {"type": "done", "processed_frames": processed}

    def _detect(self, model, frame: np.ndarray) -> tuple[list[Detection], list[tuple[tuple[float, float, float, float], str]]]:
        person_result = model.predict(frame, classes=[0], conf=self.confidence, verbose=False)[0]
        detections: list[Detection] = []
        if person_result.boxes is not None and len(person_result.boxes) > 0:
            for row in person_result.boxes.xyxy.cpu().numpy():
                bbox = tuple(float(v) for v in row)
                detections.append(Detection(bbox=bbox, head_bbox=_head_bbox_from_person(bbox)))

        obj_result = model.predict(frame, classes=list(_STUFF_CLASSES.keys()), conf=0.4, verbose=False)[0]
        objects: list[tuple[tuple[float, float, float, float], str]] = []
        if obj_result.boxes is not None and len(obj_result.boxes) > 0:
            xyxy = obj_result.boxes.xyxy.cpu().numpy()
            cls_arr = obj_result.boxes.cls.cpu().numpy()
            for row, cls_id in zip(xyxy, cls_arr):
                bbox = tuple(float(v) for v in row)
                cls_name = _STUFF_CLASSES.get(int(cls_id), "object")
                if any(_person_inside(d.bbox, bbox) for d in detections):
                    continue
                objects.append((bbox, cls_name))

        return detections, objects
