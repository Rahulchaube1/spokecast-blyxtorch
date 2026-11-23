"""Reproduce the native BlyxTorch fit and its chronological holdout evaluation."""
import argparse
import csv
import hashlib
import io
import json
import math
import os
import random
import statistics
import subprocess
import urllib.request
import zipfile
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".build"
MODEL = ROOT / "model"
DATA_URL = "https://archive.ics.uci.edu/static/public/275/bike+sharing+dataset.zip"
HOUR_SHA = "e03de4ee4ef4dc376ac6e04bf829673c6269e8eba5c60fa121640fa2f829504f"
CUTOFF = "2012-11-01"
EPOCHS, BATCH, RATE, SEED = 35, 64, 0.003, 19


def run_to_file(command, output):
    with output.open("w") as stream:
        subprocess.run(command, stdout=stream, check=True)


def prepare_split(label, rows):
    raw = BUILD / f"{label}-raw.csv"
    with raw.open("w", newline="") as stream:
        writer = csv.writer(stream, lineterminator="\n")
        writer.writerow(["hour", "month", "workday", "weather", "celsius", "year_index", "count"])
        for row in rows:
            writer.writerow([row["hr"], row["mnth"], row["workingday"], row["weathersit"],
                             float(row["temp"]) * 47 - 8, row["yr"], row["cnt"]])
    result = BUILD / f"{label}.csv"
    run_to_file([BUILD / "prepare", raw], result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, help="Use an already downloaded UCI ZIP")
    args = parser.parse_args()
    BUILD.mkdir(exist_ok=True)
    archive = args.data or BUILD / "uci-bike-sharing.zip"
    if not archive.exists():
        urllib.request.urlretrieve(DATA_URL, archive)
    with zipfile.ZipFile(archive) as source:
        observations = source.read("hour.csv")
    if hashlib.sha256(observations).hexdigest() != HOUR_SHA:
        raise ValueError("The hourly series differs from the published training input")
    all_rows = list(csv.DictReader(io.StringIO(observations.decode("utf-8"))))
    rows = [r for r in all_rows if r["weathersit"] in {"1", "2", "3"}]
    training = [r for r in rows if r["dteday"] < CUTOFF]
    holdout = [r for r in rows if r["dteday"] >= CUTOFF]
    random.Random(SEED).shuffle(training)
    compiler = os.environ.get("BLYXC", "blyxc")
    for source_name, output_name in [("network", "trainer"), ("prepare", "prepare")]:
        subprocess.run([compiler, "build", MODEL / f"{source_name}.blyx", "-o", BUILD / output_name], check=True)
    train_csv = prepare_split("train", training)
    hold_csv = prepare_split("holdout", holdout)
    print(f"Fitting on {len(training):,} hours, reserving {len(holdout):,} for evaluation.", flush=True)
    checkpoint = BUILD / "trained.bt"
    run_to_file([BUILD / "trainer", "train", train_csv, str(EPOCHS), str(RATE), str(BATCH), "adam", str(SEED)], checkpoint)
    features_csv = BUILD / "holdout-features.csv"
    with hold_csv.open() as src, features_csv.open("w") as dst:
        for line in src:
            dst.write(line.rstrip().rsplit(",", 1)[0] + "\n")
    predictions_path = BUILD / "holdout-predictions.csv"
    run_to_file([BUILD / "trainer", "predict", checkpoint, features_csv], predictions_path)
    with predictions_path.open() as stream:
        predictions = [max(0.0, float(r[0]) * 1000) for r in list(csv.reader(stream))[1:]]
    actual = [int(r["cnt"]) for r in holdout]
    if len(predictions) != len(actual) or not all(map(math.isfinite, predictions)):
        raise ValueError("Missing or non-finite holdout predictions")
    history = defaultdict(list)
    for row in training:
        history[(row["hr"], row["workingday"])].append(int(row["cnt"]))
    baseline = [statistics.mean(history[(r["hr"], r["workingday"])]) for r in holdout]
    mean_y = statistics.mean(actual)
    errors = [p - y for p, y in zip(predictions, actual)]
    sse = sum(e ** 2 for e in errors)
    metrics = {
        "sourceRows": len(all_rows), "excludedSevereWeather": len(all_rows) - len(rows),
        "trainingRows": len(training), "testRows": len(holdout),
        "trainStart": min(r["dteday"] for r in training), "trainEnd": max(r["dteday"] for r in training),
        "testStart": holdout[0]["dteday"], "testEnd": holdout[-1]["dteday"],
        "mae": statistics.mean(abs(e) for e in errors), "rmse": math.sqrt(sse / len(actual)),
        "r2": 1 - sse / sum((y - mean_y) ** 2 for y in actual),
        "baselineMae": statistics.mean(abs(p - y) for p, y in zip(baseline, actual)),
        "architecture": [31, 16, 1], "epochs": EPOCHS, "batch": BATCH, "rate": RATE, "seed": SEED,
    }
    identity, csv_weights = checkpoint.read_text().splitlines()
    weights = list(map(float, csv_weights.split(",")))
    if identity != "BlyxTorch/1 31,16,1 mse relu" or len(weights) != 529 or not all(map(math.isfinite, weights)):
        raise ValueError("Unexpected checkpoint")
    # Keep the round-tripping precision of the checkpoint in valid Blyx literals.
    literals = [format(Decimal(repr(value)), "f") for value in weights]
    groups = [", ".join(literals[i:i+6]) for i in range(0, len(literals), 6)]
    (MODEL / "checkpoint.blyx").write_text("// Frozen native BlyxTorch checkpoint. Generated by scripts/train.py.\n"
                                         "pub fn spoke_weights() -> vector {\n    [\n        " +
                                         ",\n        ".join(groups) + "\n    ]\n}\n")
    (MODEL / "spokecast.bt").write_bytes(checkpoint.read_bytes())
    (ROOT / "dist" / "metrics.json").write_text(json.dumps(metrics, indent=2) + "\n")
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
