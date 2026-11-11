#!/usr/bin/env python3
"""Scheduled backup: prune only after success; report failures to the ops receiver."""

import contextlib
import fcntl
import io
import json
import os
from pathlib import Path
import re
import tempfile
import time

from physical_backup import BackupError, Store, backup, prune, timestamp, utcnow
from verify_restore import alert


FULL_TIMESTAMP = "barghsa_postgres_backup_last_verified_timestamp_seconds"
JOB_TIMESTAMP = "barghsa_postgres_backup_last_job_timestamp_seconds"
JOB_SUCCESS = "barghsa_postgres_backup_last_job_success"


def report_metrics(path, completed, succeeded, verified):
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        fcntl.flock(directory, fcntl.LOCK_EX)
        try:
            previous = path.read_text()
        except FileNotFoundError:
            previous = ""
        last_full = re.search(rf"^{FULL_TIMESTAMP} ([0-9]+)$", previous, re.M)
        verified = max(verified, int(last_full[1]) if last_full else 0)
        metrics = {FULL_TIMESTAMP: verified, JOB_TIMESTAMP: completed, JOB_SUCCESS: int(succeeded)}
        content = "".join(f"# TYPE {name} gauge\n{name} {value}\n" for name, value in metrics.items())
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=".backup-", delete=False) as file:
            temporary = Path(file.name)
            try:
                file.write(content)
                file.flush()
                os.fchmod(file.fileno(), 0o640)
                os.fsync(file.fileno())
                os.replace(temporary, path)
                os.fsync(directory)
            finally:
                temporary.unlink(missing_ok=True)
    finally:
        os.close(directory)


def run_job():
    started = time.monotonic()
    result = {"status": "failed", "phase": "backup", "started_at": utcnow().isoformat()}
    full = None
    try:
        store = Store()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            backup(store, None)
        full = json.loads(output.getvalue())
        result["backup"] = full["label"]
        result["phase"] = "retention"
        with contextlib.redirect_stdout(io.StringIO()):
            prune(store)
        result["status"] = "passed"
    except Exception as error:
        result["error"] = str(error) if isinstance(error, BackupError) else type(error).__name__
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    if path := os.environ.get("BACKUP_METRICS_PATH"):
        try:
            verified = int(timestamp(full["completed_at"]).timestamp()) if "backup" in result else 0
            report_metrics(Path(path), int(utcnow().timestamp()), result["status"] == "passed", verified)
            result["monitoring"] = "reported"
        except (OSError, BackupError, KeyError, TypeError, ValueError, OverflowError):
            result["monitoring"] = "failed"
    if result["status"] != "passed" or result.get("monitoring") == "failed":
        result["alert"] = alert(result)
    return result


if __name__ == "__main__":
    os.umask(0o077)
    report = run_job()
    print(json.dumps(report))
    raise SystemExit(0 if report["status"] == "passed" and report.get("monitoring") != "failed" else 1)
