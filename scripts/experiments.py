"""Compare the shipped model with two training-only baselines on the final two months."""
import csv
import json
import math
import statistics
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".build"


def read_rows(name):
    path = BUILD / name
    if not path.is_file():
        raise SystemExit(f"Missing {name}. Run python3 scripts/train.py first.")
    with path.open(newline="") as source:
        return list(csv.DictReader(source))


def scores(actual, predicted):
    if not actual or len(actual) != len(predicted):
        raise ValueError("Every observation needs one prediction.")
    errors = [prediction - count for prediction, count in zip(predicted, actual)]
    square_error = math.fsum(error ** 2 for error in errors)
    average = statistics.mean(actual)
    variation = math.fsum((count - average) ** 2 for count in actual)
    return {
        "hours": len(actual),
        "mae": round(statistics.mean(map(abs, errors)), 6),
        "rmse": round(math.sqrt(square_error / len(actual)), 6),
        "r2": round(1 - square_error / variation, 6) if variation else None,
    }


def main():
    training = read_rows("train-raw.csv")
    holdout = read_rows("holdout-raw.csv")
    native = read_rows("holdout-predictions.csv")
    observed = [int(row["count"]) for row in holdout]
    predicted = [max(0.0, float(row["prediction0"]) * 1000) for row in native]
    by_hour = defaultdict(list)
    for row in training:
        by_hour[(row["hour"], row["workday"])].append(int(row["count"]))
    group_means = {key: statistics.mean(values) for key, values in by_hour.items()}
    global_mean = statistics.mean(int(row["count"]) for row in training)
    grouped = [group_means[(row["hour"], row["workday"])] for row in holdout]
    comparison = {
        "training_mean": scores(observed, [global_mean] * len(observed)),
        "hour_and_day_type_mean": scores(observed, grouped),
        "blyxtorch": scores(observed, predicted),
    }
    breakdown = {}
    for column, names in [("workday", {"1": "workday", "0": "weekend_or_holiday"}),
                          ("weather", {"1": "clear", "2": "mist", "3": "light_rain_or_snow"})]:
        breakdown[column] = {}
        for value, name in names.items():
            indexes = [i for i, row in enumerate(holdout) if row[column] == value]
            breakdown[column][name] = scores([observed[i] for i in indexes], [predicted[i] for i in indexes])
    trained = json.loads((ROOT / "dist/metrics.json").read_text())
    if not math.isclose(comparison["blyxtorch"]["mae"], trained["mae"], abs_tol=1e-6):
        raise ValueError("The experiment and the shipped model report different errors.")
    report = {
        "holdoutStart": trained["testStart"],
        "holdoutEnd": trained["testEnd"],
        "trainingHours": len(training),
        "holdoutHours": len(holdout),
        "comparison": comparison,
        "modelByGroup": breakdown,
    }
    result = json.dumps(report, indent=2) + "\n"
    path = ROOT / "experiments/holdout.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(result)
    print(result, end="")


if __name__ == "__main__":
    main()
