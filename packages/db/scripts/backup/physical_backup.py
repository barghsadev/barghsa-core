#!/usr/bin/env python3
"""Verified PostgreSQL physical backups and encrypted, immutable WAL archives.

All remote operations use signed S3 requests. Only our private temporary children
are removed. The public manifest is a commit marker, published after the payload.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse, parse_qsl, unquote
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


class BackupError(Exception):
    pass


def required(name):
    value = os.environ.get(name, "")
    if not value:
        raise BackupError(f"{name} is required")
    return value


def identifier(value):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value):
        raise BackupError("Invalid backup or cluster identifier")
    return value


def utcnow():
    return datetime.now(timezone.utc)


def timestamp(value):
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise BackupError("Timestamp must include a timezone")
    return result.astimezone(timezone.utc)


def digest(path):
    value = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def run(args, **kwargs):
    # Subprocess stderr can contain connection strings or SQL. Keep it private.
    kwargs["env"] = {**kwargs.get("env", os.environ), "LC_ALL": "C"}
    result = subprocess.run(args, capture_output=True, **kwargs)
    if result.returncode:
        raise BackupError(f"{Path(args[0]).name} failed (exit {result.returncode})")
    return result.stdout.decode().strip()


def connection_env():
    """Pass credentials through libpq environment, never subprocess arguments."""
    parsed = urlparse(required("PGDIRECT_URL"))
    if parsed.scheme not in ("postgres", "postgresql") or parsed.fragment:
        raise BackupError("PGDIRECT_URL must be a PostgreSQL URL")
    values = dict(parse_qsl(parsed.query, keep_blank_values=True))
    defaults = {"host": parsed.hostname, "port": str(parsed.port) if parsed.port else None,
                "user": unquote(parsed.username) if parsed.username else None,
                "password": unquote(parsed.password) if parsed.password else None,
                "dbname": unquote(parsed.path[1:]) if parsed.path[1:] else None}
    for key, value in defaults.items():
        if value is not None:
            values.setdefault(key, value)
    mapping = {"host": "PGHOST", "hostaddr": "PGHOSTADDR", "port": "PGPORT",
               "user": "PGUSER", "password": "PGPASSWORD", "dbname": "PGDATABASE",
               "sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT", "sslcert": "PGSSLCERT",
               "sslkey": "PGSSLKEY", "connect_timeout": "PGCONNECT_TIMEOUT",
               "options": "PGOPTIONS", "application_name": "PGAPPNAME",
               "target_session_attrs": "PGTARGETSESSIONATTRS", "channel_binding": "PGCHANNELBINDING"}
    if set(values) - mapping.keys():
        raise BackupError("Unsupported PGDIRECT_URL connection option")
    return {**os.environ, **{mapping[k]: v for k, v in values.items()}}


def crypt(source, destination, decrypt=False):
    secret = Path(required("BACKUP_GPG_PASSPHRASE_FILE"))
    if not secret.is_file() or not secret.read_bytes().strip():
        raise BackupError("GPG passphrase file must be readable and nonempty")
    # GPG reads just the first line. Reject ambiguous multiline secrets.
    if len(secret.read_bytes().splitlines()) != 1:
        raise BackupError("GPG passphrase file must contain one line")
    with tempfile.TemporaryDirectory(prefix="barghsa-gpg-") as home:
        try:
            run(["gpg", "--homedir", home, "--batch", "--yes", "--pinentry-mode",
                 "loopback", "--no-symkey-cache", "--passphrase-file", str(secret),
                 "--output", str(destination), *(["--decrypt"] if decrypt else
                 ["--cipher-algo", "AES256", "--symmetric"]), str(source)])
        finally:
            subprocess.run(["gpgconf", "--homedir", home, "--kill", "gpg-agent"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


class Store:
    def __init__(self):
        endpoint = required("BACKUP_S3_ENDPOINT")
        parsed = urlparse(endpoint)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username:
            raise BackupError("Invalid S3 endpoint")
        if parsed.scheme != "https" and os.environ.get("BACKUP_ALLOW_HTTP") != "true":
            raise BackupError("S3 requires HTTPS; local tests may explicitly allow HTTP")
        self.bucket = os.environ.get("BACKUP_S3_BUCKET", "barghsa-backups")
        self.prefix = "postgres/" + identifier(required("BACKUP_CLUSTER_ID")) + "/"
        self.client = boto3.client(
            "s3", endpoint_url=endpoint,
            aws_access_key_id=required("BACKUP_S3_ACCESS_KEY"),
            aws_secret_access_key=required("BACKUP_S3_SECRET_KEY"),
            aws_session_token=os.environ.get("BACKUP_S3_SESSION_TOKEN"),
            region_name=os.environ.get("BACKUP_S3_REGION", "us-east-1"),
            config=Config(signature_version="s3v4", connect_timeout=10, read_timeout=60,
                          retries={"mode": "standard", "total_max_attempts": 3},
                          s3={"addressing_style": "path"}),
        )

    def objects(self, prefix):
        for page in self.client.get_paginator("list_objects_v2").paginate(
                Bucket=self.bucket, Prefix=self.prefix + prefix):
            yield from page.get("Contents", [])

    def get(self, key):
        return self.client.get_object(Bucket=self.bucket, Key=self.prefix + key)

    def put(self, key, body, **kwargs):
        return self.client.put_object(Bucket=self.bucket, Key=self.prefix + key,
                                      Body=body, IfNoneMatch="*", **kwargs)

    def manifests(self):
        records = []
        for obj in self.objects("full/"):
            key = obj["Key"][len(self.prefix):]
            if key.endswith("/manifest.json"):
                response = self.get(key)
                try:
                    value = json.loads(response["Body"].read(65537))
                finally:
                    response["Body"].close()
                validate_manifest(value, key)
                records.append((key, value))
        return records


def missing(error):
    return isinstance(error, ClientError) and error.response["Error"]["Code"] in (
        "NoSuchKey", "404")


def validate_manifest(value, key):
    if (value.get("version") != 1 or key != f"full/{identifier(value['label'])}/manifest.json"
            or not re.fullmatch(r"[0-9]+", value.get("system_id", ""))
            or not re.fullmatch(r"blobs/[a-f0-9]{32}\.tar\.gpg", value.get("blob", ""))
            or not re.fullmatch(r"[a-f0-9]{64}", value.get("sha256", ""))
            or not isinstance(value.get("size"), int) or value["size"] <= 0):
        raise BackupError("Invalid backup manifest")
    timestamp(value["started_at"])
    timestamp(value["completed_at"])


def backup(store, label):
    label = identifier(label or utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"))
    started = utcnow().isoformat()
    key = f"full/{label}/manifest.json"
    try:
        existing = store.get(key)
    except ClientError as error:
        if not missing(error):
            raise
    else:
        existing["Body"].close()
        raise BackupError("Backup label already exists")
    env = connection_env()
    with tempfile.TemporaryDirectory(prefix="barghsa-full-", dir=os.environ.get("BACKUP_DIR")) as tmp:
        root = Path(tmp)
        payload = root / "payload"
        payload.mkdir()
        data = payload / "data"
        # Tar output keeps every tablespace under our temporary directory, even
        # when one is created concurrently. Plain format can use live source paths.
        raw = root / "native"
        run(["pg_basebackup", "--no-password", "-D", str(raw), "--format=tar", "--wal-method=stream",
             "--checkpoint=fast", "--manifest-checksums=SHA256", "--label", label], env=env)
        tablespaces = unpack_native(raw, payload)
        run(["pg_verifybackup", str(data)])
        native = json.loads((data / "backup_manifest").read_text())
        system_id = run(["pg_controldata", str(data)]).split("Database system identifier:", 1)[1].splitlines()[0].strip()
        meta = {"version": 1, "label": label, "system_id": system_id,
                "started_at": started, "completed_at": utcnow().isoformat(),
                "wal_ranges": native["WAL-Ranges"], "tablespaces": tablespaces}
        (payload / "metadata.json").write_text(json.dumps(meta))
        archive = root / "full.tar"
        with tarfile.open(archive, "w") as tar:
            for child in payload.iterdir():
                tar.add(child, arcname=child.name)
        encrypted = root / "full.tar.gpg"
        crypt(archive, encrypted)
        blob = f"blobs/{uuid.uuid4().hex}.tar.gpg"
        store.client.upload_file(str(encrypted), store.bucket, store.prefix + blob)
        meta.update(blob=blob, size=encrypted.stat().st_size, sha256=digest(encrypted))
        store.put(key, json.dumps(meta).encode(), ContentType="application/json")
        print(json.dumps(meta))


def wal_name(value):
    if not re.fullmatch(r"(?:[A-F0-9]{24}(?:\.[A-F0-9]{8}\.backup)?|[A-F0-9]{8}\.history)", value):
        raise BackupError("Invalid WAL filename")
    return value


def system_identifier(data):
    value = run(["pg_controldata", str(data)]).split("Database system identifier:", 1)[1].splitlines()[0].strip()
    if not value.isdigit():
        raise BackupError("Invalid PostgreSQL system identifier")
    return value


def archive_wal(store, filename, source):
    wal_name(filename)
    source = Path(source)
    system_id = system_identifier(required("PGDATA"))
    key = f"wal/{system_id}/{filename}.gpg"
    checksum = digest(source)
    with tempfile.TemporaryDirectory(prefix="barghsa-wal-") as tmp:
        encrypted = Path(tmp) / "wal.gpg"
        crypt(source, encrypted)
        try:
            with encrypted.open("rb") as body:
                store.put(key, body, Metadata={"plaintext-sha256": checksum})
        except ClientError as error:
            if error.response["Error"]["Code"] not in ("PreconditionFailed", "412"):
                raise
            # An existing object is success only when its decrypted content agrees.
            old = Path(tmp) / "old"
            download(store, key, encrypted)
            crypt(encrypted, old, decrypt=True)
            if digest(old) != checksum:
                raise BackupError("Refusing to replace a different archived WAL file") from None


def download(store, key, destination):
    response = store.get(key)
    try:
        with open(destination, "wb") as output:
            shutil.copyfileobj(response["Body"], output)
    finally:
        response["Body"].close()


def fetch_wal(store, system_id, filename, destination):
    if not system_id.isdigit():
        raise BackupError("Invalid PostgreSQL system identifier")
    wal_name(filename)
    with tempfile.TemporaryDirectory(prefix="barghsa-fetch-") as tmp:
        encrypted, plain = Path(tmp) / "wal.gpg", Path(tmp) / "wal"
        try:
            download(store, f"wal/{system_id}/{filename}.gpg", encrypted)
        except ClientError as error:
            if not missing(error):
                raise
            # A missing middle segment must not silently end latest recovery.
            if len(filename) == 24 and not (Path("pg_wal") / filename).is_file():
                later = any(Path(o["Key"]).name[:24] > filename
                            and Path(o["Key"]).name.startswith(filename[:8])
                            for o in store.objects(f"wal/{system_id}/"))
                if later:
                    raise BackupError("Archived WAL has a gap") from None
            return False
        crypt(encrypted, plain, decrypt=True)
        shutil.copyfile(plain, destination)
    return True


def extract(archive, target, prefix="", native_tablespaces=None):
    # Reject tar links except the tablespace links we reconstruct ourselves.
    links = []
    seen = set()
    with tarfile.open(archive) as tar:
        for member in tar:
            if prefix:
                # PostgreSQL tar archives contain paths relative to each root.
                member.name = prefix + "/" + member.name
            if native_tablespaces is not None and member.issym():
                match = re.fullmatch(r"data/pg_tblspc/([0-9]+)", member.name)
                if match and match[1] in native_tablespaces:
                    member.linkname = "../../tablespaces/" + match[1]
            path = PurePosixPath(member.name)
            if (path.is_absolute() or ".." in path.parts or not path.parts
                    or path.parts[0] not in ("data", "tablespaces", "metadata.json")
                    or member.name in seen):
                raise BackupError("Unsafe path in backup archive")
            seen.add(member.name)
            destination = target.joinpath(*path.parts)
            if member.issym() and re.fullmatch(r"data/pg_tblspc/[0-9]+", member.name):
                oid = path.name
                if member.linkname != f"../../tablespaces/{oid}":
                    raise BackupError("Unsafe tablespace link")
                links.append((destination, member.linkname))
            elif member.isdir():
                destination.mkdir(mode=0o700, parents=True, exist_ok=True)
            elif member.isfile():
                destination.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, destination.open("xb") as output:
                    shutil.copyfileobj(source, output)
                destination.chmod(member.mode & 0o700)
            else:
                raise BackupError("Unsupported link or special file in backup")
    for destination, link in links:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.symlink_to(link)


def unpack_native(raw, payload):
    tablespaces = sorted(p.stem for p in raw.glob("*.tar") if p.stem.isdigit())
    extract(raw / "base.tar", payload, "data", tablespaces)
    extract(raw / "pg_wal.tar", payload, "data/pg_wal")
    for oid in tablespaces:
        extract(raw / f"{oid}.tar", payload, "tablespaces/" + oid)
        link = payload / "data/pg_tblspc" / oid
        if not link.is_symlink():
            link.symlink_to(f"../../tablespaces/{oid}")
    shutil.copyfile(raw / "backup_manifest", payload / "data/backup_manifest")
    return tablespaces


def pgquote(value):
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def restore(store, args):
    target = Path(args.target_dir).absolute()
    if target.exists() or target.is_symlink():
        raise BackupError("Restore target must not exist")
    records = store.manifests()
    if args.backup:
        records = [(k, m) for k, m in records if m["label"] == args.backup]
    if args.pitr:
        point = timestamp(args.pitr)
        records = [(k, m) for k, m in records if timestamp(m["completed_at"]) <= point]
    if not records:
        raise BackupError("No completed backup matches the recovery request")
    _, meta = max(records, key=lambda item: timestamp(item[1]["completed_at"]))
    with tempfile.TemporaryDirectory(prefix=".barghsa-restore-", dir=target.parent) as tmp:
        root = Path(tmp)
        encrypted, archive = root / "full.gpg", root / "full.tar"
        download(store, meta["blob"], encrypted)
        if encrypted.stat().st_size != meta["size"] or digest(encrypted) != meta["sha256"]:
            raise BackupError("Encrypted backup checksum mismatch")
        crypt(encrypted, archive, decrypt=True)
        payload = root / "payload"
        payload.mkdir()
        extract(archive, payload)
        actual = json.loads((payload / "metadata.json").read_text())
        if actual != {k: v for k, v in meta.items() if k not in ("blob", "size", "sha256")}:
            raise BackupError("Backup manifest does not match encrypted metadata")
        data = payload / "data"
        run(["pg_verifybackup", str(data)])
        if system_identifier(data) != meta["system_id"]:
            raise BackupError("Restored cluster identity mismatch")
        # Tar backups carry original tablespace locations. Our verified relative
        # links replace them; recovery must not recreate links into the live source.
        (data / "tablespace_map").unlink(missing_ok=True)
        # Isolate the clone from inherited replication/archive commands and peers.
        for name in ("postgresql.conf", "postgresql.auto.conf", "pg_hba.conf"):
            old = data / name
            if old.exists():
                old.rename(data / (name + ".source"))
        command = " ".join(shlex.quote(s).replace("%", "%%") for s in
                           (sys.executable, str(Path(__file__).resolve()), "fetch-wal", meta["system_id"]))
        command += " %f %p"
        settings = ["listen_addresses = ''", "archive_mode = off", "hot_standby = off",
                    "restore_command = " + pgquote(command), "recovery_target_timeline = 'latest'",
                    "recovery_target_action = 'promote'"]
        if args.pitr:
            settings.append("recovery_target_time = " + pgquote(point.isoformat()))
        (data / "postgresql.conf").write_text("\n".join(settings) + "\n")
        (data / "postgresql.auto.conf").write_text("")
        (data / "pg_hba.conf").write_text("local all all peer\n")
        (data / "standby.signal").unlink(missing_ok=True)
        (data / "recovery.signal").touch()
        # mkdir is an exclusive reservation; never replace a concurrent target.
        target.mkdir(mode=0o700)
        try:
            for child in payload.iterdir():
                child.rename(target / child.name)
        except Exception:
            # Keep a failed transfer for diagnosis. Never claim it is ready.
            raise BackupError("Restore publication failed; inspect the reserved target") from None
    print(json.dumps({"backup": meta["label"], "data_dir": str(target / "data"),
                      "prepared": True, "replayed": False}))


def prune(store, now=None):
    now = now or utcnow()
    full_days = int(os.environ.get("BACKUP_RETENTION_DAYS", "14"))
    wal_days = int(os.environ.get("WAL_RETENTION_DAYS", "7"))
    if full_days < 14 or wal_days < 7:
        raise BackupError("Retention minimum is 14 full-backup days and 7 WAL days")
    records = store.manifests()
    if not records:
        raise BackupError("No completed backup; refusing retention cleanup")
    # Keep each cluster incarnation's newest backup, regardless of age.
    latest = {}
    for key, meta in records:
        sid = meta["system_id"]
        if sid not in latest or timestamp(meta["completed_at"]) > timestamp(latest[sid][1]["completed_at"]):
            latest[sid] = (key, meta)
    keep, expired = [], []
    for key, meta in records:
        (keep if (key == latest[meta["system_id"]][0]
                  or timestamp(meta["completed_at"]) >= now - timedelta(days=full_days))
         else expired).append((key, meta))
    floors = {}
    for _, meta in keep:
        sid = meta["system_id"]
        # Two additional days protect clock skew and backups crossing midnight.
        cutoff = min(timestamp(meta["started_at"]) - timedelta(days=2), now - timedelta(days=wal_days))
        floors[sid] = min(floors.get(sid, cutoff), cutoff)
    keys = []
    for key, meta in expired:
        keys.extend([store.prefix + key, store.prefix + meta["blob"]])
    for sid, cutoff in floors.items():
        for obj in store.objects(f"wal/{sid}/"):
            if obj["LastModified"] < cutoff and not obj["Key"].endswith(".history.gpg"):
                keys.append(obj["Key"])
    for key in keys:
        store.client.delete_object(Bucket=store.bucket, Key=key)
    print(json.dumps({"deleted_objects": len(keys), "retained_full_backups": len(keep)}))


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    full = sub.add_parser("backup")
    full.add_argument("--label")
    full.add_argument("--dry-run", action="store_true")
    wal = sub.add_parser("archive")
    wal.add_argument("filename")
    wal.add_argument("source")
    fetch = sub.add_parser("fetch-wal")
    fetch.add_argument("system_id")
    fetch.add_argument("filename")
    fetch.add_argument("destination")
    recovery = sub.add_parser("restore")
    recovery.add_argument("--target-dir", required=True)
    recovery.add_argument("--backup")
    recovery.add_argument("--latest", action="store_true")
    recovery.add_argument("--pitr")
    recovery.add_argument("--dry-run", action="store_true")
    sub.add_parser("prune")
    args = parser.parse_args()
    if getattr(args, "dry_run", False):
        print(json.dumps({"dry_run": True, "operation": args.command, "changes": False}))
        return 0
    try:
        store = Store()
        if args.command == "backup":
            backup(store, args.label)
        elif args.command == "archive":
            archive_wal(store, args.filename, args.source)
        elif args.command == "restore":
            restore(store, args)
        elif args.command == "prune":
            prune(store)
        elif not fetch_wal(store, args.system_id, args.filename, args.destination):
            return 1  # Only a genuinely missing archive is normal recovery EOF.
        return 0
    except Exception as error:
        detail = str(error) if isinstance(error, BackupError) else type(error).__name__
        print(f"Backup operation failed: {detail}", file=sys.stderr)
        # PostgreSQL treats shell failures >125 as fatal, not end-of-archive.
        return 126 if args.command == "fetch-wal" else 1


if __name__ == "__main__":
    sys.exit(main())
