"""Risk scoring engine for escalator footage (head-only signals).

Per-signal base risk (0..1):
    fall          1.00   bbox aspect collapse + sudden vertical drop
    sitting       0.60   bbox aspect compressed + low motion (heuristic)
    counterflow   0.40   moves opposite to its lane's crowd direction
    facing_back   0.40   head orientation differs from lane majority
    running       0.60   speed exceeds running threshold
    stuff         0.40   bag persists on the escalator without an owner

facing_back uses a per-track / per-lane rolling history of `facing_camera`
(set by the haar-cascade in analyzer.py). Adapts to camera angle: anomaly
is whichever orientation differs from the local crowd, not a hard-coded
"facing camera = bad".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from collections import deque
from typing import Literal, Optional

from . import learner
from .tracker import ObjectTrack, Track


Direction = Literal["up", "down", "unknown"]

BASE_RISK = {
    "fall": 1.00,
    "sitting": 0.60,
    "counterflow": 0.40,
    "facing_back": 0.40,
    "running": 0.60,
    "stuff": 0.40,
}

# Lane separators in normalized image coords ([0..1] for both axes).
# Each entry is ((x_top, y_top), (x_bottom, y_bottom)). Y=0 is top of frame.
# N separators define N+1 lanes, ordered left-to-right.
# Edit this list to match the camera angle of a specific escalator. The
# default is a vanishing-point fan: bottoms at 1/8, 1/2, 7/8 width, all
# converging at top center (0.5, 0.0) — like an escalator viewed from below.
LaneSeparator = tuple[tuple[float, float], tuple[float, float]]

LANE_SEPARATORS: list[LaneSeparator] = [
    ((0.5, 0.0), (0.125, 1.0)),
    ((0.5, 0.0), (0.5, 1.0)),
    ((0.5, 0.0), (0.875, 1.0)),
]


@dataclass
class PersonRisk:
    track_id: int
    bbox: tuple[float, float, float, float]
    head_bbox: Optional[tuple[float, float, float, float]]
    lane: int
    risk: float
    flags: list[str]


@dataclass
class ObjectRisk:
    track_id: int
    bbox: tuple[float, float, float, float]
    cls: str
    stationary: bool


@dataclass
class Alert:
    id: str
    signal: str
    track_id: int
    severity: str
    message: str


@dataclass
class FrameRisk:
    frame_idx: int
    timestamp: float
    person_count: int
    density: float
    lane_directions: list[Direction]
    lanes: int
    frame_width: int
    frame_height: int
    risk_score: float
    dominant_signal: Optional[str]
    alerts: list[Alert]
    persons: list[PersonRisk]
    objects: list[ObjectRisk]


class RiskEngine:
    """Stateful per-stream risk evaluator."""

    def __init__(
        self,
        fps: float,
        frame_width: int,
        frame_height: int,
        capacity: int = 12,
        lane_separators: Optional[list[LaneSeparator]] = None,
    ) -> None:
        self.fps = max(fps, 1.0)
        self.frame_width = max(frame_width, 1)
        self.frame_height = max(frame_height, 1)
        self.capacity = capacity
        self.lane_separators: list[LaneSeparator] = list(lane_separators if lane_separators is not None else LANE_SEPARATORS)
        self.lanes = len(self.lane_separators) + 1
        window = max(int(self.fps * 3), 8)
        self._lane_dir: list[deque[float]] = [deque(maxlen=window) for _ in range(self.lanes)]
        self._active: dict[tuple[int, str], int] = {}
        self._density_active = False
        self._gap_frames = max(int(self.fps * 1.5), 3)
        facing_window = max(int(self.fps * 2.5), 12)
        self._track_facing: dict[int, deque[bool]] = {}
        self._lane_facing: list[deque[bool]] = [deque(maxlen=facing_window * self.lanes) for _ in range(self.lanes)]
        self._track_facing_window = facing_window

    def _onset(self, track_id: int, signal: str, frame_idx: int) -> bool:
        key = (track_id, signal)
        last = self._active.get(key)
        self._active[key] = frame_idx
        return last is None or (frame_idx - last) > self._gap_frames

    def _lane_for(self, x: float, y: float) -> int:
        nx = x / max(self.frame_width, 1)
        ny = y / max(self.frame_height, 1)
        lane = 0
        for (tx, ty), (bx, by) in self.lane_separators:
            denom = (by - ty) if (by - ty) != 0 else 1e-6
            sep_x = tx + (bx - tx) * (ny - ty) / denom
            if nx > sep_x:
                lane += 1
        if lane < 0:
            return 0
        if lane >= self.lanes:
            return self.lanes - 1
        return lane

    def _person_velocity(self, track: Track) -> tuple[float, float]:
        if len(track.history) < 2:
            return 0.0, 0.0
        (x0, y0), (x1, y1) = track.history[0], track.history[-1]
        dt = max(len(track.history) - 1, 1)
        return (x1 - x0) / dt, (y1 - y0) / dt

    def _direction_for(self, vy: float) -> Direction:
        if abs(vy) < 0.3:
            return "unknown"
        return "down" if vy > 0 else "up"

    def _detect_fall(self, track: Track, offset: float) -> tuple[bool, float]:
        if len(track.aspect_history) < 6:
            return False, 0.0
        recent = list(track.aspect_history)
        peak = max(recent[:-3]) if len(recent) > 3 else max(recent)
        current = recent[-1]
        if peak < 1.4:
            return False, 0.0
        ratio_drop = (peak - current) / peak
        if ratio_drop < 0.35 + offset:
            return False, 0.0

        vy_window = list(track.history)[-int(self.fps * 0.6):]
        if len(vy_window) < 2:
            return False, 0.0
        dy = vy_window[-1][1] - vy_window[0][1]
        norm_dy = dy / self.frame_height
        if norm_dy < 0.04 + offset * 0.5:
            return False, 0.0

        confidence = min(1.0, 0.4 + ratio_drop + norm_dy * 4)
        return True, confidence

    def _detect_sitting(self, track: Track, offset: float) -> tuple[bool, float]:
        """Conservative bbox-aspect sitting heuristic.

        Standing person has h/w ≥ ~2.0; a sitting person collapses to ~1.0.
        Require sustained low aspect AND low horizontal motion AND mature track
        — false positives on partially-occluded standing people are the main
        failure mode, so we keep the gate tight.
        """
        if track.age < self.fps * 1.5 or len(track.aspect_history) < 8:
            return False, 0.0
        recent = list(track.aspect_history)[-int(self.fps * 1.5):]
        if not recent:
            return False, 0.0
        mean_aspect = sum(recent) / len(recent)
        max_aspect = max(recent)
        threshold = 1.20 - offset * 0.5
        if mean_aspect >= threshold or max_aspect >= threshold + 0.7:
            return False, 0.0
        if len(track.history) >= 2:
            (x0, _), (x1, _) = track.history[0], track.history[-1]
            if abs(x1 - x0) / max(self.frame_width, 1) > 0.07:
                return False, 0.0
        confidence = max(0.0, min(1.0, (threshold - mean_aspect) / max(threshold, 0.2)))
        return True, 0.4 + 0.6 * confidence

    def _detect_facing_back(self, track: Track, lane: int, offset: float) -> tuple[bool, float]:
        """Lane-majority orientation anomaly.

        Each track maintains a rolling deque of facing_camera observations
        (True / False). Each lane keeps a pooled rolling deque of the same.
        Person is "facing the wrong way" when their fraction-facing-camera
        differs from the lane's by more than a threshold, sustained for ≥1s.
        Adapts to either camera angle (riders facing toward or away).
        """
        track_hist = self._track_facing.get(track.track_id)
        if track_hist is None or len(track_hist) < int(self.fps * 1.0):
            return False, 0.0
        lane_hist = self._lane_facing[lane]
        if len(lane_hist) < int(self.fps * 2.0):
            return False, 0.0

        track_fc = sum(1 for f in track_hist if f) / len(track_hist)
        lane_fc = sum(1 for f in lane_hist if f) / len(lane_hist)
        diff = abs(track_fc - lane_fc)
        threshold = 0.55 + offset * 0.4
        if diff < threshold:
            return False, 0.0
        # Don't flag the loner-in-an-empty-lane case.
        if 0.30 < lane_fc < 0.70:
            return False, 0.0
        confidence = min(1.0, (diff - threshold) / max(1.0 - threshold, 0.2) + 0.5)
        return True, confidence

    def evaluate(
        self,
        frame_idx: int,
        tracks: list[Track],
        obj_tracks: list[ObjectTrack],
    ) -> FrameRisk:
        timestamp = frame_idx / self.fps
        offsets = learner.get_offsets()
        persons: list[PersonRisk] = []
        alerts: list[Alert] = []

        live_ids = {tr.track_id for tr in tracks}
        for tid in [tid for tid in self._track_facing if tid not in live_ids]:
            self._track_facing.pop(tid, None)

        for tr in tracks:
            if tr.facing_camera is None:
                continue
            cx, cy = tr.centroid()
            lane = self._lane_for(cx, cy)
            hist = self._track_facing.setdefault(
                tr.track_id, deque(maxlen=self._track_facing_window)
            )
            hist.append(tr.facing_camera)
            self._lane_facing[lane].append(tr.facing_camera)

        for tr in tracks:
            _, vy = self._person_velocity(tr)
            cx, cy = tr.centroid()
            lane = self._lane_for(cx, cy)
            self._lane_dir[lane].append(vy)

        lane_directions: list[Direction] = []
        for window in self._lane_dir:
            if window:
                mean_vy = sum(window) / len(window)
                lane_directions.append(self._direction_for(mean_vy))
            else:
                lane_directions.append("unknown")

        density = min(1.0, len(tracks) / max(1, self.capacity))
        run_norm_unit = self.frame_height / max(self.fps, 1.0)

        max_risk = 0.0
        dominant_signal: Optional[str] = None

        for tr in tracks:
            vx, vy = self._person_velocity(tr)
            person_dir = self._direction_for(vy)
            cx, cy = tr.centroid()
            lane = self._lane_for(cx, cy)
            flags: list[str] = []
            risk = 0.0

            is_fall, fall_conf = self._detect_fall(tr, offsets["fall"])
            if is_fall:
                flags.append("fall")
                risk = max(risk, BASE_RISK["fall"] * (0.85 + 0.15 * fall_conf))
                if self._onset(tr.track_id, "fall", frame_idx):
                    alerts.append(Alert(
                        id=f"{frame_idx}-{tr.track_id}-fall",
                        signal="fall", track_id=tr.track_id, severity="danger",
                        message=f"Possible fall — track {tr.track_id}",
                    ))

            is_sit, sit_conf = self._detect_sitting(tr, offsets["sitting"])
            if is_sit:
                flags.append("sitting")
                risk = max(risk, BASE_RISK["sitting"] * (0.7 + 0.3 * sit_conf))
                if self._onset(tr.track_id, "sitting", frame_idx):
                    alerts.append(Alert(
                        id=f"{frame_idx}-{tr.track_id}-sitting",
                        signal="sitting", track_id=tr.track_id, severity="warn",
                        message=f"Sitting on escalator — track {tr.track_id}",
                    ))

            lane_dir = lane_directions[lane]
            if (
                lane_dir != "unknown"
                and person_dir != "unknown"
                and person_dir != lane_dir
                and tr.age > self.fps * 1.5
                and len(self._lane_dir[lane]) > self.fps * 1.5
            ):
                if abs(vy) > 0.6 + offsets["counterflow"] * 2.0:
                    flags.append("counterflow")
                    risk = max(risk, BASE_RISK["counterflow"])
                    if self._onset(tr.track_id, "counterflow", frame_idx):
                        alerts.append(Alert(
                            id=f"{frame_idx}-{tr.track_id}-counterflow",
                            signal="counterflow", track_id=tr.track_id, severity="warn",
                            message=f"Counterflow in lane {lane + 1} — track {tr.track_id}",
                        ))

            is_face, face_conf = self._detect_facing_back(tr, lane, offsets["facing_back"])
            if is_face:
                flags.append("facing_back")
                risk = max(risk, BASE_RISK["facing_back"] * (0.7 + 0.3 * face_conf))
                if self._onset(tr.track_id, "facing_back", frame_idx):
                    alerts.append(Alert(
                        id=f"{frame_idx}-{tr.track_id}-facing_back",
                        signal="facing_back", track_id=tr.track_id, severity="warn",
                        message=f"Facing backward on escalator — track {tr.track_id}",
                    ))

            speed_norm = (vx * vx + vy * vy) ** 0.5 / max(run_norm_unit, 1e-6)
            run_threshold = 1.4 + offsets["running"] * 3.0
            if speed_norm > run_threshold and tr.age > self.fps * 1.0:
                flags.append("running")
                risk = max(risk, BASE_RISK["running"] * min(1.0, 0.6 + (speed_norm - run_threshold) / max(run_threshold, 0.5)))
                if self._onset(tr.track_id, "running", frame_idx):
                    alerts.append(Alert(
                        id=f"{frame_idx}-{tr.track_id}-running",
                        signal="running", track_id=tr.track_id, severity="warn",
                        message=f"Running on escalator — track {tr.track_id}",
                    ))

            if risk > max_risk:
                max_risk = risk
                if flags:
                    dominant_signal = max(flags, key=lambda f: BASE_RISK.get(f, 0.0))

            persons.append(PersonRisk(
                track_id=tr.track_id,
                bbox=tr.bbox,
                head_bbox=tr.head_bbox,
                lane=lane,
                risk=min(risk, 1.0),
                flags=flags,
            ))

        objects: list[ObjectRisk] = []
        stuff_persistence_frames = max(int(self.fps * 1.0), 4)
        stuff_off = offsets["stuff"]
        stuff_threshold = stuff_persistence_frames + int(stuff_off * stuff_persistence_frames * 4)
        for ot in obj_tracks:
            stationary = ot.age >= stuff_threshold
            objects.append(ObjectRisk(track_id=ot.track_id, bbox=ot.bbox, cls=ot.cls, stationary=stationary))
            if stationary:
                stuff_risk = BASE_RISK["stuff"]
                if stuff_risk > max_risk:
                    max_risk = stuff_risk
                    dominant_signal = "stuff"
                if self._onset(-ot.track_id - 1, "stuff", frame_idx):
                    alerts.append(Alert(
                        id=f"{frame_idx}-obj{ot.track_id}-stuff",
                        signal="stuff", track_id=ot.track_id, severity="warn",
                        message=f"Item left on escalator ({ot.cls})",
                    ))

        if density > 0.9:
            if not self._density_active:
                alerts.append(Alert(
                    id=f"{frame_idx}-density",
                    signal="density", track_id=-1, severity="warn",
                    message="High density on escalator",
                ))
            self._density_active = True
        else:
            self._density_active = False

        risk_score = min(100.0, max_risk * 100.0 * (1.0 + 0.1 * density))

        return FrameRisk(
            frame_idx=frame_idx,
            timestamp=timestamp,
            person_count=len(tracks),
            density=density,
            lane_directions=lane_directions,
            lanes=self.lanes,
            frame_width=self.frame_width,
            frame_height=self.frame_height,
            risk_score=risk_score,
            dominant_signal=dominant_signal,
            alerts=alerts,
            persons=persons,
            objects=objects,
        )
