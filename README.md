# MetroEscalator — Risk Analyzer

Real-time fall, counterflow and overcrowding detection for metro escalator
camera footage. FastAPI + YOLOv8 backend streams per-frame analysis over
WebSocket to a Next.js dashboard with live bounding-box overlay, risk gauge
and alerts feed.

## Architecture

```
backend/                       FastAPI + YOLOv8 + OpenCV
  app/
    main.py                    REST + WebSocket endpoints
    analyzer.py                Frame loop: detect → track → score
    tracker.py                 IoU multi-object tracker (no deps)
    risk.py                    Fall / counterflow / density scoring
  videos/                      Drop sample .mp4 files here
  uploads/                     Browser-uploaded videos land here

frontend/                      Next.js 14 + Tailwind
  app/page.tsx                 Dashboard layout
  components/
    Analyzer.tsx               Video + overlay + WS client
    DetectionOverlay.tsx       Canvas bbox renderer synced to currentTime
    RiskGauge.tsx              0-100 dial
    StatPanel.tsx              Density / count / direction / time
    AlertsFeed.tsx             Live event log
    VideoSelector.tsx          Source picker + uploader
```

### How risk is computed

Per track, every frame:

| Signal       | Trigger                                                                 | Risk |
|--------------|-------------------------------------------------------------------------|------|
| Fall         | bbox aspect (h/w) collapses ≥35% from peak AND centroid drops vertically | 0.85+ |
| Counterflow  | track moves opposite the rolling crowd direction                         | 0.55  |
| Overcrowding | density (people / capacity) > 0.85                                       | 0.40+ |

The frame's risk score is `max(person_risk) * (1 + 0.3 * density)`, clipped to 100.

## Run

### Backend

```bash
cd backend
./run.sh             # creates .venv, installs deps, starts uvicorn on :8000
```

First request downloads `yolo26n.pt` (~5 MB) into the working dir.

Drop `.mp4` / `.mov` / `.avi` files into `backend/videos/` and they show up
in the source picker. Or upload through the UI.

### Frontend

```bash
cd frontend
cp .env.local.example .env.local   # adjust if backend runs elsewhere
npm install
npm run dev                        # http://localhost:3000
```

## Tuning

WebSocket query params on `/ws/analyze/{id}`:

- `stride` — process every Nth frame. Default `2`. Use `3-4` for slower hosts.
- `capacity` — expected max persons on the escalator. Drives the density signal.

Risk thresholds live in `backend/app/risk.py` — adjust the `0.35` aspect-drop
and `0.04` vertical-motion bounds in `_detect_fall()` if your camera angle
makes falls look different.

## Notes

- The YOLOv8 model class filter is locked to COCO id `0` (person). Adjust
  in `analyzer.py::VideoAnalyzer._detect_persons` if you want to flag
  bags/luggage too.
- The IoU tracker is intentionally simple and reliable for short-range
  escalator footage. For long occlusions, swap in BoT-SORT/ByteTrack.
- Frame events are buffered on the client and synced to `<video>.currentTime`,
  so scrubbing works as expected.
