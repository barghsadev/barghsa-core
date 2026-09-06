#!/usr/bin/env python3
"""Validate quarantine records and report known flakes without inferring test results."""

import argparse
from datetime import date, datetime, timezone
import json
import os
from pathlib import Path, PurePosixPath
import re


def evaluate(registry, today):
    if not isinstance(registry, dict) or type(registry.get("version")) is not int or registry["version"] != 1:
        raise ValueError("registry version must be 1")
    records = registry.get("quarantined")
    if not isinstance(records, list):
        raise ValueError("quarantined must be an array")
    seen = set()
    active = expired = critical_expired = 0
    for index, record in enumerate(records):
        prefix = f"record {index + 1}"
        if not isinstance(record, dict):
            raise ValueError(f"{prefix}: must be an object")
        for key in ("testPath", "testName", "owner", "issueUrl", "quarantineDate", "expiryDate", "severity", "reason"):
            value = record.get(key)
            if not isinstance(value, str) or not value.strip() or any(ord(c) < 32 for c in value):
                raise ValueError(f"{prefix}: invalid {key}")
        path = PurePosixPath(record["testPath"])
        if path.is_absolute() or ".." in path.parts or "\\" in record["testPath"] or str(path) != record["testPath"]:
            raise ValueError(f"{prefix}: testPath must be a normalized relative path")
        identity = (record["testPath"], record["testName"].strip())
        if identity in seen:
            raise ValueError(f"{prefix}: duplicate test")
        seen.add(identity)
        if not re.fullmatch(r"@[A-Za-z0-9][A-Za-z0-9-]*(?:/[A-Za-z0-9][A-Za-z0-9_-]*)?", record["owner"]):
            raise ValueError(f"{prefix}: owner must be a GitHub user or team")
        if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[1-9][0-9]*", record["issueUrl"]):
            raise ValueError(f"{prefix}: issueUrl must be a GitHub issue URL")
        if record["severity"] not in ("critical", "non-critical"):
            raise ValueError(f"{prefix}: severity must be critical or non-critical")
        dates = []
        for key in ("quarantineDate", "expiryDate"):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", record[key]):
                raise ValueError(f"{prefix}: invalid {key}")
            try:
                dates.append(date.fromisoformat(record[key]))
            except ValueError:
                raise ValueError(f"{prefix}: invalid {key}") from None
        start, end = dates
        if start > today or not 0 < (end - start).days <= 30:
            raise ValueError(f"{prefix}: quarantine must start by today and expire within 1–30 days")
        if end < today:
            expired += 1
            critical_expired += record["severity"] == "critical"
        else:
            active += 1
    return {
        "schema_version": 1,
        "date_utc": today.isoformat(),
        "status": "blocked" if critical_expired else "passed",
        "registered_count": len(records),
        "active_quarantine_count": active,
        "expired_quarantine_count": expired,
        "expired_critical_count": critical_expired,
        "observed_runtime_flake_count": None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=Path(__file__).with_name("quarantine-registry.json"))
    parser.add_argument("--report", type=Path, default=Path("flaky-test-report.json"))
    args = parser.parse_args()
    try:
        report = evaluate(json.loads(args.registry.read_text()), datetime.now(timezone.utc).date())
    except (OSError, ValueError) as error:
        # Do not echo registry content or arbitrary paths into workflow commands.
        report = {"schema_version": 1, "status": "invalid", "error": type(error).__name__, "observed_runtime_flake_count": None}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    valid = report["status"] != "invalid"
    if valid:
        message = (f"Known active quarantines: {report['active_quarantine_count']}; "
                   f"expired: {report['expired_quarantine_count']}; "
                   f"expired critical: {report['expired_critical_count']}. Runtime flakes: not measured.")
    else:
        message = "Quarantine registry unavailable or invalid. Counts unknown; repair registry before proceeding."
    level = "error" if report["status"] != "passed" else "notice"
    print(f"::{level}::{message}")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write(f"### Flaky-test quarantine\n\n{message}\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"quarantine_status={report['status']}\n")
            if valid:
                output.write(f"active_quarantine_count={report['active_quarantine_count']}\n")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
