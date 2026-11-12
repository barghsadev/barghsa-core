#!/usr/bin/env python3
"""Seal a complete UTC day of private Loki records in the operator archive."""

import argparse
from datetime import date, datetime, time, timedelta, timezone
import gzip
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from urllib.parse import urlencode
from urllib.request import urlopen

from botocore.exceptions import BotoCoreError, ClientError
from physical_backup import BackupError, Store, crypt, digest, download, required


LOKI = "http://loki:3100"
PAGE_SIZE = 1000
MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
LABELS = {"environment", "level", "origin", "service"}
READABLE_STORAGE_CLASSES = {"STANDARD", "STANDARD_IA", "ONEZONE_IA", "INTELLIGENT_TIERING", "GLACIER_IR"}


def query(environment, start, end):
    params = urlencode({
        "query": '{environment="' + environment + '",origin=~"application|edge"}',
        "start": start,
        "end": end,
        "direction": "forward",
        "limit": PAGE_SIZE,
    })
    with urlopen(LOKI + "/loki/api/v1/query_range?" + params, timeout=30) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise BackupError("Loki archive query exceeded its response bound")
    page = json.loads(body)
    if page["status"] != "success" or page["data"]["resultType"] != "streams":
        raise BackupError("Loki did not return a successful stream query")
    entries = []
    for stream in page["data"]["result"]:
        labels = stream["stream"]
        if set(labels) != LABELS or labels["environment"] != environment:
            raise BackupError("Unexpected stream in the operator log archive")
        for timestamp, line in stream["values"]:
            if not start <= int(timestamp) < end or not isinstance(line, str):
                raise BackupError("Unexpected record in the operator log archive")
            entries.append((int(timestamp), tuple(sorted(labels.items())), line))
    if len(entries) > PAGE_SIZE:
        raise BackupError("Loki exceeded the requested record limit")
    if len(entries) == PAGE_SIZE:
        if end - start < 2:
            raise BackupError("Cannot prove the archive complete at a single timestamp")
        middle = (start + end) // 2
        yield from query(environment, start, middle)
        yield from query(environment, middle, end)
    else:
        yield from sorted(entries)


def write_archive(path, environment, day, now):
    start = datetime.combine(day, time.min, timezone.utc)
    end = start + timedelta(days=1)
    if end + timedelta(days=7) > now or start <= now - timedelta(days=30):
        raise BackupError("Archive day must be closed to late arrivals and fully searchable")
    first_ns, last_ns = (int(t.timestamp()) * 10**9 for t in (start, end))
    with urlopen(LOKI + "/ready", timeout=10) as response:
        if response.status != 200:
            raise BackupError("Loki is not ready for archival")
    with path.open("wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0) as output:
        def write(record):
            output.write((json.dumps(record, separators=(",", ":")) + "\n").encode())
            if raw.tell() > MAX_ARCHIVE_BYTES:
                raise BackupError("Daily archive exceeded the configured local size bound")

        write({"version": 1, "environment": environment, "day": day.isoformat()})
        count = 0
        for timestamp, labels, line in query(environment, first_ns, last_ns):
            write({"timestampNs": str(timestamp), "labels": dict(labels), "line": line})
            count += 1
        write({"records": count})
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise BackupError("Daily archive exceeded the configured local size bound")
    return count


def archive(store, key, day, environment, now, work):
    storage_class = required("BARGHSA_LOG_ARCHIVE_STORAGE_CLASS")
    if storage_class not in READABLE_STORAGE_CLASSES:
        raise BackupError("Archive storage class must support immediate read-back")
    plain = work / "logs.jsonl.gz"
    encrypted = work / "logs.gpg"
    restored = work / "restored.jsonl.gz"
    count = write_archive(plain, environment, day, now)
    checksum = digest(plain)
    crypt(plain, encrypted)
    try:
        with encrypted.open("rb") as body:
            store.put(key, body, StorageClass=storage_class)
    except ClientError as error:
        if error.response["ResponseMetadata"]["HTTPStatusCode"] != 412:
            raise
    download(store, key, encrypted)
    crypt(encrypted, restored, decrypt=True)
    if digest(restored) != checksum:
        raise BackupError("Existing archive differs from the complete Loki day")
    print(f"Verified archive {day.isoformat()} records={count} sha256={checksum}")


def main():
    now = datetime.now(timezone.utc)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("archive", "restore"))
    parser.add_argument("day", nargs="?", type=date.fromisoformat)
    args = parser.parse_args()
    if args.operation == "restore" and args.day is None:
        parser.error("restore requires an explicit UTC day")
    day = args.day or now.date() - timedelta(days=8)
    try:
        environment = required("BACKUP_CLUSTER_ID")
        if environment not in ("staging", "production") or not os.environ.get("BACKUP_S3_BUCKET"):
            raise BackupError("The archive requires an explicit environment and dedicated bucket")
        store = Store(namespace="operator-logs")
        key = f"daily/{day.isoformat()}.jsonl.gz.gpg"
        with tempfile.TemporaryDirectory(prefix="barghsa-log-archive-") as directory:
            work = Path(directory)
            if args.operation == "archive":
                archive(store, key, day, environment, now, work)
            else:
                download(store, key, work / "logs.gpg")
                crypt(work / "logs.gpg", work / "logs.jsonl.gz", decrypt=True)
                with (work / "logs.jsonl.gz").open("rb") as source:
                    shutil.copyfileobj(source, sys.stdout.buffer)
    except BackupError as error:
        parser.exit(1, f"Operator log archive failed: {error}\n")
    except (BotoCoreError, ClientError, OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Operator log archive failed ({type(error).__name__})\n")


if __name__ == "__main__":
    main()
