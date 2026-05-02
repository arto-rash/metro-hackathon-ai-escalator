"""Train per-station Prophet models on 15-min ridership and emit a forecast JSON.

Output: frontend/public/station_model.json (schema v2)

Pipeline (one Prophet fit per station, parallelised across CPU cores):
  1. Read the 15-min CSV → pandas DataFrame.
  2. For each of the 27 stations: fit Prophet with linear trend +
     weekly + yearly + custom high-Fourier daily seasonality + AZ
     national holidays, additive mode (handles the night-time zeros
     cleanly) and a moderate changepoint prior.
  3. Forecast `FORECAST_DAYS` ahead at 15-min resolution.
  4. Compute a historical-average `by_dow_bin[7][96]` so the frontend
     can fall back to it for any date outside the forecast window.

JSON schema (v2):
{
  "version": 2,
  "model": "prophet",
  "bins_per_day": 96,
  "trained_from": "YYYY-MM-DD",
  "trained_to":   "YYYY-MM-DD",
  "forecast_from":"YYYY-MM-DD",
  "forecast_to":  "YYYY-MM-DD",
  "forecast_horizon_days": <int>,
  "stations": {
    "<id>": {
      "name": "<Azerbaijani>",
      "p95_15min": <float>,                # density normaliser
      "by_dow_bin": [[int;96];7],          # historical fallback (dow 0=Sun)
      "forecast": {                         # Prophet predictions
        "YYYY-MM-DD": [int; 96],
        ...
      }
    }
  }
}
"""
from __future__ import annotations

import json
import logging
import os
import sys
import time
import warnings
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import timedelta
from pathlib import Path

# Silence Prophet/Stan/cmdstanpy chatter — they print a line per fit otherwise.
os.environ.setdefault("CMDSTANPY_LOG_LEVEL", "ERROR")
logging.getLogger("prophet").setLevel(logging.ERROR)
logging.getLogger("cmdstanpy").setLevel(logging.ERROR)
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from prophet import Prophet

ROOT = Path(__file__).resolve().parent.parent.parent
CSV_PATH = ROOT / "backend" / "data" / "total_data_15min.csv"
OUT_PATH = ROOT / "frontend" / "public" / "station_model.json"

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

BINS_PER_DAY = 96
FORECAST_DAYS = 120  # ~4 months forward — frontend date picker stays within this
N_WORKERS = max(1, min(8, (os.cpu_count() or 4) - 1))

# Metro operates 06:00–00:00. Outside that window we force ridership to 0 so
# Prophet's smooth seasonality doesn't leak phantom passengers into closed
# hours. Bins 0–3 (00:00–00:45) keep their predicted value because trains in
# motion still drop passengers during that tail.
CLOSED_BIN_START = 4    # 01:00 — first fully-closed slot
CLOSED_BIN_END   = 24   # 06:00 — first open slot (exclusive end of closed range)


def _clamp_operating_hours(row: list[float]) -> list[float]:
    """Zero out bins for the closed window 01:00–06:00 in-place and return row."""
    for b in range(CLOSED_BIN_START, CLOSED_BIN_END):
        row[b] = 0.0
    return row


def _fit_one(args: tuple[str, str, str, list[tuple[str, float]]]) -> tuple[str, dict]:
    """Worker: fit Prophet for a single station and return its model entry.

    args = (sid, az_name, csv_name, [(iso_ds, y), ...])
    Returns (sid, station_entry_dict).
    """
    # Re-silence inside the worker process.
    logging.getLogger("prophet").setLevel(logging.ERROR)
    logging.getLogger("cmdstanpy").setLevel(logging.ERROR)
    warnings.filterwarnings("ignore")

    sid, az_name, _csv_name, rows = args
    if not rows:
        return sid, {
            "name": az_name,
            "p95_15min": 1.0,
            "by_dow_bin": [[0] * BINS_PER_DAY for _ in range(7)],
            "forecast": {},
        }

    df = pd.DataFrame(rows, columns=["ds", "y"])
    df["ds"] = pd.to_datetime(df["ds"])
    df = df.sort_values("ds").reset_index(drop=True)
    # Three-way conditional daily curves (weekday / Saturday / Sunday). Saturday
    # is ~1.7x Sunday at most stations, so a single "weekend" curve pulled
    # Sunday morning up toward Saturday's level. Splitting them lets each day
    # type have its own AM/PM shape.
    dow = df["ds"].dt.dayofweek                       # Mon=0..Sun=6
    df["is_weekday"] = (dow < 5).astype(int)
    df["is_saturday"] = (dow == 5).astype(int)
    df["is_sunday"] = (dow == 6).astype(int)

    m = Prophet(
        growth="linear",
        daily_seasonality=False,
        weekly_seasonality=False,
        yearly_seasonality=False,
        seasonality_mode="additive",           # additive lets weekly's Sun drop cancel
                                               # the daily peak cleanly; multiplicative
                                               # only does partial cancellation.
        changepoint_prior_scale=0.08,          # ↑ trend flexibility (default 0.05)
        seasonality_prior_scale=15.0,          # ↑ seasonality strength (default 10)
        holidays_prior_scale=20.0,             # ↑ holiday spikes/dips (default 10)
        n_changepoints=40,                     # ↑ from default 25
        interval_width=0.8,
    )
    # Three conditional daily seasonalities — each day-group has its own shape.
    m.add_seasonality(name="daily_wd",  period=1, fourier_order=12,
                      prior_scale=15.0, condition_name="is_weekday")
    m.add_seasonality(name="daily_sat", period=1, fourier_order=10,
                      prior_scale=15.0, condition_name="is_saturday")
    m.add_seasonality(name="daily_sun", period=1, fourier_order=10,
                      prior_scale=15.0, condition_name="is_sunday")
    m.add_seasonality(name="weekly",  period=7,      fourier_order=8,  prior_scale=15.0)
    m.add_seasonality(name="monthly", period=30.5,   fourier_order=8,  prior_scale=10.0)
    m.add_seasonality(name="yearly",  period=365.25, fourier_order=20, prior_scale=15.0)
    try:
        m.add_country_holidays(country_name="AZ")
    except Exception:
        pass

    m.fit(df)

    last_ds = df["ds"].iloc[-1]
    future_start = last_ds + timedelta(minutes=15)
    horizon_periods = FORECAST_DAYS * BINS_PER_DAY
    future = pd.DataFrame(
        {"ds": pd.date_range(start=future_start, periods=horizon_periods, freq="15min")}
    )
    fdow = future["ds"].dt.dayofweek
    future["is_weekday"]  = (fdow < 5).astype(int)
    future["is_saturday"] = (fdow == 5).astype(int)
    future["is_sunday"]   = (fdow == 6).astype(int)
    fcst = m.predict(future)
    # Keep one decimal so density % can resolve sub-1% differences between
    # similar dates (rounding to int collapsed near-identical days into the
    # same number on the dashboard).
    yhat = np.clip(fcst["yhat"].to_numpy(), 0, None).round(1)
    ds_arr = fcst["ds"].to_numpy()

    forecast_by_date: dict[str, list[float]] = {}
    for ds, y in zip(ds_arr, yhat):
        ts = pd.Timestamp(ds)
        ymd = ts.strftime("%Y-%m-%d")
        b = (ts.hour * 60 + ts.minute) // 15
        slot = forecast_by_date.get(ymd)
        if slot is None:
            slot = [0.0] * BINS_PER_DAY
            forecast_by_date[ymd] = slot
        slot[b] = float(y)
    for row in forecast_by_date.values():
        _clamp_operating_hours(row)

    # Historical fallback: average per (dow_js, bin) over actuals.
    sums = np.zeros((7, BINS_PER_DAY), dtype=np.float64)
    counts = np.zeros((7, BINS_PER_DAY), dtype=np.int64)
    ds_pd = df["ds"]
    dow_js = (ds_pd.dt.weekday + 1) % 7
    bin_idx = (ds_pd.dt.hour * 60 + ds_pd.dt.minute) // 15
    for d, b, y in zip(dow_js.to_numpy(), bin_idx.to_numpy(), df["y"].to_numpy()):
        sums[d, b] += y
        counts[d, b] += 1
    with np.errstate(invalid="ignore", divide="ignore"):
        avg = np.where(counts > 0, sums / np.maximum(counts, 1), 0.0)
    avg[:, CLOSED_BIN_START:CLOSED_BIN_END] = 0.0
    by_dow_bin = avg.round().astype(int).tolist()

    # p95 normaliser uses the union of historical avgs and forecast values, so
    # the density colour ramp doesn't blow out on an unseen rush hour.
    flat = avg.flatten().tolist() + [float(v) for row in forecast_by_date.values() for v in row]
    flat.sort()
    p95 = flat[int(0.95 * (len(flat) - 1))] if flat else 1.0
    p95 = max(float(p95), 1.0)

    return sid, {
        "name": az_name,
        "p95_15min": round(p95, 1),
        "by_dow_bin": by_dow_bin,
        "forecast": forecast_by_date,
    }


def main() -> None:
    t0 = time.time()
    print(f"Reading {CSV_PATH} ...")
    df_all = pd.read_csv(CSV_PATH, usecols=["station", "time_bin", "passenger_count"])
    df_all["ds"] = pd.to_datetime(df_all["time_bin"])
    df_all["y"] = df_all["passenger_count"].astype(float)
    print(f"  {len(df_all):,} rows, {df_all['ds'].min()} → {df_all['ds'].max()}")

    first_ds = df_all["ds"].min()
    last_ds = df_all["ds"].max()
    forecast_start = (last_ds + timedelta(minutes=15)).date()
    forecast_end = (last_ds + timedelta(days=FORECAST_DAYS)).date()

    # Pre-slice into per-station row lists so each worker gets just its data.
    jobs: list[tuple[str, str, str, list[tuple[str, float]]]] = []
    for csv_name, (sid, az) in NAME_MAP.items():
        sub = df_all[df_all["station"] == csv_name][["ds", "y"]]
        rows = [(ts.isoformat(), float(y)) for ts, y in zip(sub["ds"], sub["y"])]
        jobs.append((sid, az, csv_name, rows))
        if not rows:
            print(f"  WARN: {csv_name} has no rows in CSV")
    del df_all  # free memory before forking workers

    print(f"Fitting {len(jobs)} Prophet models on {N_WORKERS} workers...")
    stations: dict[str, dict] = {}
    with ProcessPoolExecutor(max_workers=N_WORKERS) as pool:
        futures = {pool.submit(_fit_one, job): job[0] for job in jobs}
        done = 0
        for fut in as_completed(futures):
            sid = futures[fut]
            try:
                sid, entry = fut.result()
                stations[sid] = entry
            except Exception as e:
                print(f"  ERROR fitting {sid}: {e}", file=sys.stderr)
                stations[sid] = {
                    "name": dict((s, az) for s, az in [v for v in NAME_MAP.values()]).get(sid, sid),
                    "p95_15min": 1.0,
                    "by_dow_bin": [[0] * BINS_PER_DAY for _ in range(7)],
                    "forecast": {},
                }
            done += 1
            print(f"  [{done}/{len(jobs)}] {sid}  ({time.time() - t0:.1f}s elapsed)")

    # Preserve NAME_MAP ordering in the output for stable diffs.
    ordered = {sid: stations[sid] for _, (sid, _az) in NAME_MAP.items() if sid in stations}

    model = {
        "version": 2,
        "model": "prophet",
        "bins_per_day": BINS_PER_DAY,
        "trained_from": first_ds.date().isoformat(),
        "trained_to": last_ds.date().isoformat(),
        "forecast_from": forecast_start.isoformat(),
        "forecast_to": forecast_end.isoformat(),
        "forecast_horizon_days": FORECAST_DAYS,
        "stations": ordered,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")))
    elapsed = time.time() - t0
    print()
    print(f"Wrote {OUT_PATH}")
    print(f"  size:     {OUT_PATH.stat().st_size:,} bytes")
    print(f"  trained:  {model['trained_from']} → {model['trained_to']}")
    print(f"  forecast: {model['forecast_from']} → {model['forecast_to']}  ({FORECAST_DAYS} days)")
    print(f"  stations: {len(model['stations'])}")
    print(f"  total:    {elapsed:.1f}s")


if __name__ == "__main__":
    main()
