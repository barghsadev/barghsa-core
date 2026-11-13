#!/usr/bin/env python3
"""Report actual Playwright outcomes, rejecting failures, flakes and missing results."""
import argparse
import json
import os
from pathlib import Path

from browser_workflow_identity import PROJECTS, SHARDS, run_identity


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


def check_shard(document, project, shard):
    config = document.get("config")
    if not isinstance(config, dict):
        raise ValueError("Missing Playwright configuration")
    projects = config.get("filteredProjects")
    selected = config.get("shard")
    if (
        not isinstance(projects, list) or len(projects) != 1
        or not isinstance(projects[0], dict) or projects[0].get("name") != project
        or not isinstance(selected, dict)
        or type(selected.get("current")) is not int or selected["current"] != shard
        or type(selected.get("total")) is not int or selected["total"] != len(SHARDS)
    ):
        raise ValueError("Playwright configuration does not match the expected browser shard")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--project", choices=PROJECTS)
    parser.add_argument("--shard", type=int, choices=SHARDS)
    args = parser.parse_args()
    if (args.project is None) != (args.shard is None):
        parser.error("Supply both --project and --shard for a nightly shard report")
    try:
        document = json.loads(args.input.read_text())
        report = summarize(document)
        if args.project is not None:
            check_shard(document, args.project, args.shard)
            report.update(run_identity(os.environ), project=args.project, shard=args.shard)
    except (OSError, ValueError):
        report = {"schema_version": 1, "status": "invalid", "flaky": None}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    message = (f"Browser outcomes: {report['expected']} expected, {report['unexpected']} unexpected, "
               f"{report['flaky']} flaky, {report['skipped']} skipped; {report['runner_errors']} runner errors."
               if report["status"] != "invalid" else "Browser results unavailable, invalid or mismatched; runtime flakes unknown.")
    print(f"::{'notice' if report['status'] == 'passed' else 'error'}::{message}")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(f"### Browser outcomes\n\n{message}\n")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
