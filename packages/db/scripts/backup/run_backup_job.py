#!/usr/bin/env python3
"""Scheduled backup: prune only after success; report failures to the ops receiver."""

import contextlib
import io
import json
import os
import time

from physical_backup import BackupError, Store, backup, prune, utcnow
from verify_restore import alert


def run_job():
    started = time.monotonic()
    result = {"status": "failed", "phase": "backup", "started_at": utcnow().isoformat()}
    try:
        store = Store()
        with contextlib.redirect_stdout(io.StringIO()) as output:
            backup(store, None)
        result["backup"] = json.loads(output.getvalue())["label"]
        result["phase"] = "retention"
        with contextlib.redirect_stdout(io.StringIO()):
            prune(store)
        result["status"] = "passed"
    except Exception as error:
        result["error"] = str(error) if isinstance(error, BackupError) else type(error).__name__
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    if result["status"] != "passed":
        result["alert"] = alert(result)
    return result


if __name__ == "__main__":
    os.umask(0o077)
    report = run_job()
    print(json.dumps(report))
    raise SystemExit(0 if report["status"] == "passed" else 1)
