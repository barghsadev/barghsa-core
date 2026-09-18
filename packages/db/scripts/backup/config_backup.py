#!/usr/bin/env python3
"""Encrypted configuration snapshots with explicit file inventories and isolated recovery."""

import argparse
from datetime import timedelta
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tarfile
import tempfile
import time
import uuid

from botocore.exceptions import ClientError
from physical_backup import (BackupError, Store, connection_env, crypt, digest, download,
                             extract, identifier, missing, run, timestamp, utcnow)
from verify_restore import alert

# Export stored versions, including active, disabled, draft and rollback versions.
# These are administrative settings/catalogues, not customers, financial records,
# delivery jobs or runtime assignment cursors. External referenced blobs remain
# subject to the object-storage recovery procedure.
CONFIG_TABLES = (
    "app_config", "config_version", "email_provider_configs", "notification_templates",
    "products", "product_categories", "product_price_versions", "electricity_product_limits",
    "vat_configurations", "product_vat_overrides", "upload_policies", "service_due_periods",
    "invoice_reminder_schedule", "invoice_reminder_offset_toggles", "ai_models", "ai_agents",
    "ai_agent_kbs", "ai_agent_policies", "ai_agent_slots", "ai_agent_kb_groups",
    "ai_agent_policy_groups", "ai_policies", "ai_policy_groups", "ai_policy_group_members",
    "tos_versions", "contract_templates", "contract_template_versions", "contract_type_templates",
    "staff_teams", "staff_team_members", "knowledge_bases", "kb_groups", "kb_group_members",
)
KINDS = {"env", "deploy", "tls", "encryption_key"}


def relative(value):
    if (not isinstance(value, str) or not value or "\\" in value or "\x00" in value
            or str(PurePosixPath(value)) != value or PurePosixPath(value).is_absolute()
            or ".." in PurePosixPath(value).parts or value == "."):
        raise BackupError("File inventory paths must be normalized relative paths")
    return value


def inventory(path):
    if not path:
        raise BackupError("CONFIG_BACKUP_FILE_MANIFEST is required")
    value = json.loads(Path(path).read_text())
    if type(value.get("version")) is not int or value["version"] != 1:
        raise BackupError("Invalid file inventory version")
    entries = value.get("files")
    if not isinstance(entries, list) or not entries:
        raise BackupError("Explicit file inventory must not be empty")
    names, archived, kinds = set(), set(), set()
    for entry in entries:
        name = relative(entry["path"])
        kind = entry["kind"]
        if kind not in KINDS or name in names:
            raise BackupError("Invalid or duplicate file inventory entry")
        stored = name + (".gpg" if kind == "encryption_key" else "")
        if stored in archived:
            raise BackupError("Wrapped key path collides with another file")
        names.add(name)
        archived.add(stored)
        kinds.add(kind)
    if kinds != KINDS:
        raise BackupError("Inventory must include env, deploy, TLS and encryption-key files")
    return entries


def copy_source(root, entry, destination):
    """Never follow declared file symlinks or silently skip a missing file."""
    root = Path(root).absolute()
    source = root
    if root.is_symlink() or not root.is_dir():
        raise BackupError("Source root must be an existing real directory")
    for part in PurePosixPath(relative(entry["path"])).parts:
        source /= part
        if source.is_symlink():
            raise BackupError("Symlinks are not permitted in the file inventory")
    with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), "rb") as incoming:
        before = os.fstat(incoming.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise BackupError("Only regular files may be backed up")
        with destination.open("xb") as output:
            shutil.copyfileobj(incoming, output)
        after = os.fstat(incoming.fileno())
        current = source.stat()
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if signature(before) != signature(after) or signature(before) != signature(current):
            raise BackupError("A source file changed during capture; retry after quiescing writes")
    destination.chmod(0o700 if before.st_mode & 0o111 else 0o600)


def snapshot():
    pairs = [f"'{name}', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text "
             f"COLLATE \"C\"), '[]'::jsonb) FROM public.{name} t)" for name in CONFIG_TABLES]
    env = {**connection_env(), "PGOPTIONS": "-c default_transaction_read_only=on -c TimeZone=UTC "
           "-c DateStyle=ISO -c extra_float_digits=3 -c statement_timeout=60000"}
    sql = "SELECT jsonb_build_object('version',1,'tables',jsonb_build_object(" + ",".join(pairs) + "))"
    raw = run(["psql", "-XAt", "--no-password", "-v", "ON_ERROR_STOP=1", "-c", sql], env=env, timeout=90)
    check_snapshot(raw)
    return raw


def check_snapshot(raw):
    value = json.loads(raw)
    if (type(value.get("version")) is not int or value["version"] != 1
            or set(value.get("tables", {})) != set(CONFIG_TABLES)
            or any(not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows)
                   for rows in value["tables"].values())):
        raise BackupError("Configuration snapshot does not cover the supported settings tables")


def rehydrate_snapshot(raw):
    """Validate restored JSON against real table types/checks using temporary tables.

    No permanent writes. References to users/uploads remain with the full database
    and object-store restore, so this is not an import into an empty application.
    """
    check_snapshot(raw)
    escaped = raw.replace("\\", "\\\\").replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n")
    sql = ["BEGIN; SET LOCAL TimeZone='UTC'; SET LOCAL statement_timeout='60s';",
           "CREATE TEMP TABLE recovered_snapshot(value jsonb) ON COMMIT DROP;",
           "COPY recovered_snapshot FROM STDIN;", escaped, "\\."]
    for table in CONFIG_TABLES:
        sql.extend([
            f"CREATE TEMP TABLE recovered_{table} (LIKE public.{table} INCLUDING CONSTRAINTS INCLUDING INDEXES) ON COMMIT DROP;",
            f"INSERT INTO recovered_{table} SELECT r.* FROM recovered_snapshot s, "
            f"jsonb_populate_recordset(NULL::public.{table}, s.value->'tables'->'{table}') r;",
            f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE \"C\"),'[]'::jsonb) "
            f"= (SELECT value->'tables'->'{table}' FROM recovered_snapshot) FROM recovered_{table} t;",
        ])
    sql.append("ROLLBACK;")
    output = run(["psql", "-XqAt", "--no-password", "-v", "ON_ERROR_STOP=1"],
                 input="\n".join(sql).encode(), env=connection_env(), timeout=180)
    if output.splitlines() != ["t"] * len(CONFIG_TABLES):
        raise BackupError("Configuration rehydration lost fields or changed values")


def collect(source, entries, payload):
    files = payload / "files"
    files.mkdir(mode=0o700)
    records = []
    for index, entry in enumerate(entries):
        raw = payload / f"input-{index}"
        copy_source(source, entry, raw)
        stored = entry["path"] + (".gpg" if entry["kind"] == "encryption_key" else "")
        destination = files / stored
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        plain_hash = digest(raw)
        mode = raw.stat().st_mode & 0o700
        if entry["kind"] == "encryption_key":
            crypt(raw, destination)
            raw.unlink()
        else:
            raw.rename(destination)
        records.append({**entry, "stored_path": stored, "sha256": plain_hash,
                        "stored_sha256": digest(destination), "mode": mode})
    raw_snapshot = snapshot()
    (payload / "active-config.json").write_text(raw_snapshot)
    return {"files": records, "snapshot_sha256": digest(payload / "active-config.json")}


def backup_config(store, args):
    entries = inventory(args.inventory)
    if not args.source_dir:
        raise BackupError("An explicit BACKUP_SOURCE_DIR is required")
    label = identifier(args.label or utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))
    key = f"config/full/{label}/manifest.json"
    try:
        existing = store.get(key)
    except ClientError as error:
        if not missing(error):
            raise
    else:
        existing["Body"].close()
        raise BackupError("Config backup label already exists")
    with tempfile.TemporaryDirectory(prefix="barghsa-config-", dir=args.work_dir) as tmp:
        root = Path(tmp)
        payload = root / "payload"
        payload.mkdir(mode=0o700)
        metadata = {"version": 1, "label": label, "started_at": utcnow().isoformat(),
                    **collect(args.source_dir, entries, payload), "captured_at": utcnow().isoformat()}
        (payload / "metadata.json").write_text(json.dumps(metadata))
        archive, encrypted = root / "config.tar", root / "config.tar.gpg"
        with tarfile.open(archive, "w") as tar:
            for path in payload.iterdir():
                tar.add(path, arcname=path.name)
        crypt(archive, encrypted)
        blob = f"config/blobs/{uuid.uuid4().hex}.tar.gpg"
        store.client.upload_file(str(encrypted), store.bucket, store.prefix + blob)
        public = {k: metadata[k] for k in ("version", "label", "captured_at")}
        public.update(blob=blob, sha256=digest(encrypted), size=encrypted.stat().st_size)
        store.put(key, json.dumps(public).encode(), ContentType="application/json")
        return {"label": label, "files": len(entries), "configuration_tables": len(CONFIG_TABLES)}


def manifests(store):
    records = []
    for item in store.objects("config/full/"):
        key = item["Key"][len(store.prefix):]
        if not key.endswith("/manifest.json"):
            continue
        response = store.get(key)
        try:
            record = json.loads(response["Body"].read(65537))
        finally:
            response["Body"].close()
        if (type(record.get("version")) is not int or record["version"] != 1
                or key != f"config/full/{identifier(record['label'])}/manifest.json"
                or not re.fullmatch(r"config/blobs/[a-f0-9]{32}\.tar\.gpg", record.get("blob", ""))
                or not re.fullmatch(r"[a-f0-9]{64}", record.get("sha256", ""))
                or type(record.get("size")) is not int or record["size"] <= 0):
            raise BackupError("Invalid config completion manifest")
        timestamp(record["captured_at"])
        records.append(record)
    return records


def prune_config(store, now=None):
    days = int(os.environ.get("CONFIG_BACKUP_RETENTION_DAYS", "90"))
    if days < 90:
        raise BackupError("Configuration retention must be at least 90 days")
    records = manifests(store)
    if not records:
        return {"deleted_backups": 0}
    newest = max(records, key=lambda r: timestamp(r["captured_at"]))
    cutoff = (now or utcnow()) - timedelta(days=days)
    expired = [r for r in records if r is not newest and timestamp(r["captured_at"]) < cutoff]
    retained_blobs = {r["blob"] for r in records if r not in expired}
    for record in expired:
        # Remove the completion record first so interrupted cleanup cannot expose
        # a completed backup whose payload we already deleted. Keep shared blobs.
        store.client.delete_object(Bucket=store.bucket,
                                   Key=store.prefix + f"config/full/{record['label']}/manifest.json")
        if record["blob"] not in retained_blobs:
            store.client.delete_object(Bucket=store.bucket, Key=store.prefix + record["blob"])
    return {"deleted_backups": len(expired)}


def backup_job(store, args):
    report = backup_config(store, args)
    report.update(prune_config(store))
    return report


def restore_config(store, args):
    target = Path(args.target_dir).absolute()
    if target.exists() or target.is_symlink():
        raise BackupError("Config restore target must not exist")
    records = [r for r in manifests(store) if args.label in (None, "latest", r["label"])]
    if not records:
        raise BackupError("No completed configuration backup matches")
    selected = max(records, key=lambda r: timestamp(r["captured_at"]))
    with tempfile.TemporaryDirectory(prefix=".config-restore-", dir=target.parent) as tmp:
        root = Path(tmp)
        encrypted, archive, payload = root / "cipher", root / "archive", root / "payload"
        download(store, selected["blob"], encrypted)
        if encrypted.stat().st_size != selected["size"] or digest(encrypted) != selected["sha256"]:
            raise BackupError("Encrypted configuration checksum mismatch")
        crypt(encrypted, archive, decrypt=True)
        payload.mkdir(mode=0o700)
        extract(archive, payload, allowed_roots=("files", "metadata.json", "active-config.json"), tablespace_links=False)
        metadata = json.loads((payload / "metadata.json").read_text())
        if any(metadata[k] != selected[k] for k in ("version", "label", "captured_at")):
            raise BackupError("Encrypted metadata disagrees with completion manifest")
        expected = {"metadata.json", "active-config.json"}
        original_names, stored_names, kinds = set(), set(), set()
        for entry in metadata["files"]:
            original, stored = relative(entry["path"]), relative(entry["stored_path"])
            if (entry["kind"] not in KINDS or original in original_names or stored in stored_names
                    or type(entry["mode"]) is not int or entry["mode"] not in (0o600, 0o700)
                    or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])):
                raise BackupError("Invalid restored file inventory")
            original_names.add(original)
            stored_names.add(stored)
            kinds.add(entry["kind"])
            if stored != original + (".gpg" if entry["kind"] == "encryption_key" else ""):
                raise BackupError("Invalid wrapped key location")
            path = payload / "files" / stored
            if digest(path) != entry["stored_sha256"]:
                raise BackupError("Restored file checksum mismatch")
            expected.add("files/" + stored)
        actual = {str(p.relative_to(payload)) for p in payload.rglob("*") if p.is_file()}
        if (kinds != KINDS or actual != expected
                or digest(payload / "active-config.json") != metadata["snapshot_sha256"]):
            raise BackupError("Restored configuration inventory mismatch")
        check_snapshot((payload / "active-config.json").read_text())
        # Exclusive target reservation; an existing path can never be replaced.
        target.mkdir(mode=0o700)
        for child in payload.iterdir():
            child.rename(target / child.name)
    return metadata


def baseline(args):
    if Path(args.output).exists():
        raise BackupError("Baseline output already exists")
    with tempfile.TemporaryDirectory(prefix="config-baseline-", dir=args.work_dir) as tmp:
        root = Path(tmp)
        records = []
        for i, entry in enumerate(inventory(args.inventory)):
            path = root / str(i)
            copy_source(args.source_dir, entry, path)
            records.append({**entry, "sha256": digest(path)})
        value = {"version": 1, "captured_at": utcnow().isoformat(), "files": records,
                 "snapshot_sha256": hashlib.sha256(snapshot().encode()).hexdigest()}
        with open(args.output, "x") as output:
            json.dump(value, output)
    return {"baseline_written": True, "files": len(records)}


def verify_config(store, args):
    started = time.monotonic()
    result = {"status": "failed", "scope": "configuration_assets", "rpo_seconds": None}
    try:
        expected = json.loads(Path(args.baseline).read_text())
        timestamp(expected["captured_at"])
        with tempfile.TemporaryDirectory(prefix="config-exercise-", dir=args.work_dir) as tmp:
            root = Path(tmp)
            target = root / "restored"
            metadata = restore_config(store, argparse.Namespace(target_dir=str(target), label=args.label))
            observed = []
            rehydrated = root / "rehydrated"
            rehydrated.mkdir(mode=0o700)
            for entry in metadata["files"]:
                destination = rehydrated / entry["path"]
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                source = target / "files" / entry["stored_path"]
                if entry["kind"] == "encryption_key":
                    crypt(source, destination, decrypt=True)
                else:
                    shutil.copyfile(source, destination)
                destination.chmod(entry["mode"] & 0o700)
                if digest(destination) != entry["sha256"]:
                    raise BackupError("Rehydrated file differs from captured source")
                observed.append({k: entry[k] for k in ("path", "kind", "sha256")})
            if (sorted(observed, key=lambda r: r["path"]) != sorted(expected["files"], key=lambda r: r["path"])
                    or metadata["snapshot_sha256"] != expected["snapshot_sha256"]):
                raise BackupError("Restored configuration differs from independent source baseline")
            rehydrate_snapshot((target / "active-config.json").read_text())
            result.update(status="passed", label=metadata["label"], rpo_seconds=0,
                          reference_time=expected["captured_at"], files=len(observed),
                          configuration_tables=len(CONFIG_TABLES))
    except Exception as error:
        result["error"] = str(error) if isinstance(error, BackupError) else type(error).__name__
    result["rto_seconds"] = round(time.monotonic() - started, 3)
    result["rto_limit_seconds"] = 3600
    result["core_service_rto_seconds"] = None
    if result["rto_seconds"] > result["rto_limit_seconds"]:
        result.update(status="failed", error="Configuration recovery exceeded the 60-minute RTO limit")
    result["rpo_basis"] = "Exact covered-asset match against independent baseline; unknown on mismatch"
    if result["status"] != "passed":
        result["alert"] = alert(result)
    return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("backup", "job", "prune", "restore", "baseline", "verify"))
    parser.add_argument("--source-dir", default=os.environ.get("BACKUP_SOURCE_DIR"))
    parser.add_argument("--inventory", default=os.environ.get("CONFIG_BACKUP_FILE_MANIFEST"))
    parser.add_argument("--work-dir", default=os.environ.get("BACKUP_DIR"))
    parser.add_argument("--label")
    parser.add_argument("--target-dir")
    parser.add_argument("--output")
    parser.add_argument("--baseline", default=os.environ.get("CONFIG_VERIFY_BASELINE"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if args.dry_run:
        print(json.dumps({"dry_run": True, "changes": False}))
        return 0
    try:
        if args.command == "backup":
            report = backup_config(Store(), args)
        elif args.command == "job":
            report = backup_job(Store(), args)
        elif args.command == "prune":
            report = prune_config(Store())
        elif args.command == "restore":
            if not args.target_dir:
                raise BackupError("--target-dir is required")
            metadata = restore_config(Store(), args)
            report = {"label": metadata["label"], "restored": True, "target": args.target_dir}
        elif args.command == "baseline":
            if not args.output or not args.source_dir:
                raise BackupError("Baseline requires --output and --source-dir")
            report = baseline(args)
        else:
            if not args.baseline:
                raise BackupError("An independent CONFIG_VERIFY_BASELINE is required")
            report = verify_config(Store(), args)
        print(json.dumps(report))
        return 1 if report.get("status") == "failed" else 0
    except Exception as error:
        detail = str(error) if isinstance(error, BackupError) else type(error).__name__
        report = {"status": "failed", "scope": "configuration_assets", "error": detail}
        if args.command in ("job", "verify"):
            report["alert"] = alert(report)
        print(json.dumps(report))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
