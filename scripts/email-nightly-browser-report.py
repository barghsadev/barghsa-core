#!/usr/bin/env python3
"""Email the first attempt of a scheduled browser report and retain its provider receipt."""
import argparse
import hashlib
from http.client import HTTPSConnection, HTTPException
import json
import os
from pathlib import Path
import re

from browser_workflow_identity import PROJECTS, SHARDS, run_identity as browser_run_identity


MAX_MESSAGE = 24_000
MAX_RECEIPT = 8_192
EMAIL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z0-9-]+")
EMAIL_ID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", re.I)
CONCLUSIONS = {"success", "failure", "cancelled", "skipped"}


def run_identity(env):
    repository = env.get("GITHUB_REPOSITORY", "")
    run_id = env.get("GITHUB_RUN_ID", "")
    commit = env.get("GITHUB_SHA", "")
    if (
        env.get("GITHUB_EVENT_NAME") != "schedule"
        or env.get("GITHUB_RUN_ATTEMPT") != "1"
        or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9_.-]+", repository)
        or not re.fullmatch(r"[1-9][0-9]{0,19}", run_id)
        or not re.fullmatch(r"[0-9a-f]{40}", commit)
    ):
        raise ValueError("Expected the first attempt of an identified scheduled GitHub run")
    return repository, run_id, commit


def verified_report(directory, identity):
    try:
        with (directory / "nightly-browser-summary.json").open("rb") as handle:
            raw = handle.read(MAX_MESSAGE + 1)
        if len(raw) > MAX_MESSAGE:
            raise ValueError("Invalid report")
        report = json.loads(raw)
        with (directory / "nightly-browser-summary.md").open("rb") as handle:
            summary = handle.read(MAX_MESSAGE + 1)
        if (
            not isinstance(report, dict)
            or any(type(report.get(key)) is not type(value) or report[key] != value
                   for key, value in identity.items())
            or type(report.get("schema_version")) is not int or report["schema_version"] != 1
            or report.get("status") not in ("passed", "failed", "incomplete")
            or not summary.startswith(b"### Nightly browser outcomes\n")
            or len(summary) > MAX_MESSAGE
            or hashlib.sha256(summary).hexdigest() != report.get("summary_sha256")
        ):
            raise ValueError("Invalid report")
        return report, summary.decode("utf-8")
    except (OSError, ValueError):
        return {}, None


def report_passed(report):
    expected_shards = len(PROJECTS) * len(SHARDS)
    counts = report.get("counts")
    return (
        report.get("status") == "passed"
        and all(type(report.get(key)) is int and report[key] == expected_shards
                for key in ("expected_shards", "reported_shards"))
        and report.get("missing_or_invalid_shards") == []
        and report.get("failed_shards") == []
        and isinstance(counts, dict)
        and type(counts.get("expected")) is int and counts["expected"] > 0
        and type(counts.get("skipped")) is int and counts["skipped"] >= 0
        and all(type(counts.get(key)) is int and counts[key] == 0
                for key in ("unexpected", "flaky", "runner_errors"))
    )


def send(directory, receipt_file, env):
    repository, run_id, commit = run_identity(env)
    sender = env.get("NIGHTLY_BROWSER_EMAIL_FROM", "")
    recipient = env.get("NIGHTLY_BROWSER_EMAIL_TO", "")
    token = env.get("NIGHTLY_BROWSER_RESEND_KEY", "")
    jobs = {
        "Dependency, security and contract checks": env.get("NIGHTLY_CONTRACTS_RESULT", ""),
        "Browser matrix": env.get("NIGHTLY_BROWSERS_RESULT", ""),
        "Rollup and quarantine checks": env.get("NIGHTLY_REPORT_RESULT", ""),
    }
    if (
        not EMAIL.fullmatch(sender)
        or not EMAIL.fullmatch(recipient)
        or len(sender) > 254
        or len(recipient) > 254
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,1024}", token)
        or any(result not in CONCLUSIONS for result in jobs.values())
    ):
        raise ValueError("Configure the dedicated sender, recipient and key, and verify job results")
    report, summary = verified_report(directory, browser_run_identity(env))
    browser_passed = report_passed(report)
    if report.get("status") == "passed" and not browser_passed:
        report, summary = {}, None
    passed = browser_passed and all(result == "success" for result in jobs.values())
    outcome = "passed" if passed else "requires review"
    run_url = f"https://github.com/{repository}/actions/runs/{run_id}"
    body = json.dumps({
        "from": sender,
        "to": [recipient],
        "subject": f"Barghsa nightly checks · {outcome} · {commit[:12]}",
        "text": "\n".join([
            f"Workflow run {run_url}",
            f"Commit {commit}",
            "",
            *(f"{name} · {result}" for name, result in jobs.items()),
            "",
            summary or "The nightly browser outcome report is unavailable. Review the workflow run.",
        ]),
    }).encode("utf-8")
    receipt = {
        "schema_version": 1,
        "repository": repository,
        "run_id": run_id,
        "run_attempt": 1,
        "commit": commit,
        "outcome": outcome,
        "status": "unconfirmed",
        "summary_sha256": report.get("summary_sha256"),
    }

    def persist():
        receipt_file.write_text(json.dumps(receipt, indent=2) + "\n")

    persist()
    connection = HTTPSConnection("api.resend.com", timeout=10)
    try:
        connection.request("POST", "/emails", body, {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Idempotency-Key": f"barghsa-nightly/{repository}/{run_id}",
        })
        response = connection.getresponse()
        receipt["http_status"] = response.status
        persist()
        if not 200 <= response.status < 300:
            return False
        data = response.read(MAX_RECEIPT + 1)
        if len(data) > MAX_RECEIPT:
            return False
        response_body = json.loads(data)
        email_id = response_body.get("id") if isinstance(response_body, dict) else None
        if not isinstance(email_id, str) or not EMAIL_ID.fullmatch(email_id):
            return False
        receipt.update(status="accepted", provider_email_id=email_id)
        persist()
        return True
    except (OSError, HTTPException, ValueError):
        return False
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-dir", type=Path, required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    try:
        if send(args.report_dir, args.receipt, os.environ):
            print("Resend accepted the nightly email. Verify receipt at the approved mailbox.")
            return 0
    except (OSError, ValueError):
        print("Nightly email setup or receipt could not be verified. Check protected configuration.")
        return 1
    print("Nightly email acceptance is unconfirmed. Check the provider before any resend.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
