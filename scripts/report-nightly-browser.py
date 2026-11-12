#!/usr/bin/env python3
"""Summarize current browser shards and the previous seven days of scheduled runs."""
import argparse
import json
import os
from pathlib import Path


COUNTS = ("expected", "unexpected", "flaky", "skipped", "runner_errors")
PROJECTS = ("chromium", "firefox", "webkit", "mobile-chrome", "mobile-safari")
SHARDS = range(1, 9)


def read_json(path):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return None


def valid_counts(value):
    return isinstance(value, dict) and all(
        type(value.get(name)) is int and value[name] >= 0 for name in COUNTS
    )


def summarize_shards(directory):
    totals = dict.fromkeys(COUNTS, 0)
    missing, failed = [], []
    expected = len(PROJECTS) * len(SHARDS)
    for project in PROJECTS:
        for shard in SHARDS:
            name = f"browser-outcome-{project}-{shard}"
            result = read_json(directory / name / "browser-outcomes.json")
            if (
                not valid_counts(result)
                or result.get("schema_version") != 1
                or result.get("status") not in ("passed", "failed")
            ):
                missing.append(name)
                continue
            for key in COUNTS:
                totals[key] += result[key]
            if (
                result["status"] != "passed"
                or result["expected"] == 0
                or any(result[key] for key in ("unexpected", "flaky", "runner_errors"))
            ):
                failed.append(name)
    return {
        "schema_version": 1,
        "status": "incomplete" if missing else "failed" if failed else "passed",
        "expected_shards": expected,
        "reported_shards": expected - len(missing),
        "missing_or_invalid_shards": missing,
        "failed_shards": failed,
        "counts": totals,
    }


def history_lines(runs, directory):
    if not isinstance(runs, list):
        return ["Scheduled run history unavailable."]
    if not runs:
        return ["No completed scheduled runs in the previous seven days."]
    lines = [
        f"{sum(run['conclusion'] == 'success' for run in runs)} of {len(runs)} scheduled runs passed.",
        "",
        "| Run | Conclusion | Shards with results | Observed flaky cases | Active quarantines |",
        "| --- | --- | ---: | ---: | ---: |",
    ]
    for run in runs:
        run_id = int(run["databaseId"])
        receipt = read_json(directory / str(run_id) / "nightly-browser-summary.json")
        if (
            isinstance(receipt, dict)
            and receipt.get("schema_version") == 1
            and valid_counts(receipt.get("counts"))
            and type(receipt.get("reported_shards")) is int
            and type(receipt.get("expected_shards")) is int
            and 0 <= receipt["reported_shards"] <= receipt["expected_shards"]
        ):
            reported = receipt["reported_shards"]
            expected = receipt["expected_shards"]
            flakes = receipt["counts"]["flaky"] if reported else "Unknown"
            shards = f"{reported}/{expected}"
        else:
            shards, flakes = "Unavailable", "Unknown"
        quarantine = read_json(directory / str(run_id) / 'nightly-quarantine.json')
        active = 'Unknown'
        if (isinstance(quarantine, dict) and quarantine.get('schema_version') == 1
                and quarantine.get('status') in ('passed', 'blocked')
                and type(quarantine.get('active_quarantine_count')) is int
                and quarantine['active_quarantine_count'] >= 0):
            active = quarantine['active_quarantine_count']
        lines.append(f"| {run_id} | {run['conclusion']} | {shards} | {flakes} | {active} |")
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--outcomes", type=Path, required=True)
    parser.add_argument("--history", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--message", type=Path)
    args = parser.parse_args()
    current = summarize_shards(args.outcomes)
    args.report.write_text(json.dumps(current, indent=2) + "\n")
    coverage = f"{current['reported_shards']} of {current['expected_shards']} shards reported."
    observed = (
        ", ".join(f"{current['counts'][name]} {name.replace('_', ' ')}" for name in COUNTS)
        if current["reported_shards"]
        else "No observed outcome counts are available."
    )
    lines = [
        "### Nightly browser outcomes",
        "",
        f"Current result is **{current['status']}**. {coverage}",
        "",
        observed,
        "",
        "### Scheduled runs over the previous seven days",
        "",
        *history_lines(read_json(args.history / "runs.json"), args.history),
    ]
    message = "\n".join(lines) + "\n"
    print(message, end="")
    if args.message:
        args.message.write_text(message)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(message)
    return 0 if current["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
