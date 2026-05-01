"""Lightweight IoU-based multi-object tracker.

Tracks persons (with a derived head bbox) across frames using greedy IoU
matching. Sufficient for short-range escalator footage where motion between
processed frames is small.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from collections import deque
from typing import Deque, Optional


BBox = tuple[float, float, float, float]


def iou(a: BBox, b: BBox) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Detection:
    bbox: BBox
    head_bbox: Optional[BBox] = None
    facing_camera: Optional[bool] = None  # True / False / None=undetermined


@dataclass
class Track:
    track_id: int
    bbox: BBox
    last_seen: int
    age: int = 0
    head_bbox: Optional[BBox] = None
    facing_camera: Optional[bool] = None
    history: Deque[tuple[float, float]] = field(default_factory=lambda: deque(maxlen=24))
    aspect_history: Deque[float] = field(default_factory=lambda: deque(maxlen=18))

    def centroid(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    def aspect(self) -> float:
        x1, y1, x2, y2 = self.bbox
        w = max(1e-6, x2 - x1)
        h = max(1e-6, y2 - y1)
        return h / w


class IoUTracker:
    def __init__(self, iou_threshold: float = 0.3, max_missing: int = 12) -> None:
        self.iou_threshold = iou_threshold
        self.max_missing = max_missing
        self.tracks: dict[int, Track] = {}
        self._next_id = 1
        self._frame_idx = 0

    def update(self, detections: list[Detection]) -> list[Track]:
        self._frame_idx += 1
        unmatched_dets = set(range(len(detections)))
        matches: dict[int, int] = {}

        for tid, track in self.tracks.items():
            best_iou, best_idx = 0.0, -1
            for i in unmatched_dets:
                score = iou(track.bbox, detections[i].bbox)
                if score > best_iou:
                    best_iou, best_idx = score, i
            if best_idx >= 0 and best_iou >= self.iou_threshold:
                matches[tid] = best_idx
                unmatched_dets.discard(best_idx)

        for tid, det_idx in matches.items():
            det = detections[det_idx]
            track = self.tracks[tid]
            track.bbox = det.bbox
            track.head_bbox = det.head_bbox
            track.facing_camera = det.facing_camera
            track.last_seen = self._frame_idx
            track.age += 1
            track.history.append(track.centroid())
            track.aspect_history.append(track.aspect())

        for i in unmatched_dets:
            tid = self._next_id
            self._next_id += 1
            det = detections[i]
            t = Track(
                track_id=tid,
                bbox=det.bbox,
                head_bbox=det.head_bbox,
                facing_camera=det.facing_camera,
                last_seen=self._frame_idx,
                age=1,
            )
            t.history.append(t.centroid())
            t.aspect_history.append(t.aspect())
            self.tracks[tid] = t

        stale = [tid for tid, tr in self.tracks.items() if self._frame_idx - tr.last_seen > self.max_missing]
        for tid in stale:
            self.tracks.pop(tid, None)

        return list(self.tracks.values())


@dataclass
class ObjectTrack:
    track_id: int
    bbox: BBox
    cls: str
    last_seen: int
    age: int = 0


class ObjectTracker:
    def __init__(self, iou_threshold: float = 0.3, max_missing: int = 16) -> None:
        self.iou_threshold = iou_threshold
        self.max_missing = max_missing
        self.tracks: dict[int, ObjectTrack] = {}
        self._next_id = 1
        self._frame_idx = 0

    def update(self, detections: list[tuple[BBox, str]]) -> list[ObjectTrack]:
        self._frame_idx += 1
        unmatched = set(range(len(detections)))
        matches: dict[int, int] = {}
        for tid, tr in self.tracks.items():
            best, idx = 0.0, -1
            for i in unmatched:
                s = iou(tr.bbox, detections[i][0])
                if s > best:
                    best, idx = s, i
            if idx >= 0 and best >= self.iou_threshold:
                matches[tid] = idx
                unmatched.discard(idx)
        for tid, i in matches.items():
            self.tracks[tid].bbox = detections[i][0]
            self.tracks[tid].cls = detections[i][1]
            self.tracks[tid].last_seen = self._frame_idx
            self.tracks[tid].age += 1
        for i in unmatched:
            tid = self._next_id
            self._next_id += 1
            self.tracks[tid] = ObjectTrack(track_id=tid, bbox=detections[i][0], cls=detections[i][1], last_seen=self._frame_idx, age=1)
        stale = [tid for tid, tr in self.tracks.items() if self._frame_idx - tr.last_seen > self.max_missing]
        for tid in stale:
            self.tracks.pop(tid, None)
        return list(self.tracks.values())
