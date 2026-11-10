#!/usr/bin/env python3
"""Validate quarantine records and report known flakes without inferring test results."""

import argparse
from datetime import date, datetime, timezone
from html import escape
import json
import os
from pathlib import Path, PurePosixPath
import re


def valid_text(value):
    return isinstance(value, str) and value.strip() and not any(ord(c) < 32 for c in value)


def test_identity(record, prefix):
    for key in ('testPath', 'testName'):
        if not valid_text(record.get(key)):
            raise ValueError(f'{prefix}: invalid {key}')
    value = record['testPath']
    path = PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or '\\' in value or str(path) != value or not path.parts:
        raise ValueError(f'{prefix}: testPath must be a normalized relative path')
    return value, record['testName'].strip()


def evaluate(registry, today, *, promotion=False):
    if not isinstance(registry, dict) or type(registry.get("version")) is not int or registry["version"] != 1:
        raise ValueError("registry version must be 1")
    records = registry.get("quarantined")
    if not isinstance(records, list):
        raise ValueError("quarantined must be an array")
    seen = set()
    coverage_tests = set()
    details = []
    active = expired = critical_active = critical_expired = 0
    for index, record in enumerate(records):
        prefix = f"record {index + 1}"
        if not isinstance(record, dict):
            raise ValueError(f"{prefix}: must be an object")
        for key in ("owner", "issueUrl", "quarantineDate", "expiryDate", "severity", "reason"):
            if not valid_text(record.get(key)):
                raise ValueError(f"{prefix}: invalid {key}")
        identity = test_identity(record, prefix)
        if identity in seen:
            raise ValueError(f"{prefix}: duplicate test")
        seen.add(identity)
        if not re.fullmatch(r"@[A-Za-z0-9][A-Za-z0-9-]*(?:/[A-Za-z0-9][A-Za-z0-9_-]*)?", record["owner"]):
            raise ValueError(f"{prefix}: owner must be a GitHub user or team")
        if not re.fullmatch(r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/issues/[1-9][0-9]*", record["issueUrl"]):
            raise ValueError(f"{prefix}: issueUrl must be a GitHub issue URL")
        if record["severity"] not in ("critical", "non-critical"):
            raise ValueError(f"{prefix}: severity must be critical or non-critical")
        coverage = record.get('temporaryCoverage')
        if not isinstance(coverage, dict) or not valid_text(coverage.get('rationale')):
            raise ValueError(f'{prefix}: record the equivalent temporary coverage and rationale')
        coverage_identity = test_identity(coverage, f'{prefix} temporaryCoverage')
        coverage_tests.add(coverage_identity)
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
            critical_active += record["severity"] == "critical"
        details.append({
            'test_path': identity[0],
            'test_name': identity[1],
            'owner': record['owner'],
            'issue_url': record['issueUrl'],
            'severity': record['severity'],
            'expiry_date': end.isoformat(),
            'state': 'expired' if end < today else 'active',
            'days_in_quarantine': (today - start).days,
            'coverage_test_path': coverage_identity[0],
            'coverage_test_name': coverage_identity[1],
        })
    if seen & coverage_tests:
        raise ValueError('Temporary coverage must use an independent test outside quarantine')
    return {
        "schema_version": 1,
        "date_utc": today.isoformat(),
        "promotion_check": promotion,
        "status": "blocked" if critical_expired or (promotion and critical_active) else "passed",
        "registered_count": len(records),
        "active_quarantine_count": active,
        "active_critical_count": critical_active,
        "expired_quarantine_count": expired,
        "expired_critical_count": critical_expired,
        "quarantines": details,
        "observed_runtime_flake_count": None,
    }


def summary_lines(report, message):
    lines = ['### Flaky-test quarantine', '', message]
    rows = report.get('quarantines', [])
    if not rows:
        return lines
    lines += ['', '| Test | Owner | State | Days | Expiry | Temporary coverage |',
              '| --- | --- | --- | ---: | --- | --- |']

    def code(value):
        return f"<code>{escape(value).replace('|', '&#124;')}</code>"

    for row in rows:
        test = code(f"{row['test_path']} · {row['test_name']}")
        coverage = code(f"{row['coverage_test_path']} · {row['coverage_test_name']}")
        lines.append(f"| {test} | {code(row['owner'])} | {row['state']} | "
                     f"{row['days_in_quarantine']} | {row['expiry_date']} | {coverage} |")
    return lines


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=Path(__file__).with_name("quarantine-registry.json"))
    parser.add_argument("--report", type=Path, default=Path("flaky-test-report.json"))
    parser.add_argument("--promotion", action="store_true", help="Block release promotion while a critical test is quarantined")
    args = parser.parse_args()
    try:
        report = evaluate(json.loads(args.registry.read_text()), datetime.now(timezone.utc).date(),
                          promotion=args.promotion)
    except (OSError, ValueError) as error:
        # Do not echo registry content or arbitrary paths into workflow commands.
        report = {"schema_version": 1, "promotion_check": args.promotion, "status": "invalid", "error": type(error).__name__, "observed_runtime_flake_count": None}
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    valid = report["status"] != "invalid"
    if valid:
        message = (f"Known active quarantines: {report['active_quarantine_count']}; "
                   f"active critical: {report['active_critical_count']}; "
                   f"expired: {report['expired_quarantine_count']}; "
                   f"expired critical: {report['expired_critical_count']}. Runtime flakes: not measured.")
        if args.promotion and report["active_critical_count"]:
            message += " Release promotion requires clearing critical quarantines."
    else:
        message = "Quarantine registry unavailable or invalid. Counts unknown; repair registry before proceeding."
    level = "error" if report["status"] != "passed" else "notice"
    print(f"::{level}::{message}")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
            output.write('\n'.join(summary_lines(report, message)) + '\n')
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"quarantine_status={report['status']}\n")
            if valid:
                output.write(f"active_quarantine_count={report['active_quarantine_count']}\n")
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
