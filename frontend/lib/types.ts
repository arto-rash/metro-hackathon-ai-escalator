export type Direction = "up" | "down" | "unknown";

export type Signal = "fall" | "sitting" | "counterflow" | "facing_back" | "running" | "stuff" | "density";

export interface PersonRisk {
  track_id: number;
  bbox: [number, number, number, number];
  head_bbox: [number, number, number, number] | null;
  lane: number;
  risk: number;
  flags: string[];
}

export interface ObjectRisk {
  track_id: number;
  bbox: [number, number, number, number];
  cls: string;
  stationary: boolean;
}

export interface FrameAlert {
  id: string;
  signal: Signal;
  track_id: number;
  severity: "warn" | "danger";
  message: string;
}

export interface FrameEvent {
  type: "frame";
  frame_idx: number;
  timestamp: number;
  person_count: number;
  density: number;
  lane_directions: Direction[];
  lanes: number;
  frame_width: number;
  frame_height: number;
  risk_score: number;
  dominant_signal: Signal | null;
  alerts: FrameAlert[];
  persons: PersonRisk[];
  objects: ObjectRisk[];
}

export type LaneSeparator = [[number, number], [number, number]];

export interface MetaEvent {
  type: "meta";
  fps: number;
  frame_count: number;
  width: number;
  height: number;
  stride: number;
  lanes: number;
  lane_separators: LaneSeparator[];
}

export interface DoneEvent {
  type: "done";
  processed_frames: number;
}

export interface ErrorEvent {
  type: "error";
  message: string;
}

export type StreamEvent = FrameEvent | MetaEvent | DoneEvent | ErrorEvent;

export type VideoCategory = "escalator" | "platform" | "entrance";

export interface VideoItem {
  id: string;
  name: string;
  source: "sample" | "upload";
  size: number;
  category?: VideoCategory;
}
