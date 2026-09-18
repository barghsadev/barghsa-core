#!/usr/bin/env python3
"""Exercise an isolated restore against independently captured source evidence."""

import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
import shutil
import subprocess
import tempfile
import time

from physical_backup import BackupError, Store, connection_env, pgquote, restore, run, timestamp, utcnow

TABLES = ("users", "orders", "invoices")
RPO_LIMIT = 300
RTO_LIMIT = 3600


def psql(env, sql):
    return run(["psql", "-XAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-c", sql],
               env=env, timeout=60)


def fingerprints(env):
    # One COPY statement means one consistent snapshot across all three tables.
    # Ordering, timezone and serialization settings are identical on both sides.
    selects = [f"SELECT '{table}' AS entity, row_to_json(t)::text AS payload "
               f"FROM public.{table} t" for table in TABLES]
    sql = 'COPY (SELECT entity, payload FROM (' + ' UNION ALL '.join(selects) + \
          ') snapshots ORDER BY entity COLLATE "C", payload COLLATE "C") TO STDOUT'
    env = {**env, "PGOPTIONS": "-c default_transaction_read_only=on -c TimeZone=UTC "
           "-c DateStyle=ISO -c extra_float_digits=3 -c bytea_output=hex -c statement_timeout=60000"}
    hashes = {table: hashlib.sha256() for table in TABLES}
    counts = dict.fromkeys(TABLES, 0)
    # Private, bounded-memory spool; neither rows nor connection details enter logs.
    with tempfile.TemporaryFile() as output:
        result = subprocess.run(["psql", "-Xq", "--no-password", "-v", "ON_ERROR_STOP=1", "-c", sql],
                                env=env, stdout=output, stderr=subprocess.PIPE, timeout=120)
        if result.returncode:
            raise BackupError("Source fingerprint query failed")
        output.seek(0)
        for line in output:
            entity, separator, payload = line.partition(b"\t")
            name = entity.decode()
            if not separator or name not in hashes:
                raise BackupError("Invalid fingerprint output")
            hashes[name].update(payload)
            counts[name] += 1
    return {name: {"count": counts[name], "sha256": hashes[name].hexdigest()} for name in TABLES}


def baseline(path):
    if not path:
        raise BackupError("VERIFY_BASELINE_FILE is required; counts alone cannot prove no data loss")
    value = json.loads(Path(path).read_text())
    if type(value.get("version")) is not int or value["version"] != 1:
        raise BackupError("Invalid baseline version")
    reference, captured = timestamp(value["reference_time"]), timestamp(value["captured_at"])
    if reference > captured or captured > utcnow():
        raise BackupError("Invalid baseline reference time")
    if set(value.get("tables", {})) != set(TABLES):
        raise BackupError("Baseline must cover users, orders and invoices")
    for item in value["tables"].values():
        if (type(item.get("count")) is not int or item["count"] < 0
                or not re.fullmatch(r"[a-f0-9]{64}", item.get("sha256", ""))):
            raise BackupError("Invalid baseline table fingerprint")
    return value


def capture(path, reference):
    if not reference or timestamp(reference) > utcnow():
        raise BackupError("Provide the time of an independently confirmed source commit")
    if Path(path).exists():
        raise BackupError("Baseline destination already exists")
    value = {"version": 1, "reference_time": timestamp(reference).isoformat(),
             "tables": fingerprints(connection_env()), "captured_at": utcnow().isoformat()}
    with open(path, "x") as output:
        json.dump(value, output, indent=2)
        output.write("\n")


def measure_rpo(replay_time, reference_time):
    if not replay_time:
        raise BackupError("RPO unknown: no replayed transaction timestamp")
    return max(0.0, (timestamp(reference_time) - timestamp(replay_time)).total_seconds())


def check_limits(replay_time, reference_time, elapsed):
    rpo = measure_rpo(replay_time, reference_time)
    if rpo > RPO_LIMIT or elapsed > RTO_LIMIT:
        raise BackupError("Restore exceeds the 300-second RPO or 3600-second database RTO limit")
    return rpo


@contextlib.contextmanager
def workspace(parent):
    root = Path(tempfile.mkdtemp(prefix="barghsa-exercise-", dir=parent))
    try:
        yield root
    finally:
        # A shutdown failure must preserve the running server's files. The pidfile
        # is deliberately a conservative guard; stale files require inspection.
        if not (root / "candidate/data/postmaster.pid").exists():
            shutil.rmtree(root)


def exercise(args):
    start = time.monotonic()
    result = {"status": "failed", "scope": "database_restore", "rpo_seconds": None,
              "database_rto_seconds": None, "core_service_rto_seconds": None,
              "started_at": utcnow().isoformat()}
    try:
        expected = baseline(args.baseline)
        with workspace(args.work_dir) as root:
            target = root / "candidate"
            recovery = argparse.Namespace(target_dir=str(target), backup=None, pitr=args.pitr)
            with contextlib.redirect_stdout(io.StringIO()):
                restore(Store(), recovery)
            result["backup"] = json.loads((target / "metadata.json").read_text())["label"]
            data, socket = target / "data", root / "socket"
            socket.mkdir(mode=0o700)
            # Trust is confined to this 0700 socket directory; TCP remains disabled.
            (data / "pg_hba.conf").write_text("local all all trust\n")
            with (data / "postgresql.conf").open("a") as config:
                config.write("unix_socket_directories = " + pgquote(str(socket)) + "\n")
            # Inherited libpq service/address settings must not redirect clone checks.
            env = {**{k: v for k, v in os.environ.items()
                      if k not in ("PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE")},
                   "PGHOST": str(socket), "PGPORT": "5432", "PGCONNECT_TIMEOUT": "5",
                   "PGDATABASE": os.environ.get("VERIFY_PG_DATABASE", "barghsa"),
                   "PGUSER": os.environ.get("VERIFY_PG_USER", "barghsa"),
                   "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=30000"}
            try:
                startup_budget = max(1, int(RTO_LIMIT - (time.monotonic() - start)))
                run(["pg_ctl", "-D", str(data), "-l", str(root / "postgres.log"),
                     "-w", "-t", str(startup_budget), "start"], timeout=startup_budget + 5)
                while True:
                    if time.monotonic() - start > RTO_LIMIT:
                        raise BackupError("Database recovery readiness exceeded 3600 seconds")
                    try:
                        if psql(env, "SELECT NOT pg_is_in_recovery()") == "t":
                            break
                    except BackupError:
                        if subprocess.run(["pg_ctl", "-D", str(data), "status"],
                                          capture_output=True).returncode:
                            raise BackupError("Recovery server stopped before readiness") from None
                    time.sleep(0.2)
                replay = psql(env, "SELECT pg_last_xact_replay_timestamp()")
                result["replayed_transaction_time"] = replay or None
                result["rpo_seconds"] = measure_rpo(replay, expected["reference_time"])
                actual = fingerprints(env)
                result["tables"] = actual
                if actual != expected["tables"]:
                    raise BackupError("Restored counts or row fingerprints differ from source baseline")
                if psql(env, "SELECT count(*) FROM pg_index WHERE NOT indisvalid") != "0":
                    raise BackupError("Restored database has invalid indexes")
                if args.sql_file:
                    output = run(["psql", "-XAt", "--no-password", "-v", "ON_ERROR_STOP=1",
                                  "-f", args.sql_file], env=env, timeout=120)
                    if not output.strip() or any(line != "0" for line in output.splitlines()):
                        raise BackupError("Verification SQL must return only zero failure counts")
                result["database_rto_seconds"] = round(time.monotonic() - start, 3)
                check_limits(replay, expected["reference_time"], result["database_rto_seconds"])
                result["status"] = "passed"
            finally:
                # Stop even a partially started clone before its owned files disappear.
                stopped = subprocess.run(["pg_ctl", "-D", str(data), "-m", "immediate", "-w", "stop"],
                                         capture_output=True, timeout=60)
                if stopped.returncode and (data / "postmaster.pid").exists():
                    raise BackupError(f"Could not stop verification database; files retained at {root}")
    except Exception as error:
        result["status"] = "failed"
        result["error"] = str(error) if isinstance(error, BackupError) else type(error).__name__
    result["elapsed_seconds"] = round(time.monotonic() - start, 3)
    return result


def alert(result):
    executable = os.environ.get("VERIFY_ALERT_EXECUTABLE")
    if not executable:
        return "not_configured"
    try:
        response = subprocess.run([executable], input=json.dumps(result).encode(),
                                  capture_output=True, timeout=15)
        return "accepted" if response.returncode == 0 else "failed"
    except (OSError, subprocess.TimeoutExpired):
        return "failed"


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", default=os.environ.get("WORK_DIR"))
    parser.add_argument("--baseline", default=os.environ.get("VERIFY_BASELINE_FILE"))
    parser.add_argument("--sql-file", default=os.environ.get("VERIFY_SQL_FILE"))
    parser.add_argument("--pitr")
    parser.add_argument("--capture-baseline")
    parser.add_argument("--reference-time")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        print(json.dumps({"dry_run": True, "changes": False}))
        return 0
    if args.capture_baseline:
        try:
            capture(args.capture_baseline, args.reference_time)
            return 0
        except Exception as error:
            print(str(error) if isinstance(error, BackupError) else type(error).__name__)
            return 1
    def interrupted(_signum, _frame):
        raise BackupError("Restore exercise interrupted")
    signal.signal(signal.SIGTERM, interrupted)
    result = exercise(args)
    if result["status"] != "passed":
        result["alert"] = alert(result)
    print(json.dumps(result))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
