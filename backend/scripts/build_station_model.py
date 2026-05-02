"""Aggregate the 15-min ridership CSV into a forecast model JSON consumed by the frontend.

Output: frontend/public/station_model.json

Schema:
{
  "version": 1,
  "bins_per_day": 96,
  "trained_from": "2025-01-01",
  "trained_to":   "2026-03-31",
  "stations": {
    "<id>": {
      "name": "<Azerbaijani name>",
      "p95_15min": <float>,           # 95th percentile of avg-counts (used as 100% density)
      "by_dow_bin": [[float;96];7],   # avg passenger count per (dow, 15-min bin); dow 0=Sunday (JS-aligned)
    },
    ...
  }
}
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH = ROOT / "backend" / "data" / "total_data_15min.csv"
OUT_PATH = ROOT / "frontend" / "public" / "station_model.json"

# CSV (English) -> (id, Azerbaijani display name)
NAME_MAP: dict[str, tuple[str, str]] = {
    "20 Yanvar":          ("20yanvar",   "20 Yanvar"),
    "28-May":             ("28may",      "28 May"),
    "8 Noyabr":           ("8noyabr",    "8 Noyabr"),
    "Akhmedli":           ("ahmedli",    "Əhmədli"),
    "Avtovaghzal":        ("avtovagzal", "Avtovağzal"),
    "Azadlig Prospekti":  ("azadliq",    "Azadlıq Prospekti"),
    "Bakmil":             ("bakmil",     "Bakmil"),
    "Darnagul":           ("dernegul",   "Dərnəgül"),
    "Elmlar Akademiyasi": ("elmler",     "Elmlər Akademiyası"),
    "Ganjlik":            ("genclik",    "Gənclik"),
    "Gara Garayev":       ("qaraqa",     "Qara Qarayev"),
    "Hazi Aslanov":       ("hezi",       "Həzi Aslanov"),
    "Icherisheher":       ("iceri",      "İçərişəhər"),
    "Inshaatchilar":      ("insaatci",   "İnşaatçılar"),
    "Jafar Jabbarli":     ("cefer",      "Cəfər Cabbarlı"),
    "Khalglar Dostlughu": ("xalqlar",    "Xalqlar Dostluğu"),
    "Khatai":             ("xetai",      "Şah İsmayıl Xətai"),
    "Khocasen":           ("xocesen",    "Xocəsən"),
    "Koroghlu":           ("koroglu",    "Koroğlu"),
    "Memar Ajami":        ("memar",      "Memar Əcəmi"),
    "Memar Ajami 2":      ("memar2",     "Memar Əcəmi-2"),
    "Nariman Narimanov":  ("neriman",    "Nəriman Nərimanov"),
    "Nasimi":             ("nesimi",     "Nəsimi"),
    "Neftchilar":         ("neftciler",  "Neftçilər"),
    "Nizami":             ("nizami",     "Nizami"),
    "Sahil":              ("sahil",      "Sahil"),
    "Ulduz":              ("ulduz",      "Ulduz"),
}

BINS_PER_DAY = 96  # 24h * 4 (15-min bins)


def main() -> None:
    # accumulator[sid][(dow, bin)] = (sum, n)
    acc: dict[str, dict[tuple[int, int], list[float]]] = defaultdict(
        lambda: defaultdict(lambda: [0.0, 0])
    )
    first_dt = last_dt = None

    with CSV_PATH.open() as f:
        r = csv.DictReader(f)
        for row in r:
            sname = row["station"]
            mapped = NAME_MAP.get(sname)
            if not mapped:
                continue
            sid = mapped[0]
            dt = datetime.fromisoformat(row["time_bin"])
            # Convert Python weekday (Mon=0..Sun=6) -> JS getDay (Sun=0..Sat=6)
            dow_js = (dt.weekday() + 1) % 7
            bin_15 = (dt.hour * 60 + dt.minute) // 15
            cnt = float(row["passenger_count"])
            entry = acc[sid][(dow_js, bin_15)]
            entry[0] += cnt
            entry[1] += 1
            if first_dt is None or dt < first_dt:
                first_dt = dt
            if last_dt is None or dt > last_dt:
                last_dt = dt

    model: dict = {
        "version": 1,
        "bins_per_day": BINS_PER_DAY,
        "trained_from": first_dt.date().isoformat() if first_dt else None,
        "trained_to": last_dt.date().isoformat() if last_dt else None,
        "stations": {},
    }

    for csv_name, (sid, az) in NAME_MAP.items():
        by_dow_bin: list[list[float]] = [[0.0] * BINS_PER_DAY for _ in range(7)]
        flat: list[float] = []
        for dow in range(7):
            for b in range(BINS_PER_DAY):
                s, n = acc[sid].get((dow, b), [0.0, 0])
                avg = (s / n) if n else 0.0
                by_dow_bin[dow][b] = round(avg, 1)
                flat.append(avg)
        flat_sorted = sorted(flat)
        p95 = flat_sorted[int(0.95 * (len(flat_sorted) - 1))] if flat_sorted else 1.0
        model["stations"][sid] = {
            "name": az,
            "p95_15min": round(max(p95, 1.0), 1),
            "by_dow_bin": by_dow_bin,
        }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")))
    print(f"Wrote {OUT_PATH}")
    print(f"  size: {OUT_PATH.stat().st_size:,} bytes")
    print(f"  range: {model['trained_from']} → {model['trained_to']}")
    print(f"  stations: {len(model['stations'])}")


if __name__ == "__main__":
    main()
