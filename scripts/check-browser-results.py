#!/usr/bin/env python3
"""Report actual Playwright outcomes, rejecting failures, flakes and missing results."""
import argparse
import json
import os
from pathlib import Path


def summarize(document):
    if not isinstance(document, dict) or not isinstance(document.get("stats"), dict):
        raise ValueError("missing Playwright stats")
    stats = document["stats"]
    for name in ("expected", "unexpected", "flaky", "skipped"):
        if type(stats.get(name)) is not int or stats[name] < 0:
            raise ValueError("invalid Playwright outcome counts")
    errors = document.get("errors")
    if not isinstance(errors, list):
        raise ValueError("missing Playwright errors")
    passed = stats["expected"] > 0 and stats["unexpected"] == 0 and stats["flaky"] == 0 and not errors
    return {"schema_version": 1, "status": "passed" if passed else "failed",
            **{name: stats[name] for name in ("expected", "unexpected", "flaky", "skipped")},
            "runner_errors": len(errors)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    try:
        report = summarize(json.loads(args.input.read_text()))
    except (OSError, ValueError):
        report = {"schema_version": 1, "status": "invalid", "flaky": None}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    message = (f"Browser outcomes: {report['expected']} expected, {report['unexpected']} unexpected, "
               f"{report['flaky']} flaky, {report['skipped']} skipped; {report['runner_errors']} runner errors."
               if report["status"] != "invalid" else "Browser results unavailable or invalid; runtime flakes unknown.")
    print(f"::{'notice' if report['status'] == 'passed' else 'error'}::{message}")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(f"### Browser outcomes\n\n{message}\n")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
