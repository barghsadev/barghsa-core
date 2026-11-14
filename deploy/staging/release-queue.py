#!/usr/bin/env python3
"""Deploy pushed staging batches in isolated checkouts, independently of CI/builds."""
import argparse
from contextlib import contextmanager
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import sys
import time
import urllib.error
import urllib.request


RELEASE_CHAT_ID = -1004467450624
STAGING_ORIGIN = "https://stg.barghsa.com"
RELEASE_RESPONSE_LIMIT = 256 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


# This file is copied into the queue state as a standalone runner.
release_opener = urllib.request.build_opener(NoRedirect)


def command(repo, *args, capture=False, umask=-1):
    result = subprocess.run(["rtk", "proxy", *args], cwd=repo, check=True,
                            stdout=subprocess.PIPE if capture else None,
                            text=capture, umask=umask)
    return result.stdout.strip() if capture else None


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def verify_images(log, commit, app_id, web_id, postgres_id, clamav_id):
    marker = "BARGHSA_STAGING_RUNTIME_IMAGES_V1 "
    records = [line.removeprefix(marker).split() for line in log.splitlines() if line.startswith(marker)]
    if len(records) != 1 or len(records[0]) != 5:
        raise ValueError("Expected exactly one complete staging runtime image receipt")
    revision, *image_ids = records[0]
    if not re.fullmatch(r"[0-9a-f]{40}", revision) or revision != commit:
        raise ValueError("Staging runtime image receipt does not match the queued commit")
    if not all(re.fullmatch(r"sha256:[0-9a-f]{64}", image_id) for image_id in image_ids):
        raise ValueError("Staging runtime image receipt contains an invalid image ID")
    if image_ids[:2] != [app_id, web_id]:
        raise ValueError("Staging runtime app or web image ID differs from the transferred image")
    if image_ids[2:] != [postgres_id, clamav_id]:
        raise ValueError("Staging runtime PostgreSQL or ClamAV image ID differs from the candidate manifest")
    return {"schema_version": 1, "commit": revision,
            "image_ids": dict(zip(("app", "web", "postgres", "clamav"), image_ids))}


def migration_checkpoint_fields(commit):
    return {
        "label": rf"release-{re.escape(commit[:12])}-[0-9]{{8}}T[0-9]{{6}}Z-[0-9]+",
        "system_id": r"[0-9]+",
        "blob": r"blobs/[0-9a-f]{32}\.tar\.gpg",
        "sha256": r"[0-9a-f]{64}",
    }


def verified_checkpoint_fields(backup, commit):
    return (type(backup.get("size")) is int and backup["size"] > 0
            and backup.get("manifest_readback_verified") is True
            and all(isinstance(backup.get(field), str) and re.fullmatch(pattern, backup[field])
                    for field, pattern in migration_checkpoint_fields(commit).items()))


def verified_manifest_details(backup):
    try:
        started = datetime.datetime.fromisoformat(backup["started_at"])
        completed = datetime.datetime.fromisoformat(backup["completed_at"])
    except (KeyError, TypeError, ValueError):
        return False
    ranges = backup.get("wal_ranges")
    tablespaces = backup.get("tablespaces")
    return (started.utcoffset() is not None and completed.utcoffset() is not None
            and started <= completed and isinstance(ranges, list) and bool(ranges)
            and all(isinstance(row, dict) and type(row.get("Timeline")) is int and row["Timeline"] > 0
                    and all(isinstance(row.get(key), str)
                            and re.fullmatch(r"[0-9A-F]{1,8}/[0-9A-F]{1,8}", row[key])
                            for key in ("Start-LSN", "End-LSN")) for row in ranges)
            and isinstance(tablespaces, list)
            and all(isinstance(oid, str) and re.fullmatch(r"[1-9][0-9]{0,9}", oid)
                    for oid in tablespaces))


def require_migration_checkpoint(version, checkpoint, commit):
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version):
        raise ValueError("Release must have a standard MAJOR.MINOR.PATCH version")
    if re.match(r"^0\.[0-5]\.", version):
        return
    if (not isinstance(checkpoint, dict) or checkpoint.get("status") != "verified"
            or not verified_checkpoint_fields(checkpoint, commit)
            or not isinstance(checkpoint.get("manifest_sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", checkpoint["manifest_sha256"])):
        raise ValueError("Staging milestone requires a verified encrypted migration checkpoint")


def verify_migration_backup(log, commit):
    marker = "BARGHSA_STAGING_MIGRATION_BACKUP_V1 "
    records = [line.removeprefix(marker) for line in log.splitlines() if line.startswith(marker)]
    if len(records) != 1:
        raise ValueError("Expected exactly one staging migration backup receipt")
    backup = json.loads(records[0])
    if not isinstance(backup, dict):
        raise ValueError("Invalid staging migration backup receipt")
    if len(backup) == 1 and backup.get("disposable") is True:
        return {"status": "disposable"}
    if (type(backup.get("version")) is not int or backup["version"] != 1
            or backup.get("upload_verified") is not True
            or not verified_checkpoint_fields(backup, commit)
            or not verified_manifest_details(backup)):
        raise ValueError("Invalid verified staging migration backup receipt")
    # Verification flags belong to the command receipt, outside the off-site manifest.
    manifest = {key: value for key, value in backup.items()
                if key not in ("upload_verified", "manifest_readback_verified")}
    manifest_digest = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
    return {"status": "verified", "manifest_sha256": manifest_digest, "manifest_readback_verified": True,
            **{field: backup[field] for field in (*migration_checkpoint_fields(commit), "size")}}


def verify_scanner(log):
    marker = "BARGHSA_STAGING_SCANNER_V1 "
    records = [line.removeprefix(marker) for line in log.splitlines() if line.startswith(marker)]
    match = None
    if len(records) == 1:
        match = re.fullmatch(r"([A-Za-z0-9_.+-]+) ([1-9][0-9]{0,9}) ([1-9][0-9]{0,11})", records[0])
    if not match:
        raise ValueError("Expected one verified staging ClamAV signature receipt")
    return {"engine_version": match[1], "signature_version": int(match[2]),
            "signature_built_at_epoch": int(match[3])}


def read_image_scans(directory, scopes, image_ids):
    scans = {}
    for index, scope in enumerate(scopes, 1):
        receipt = (directory / f"{index}-image.json").read_bytes()
        scan = json.loads(receipt)
        if (not isinstance(scan, dict) or scan.get("blocked") is not False
                or not isinstance(scan.get("image_id"), str)
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", scan["image_id"])
                or (image_ids is not None and scan["image_id"] != image_ids[scope])):
            raise ValueError(f"Missing passing scan for the deployed {scope} image")
        for suffix, field in (("vulnerabilities.json", "report_sha256"), ("sbom.cdx.json", "sbom_sha256")):
            payload = (directory / f"{index}-{suffix}").read_bytes()
            if hashlib.sha256(payload).hexdigest() != scan.get(field):
                raise ValueError(f"Scan artifact checksum differs for the deployed {scope} image")
        scans[scope] = {"index": index, "receipt_sha256": hashlib.sha256(receipt).hexdigest()}
    return {"directory": str(directory.resolve()), "images": scans}


def verify_image_scans(directory, image_ids, includes_stateful):
    scopes = ("postgres", "clamav", "app", "web") if includes_stateful else ("app", "web")
    return read_image_scans(directory, scopes, image_ids)


def verify_retained_scans(directory, image_ids=None, expected_sha=None):
    scans = read_image_scans(directory, ("postgres", "clamav"), image_ids)
    digest = hashlib.sha256(json.dumps(scans["images"], sort_keys=True).encode()).hexdigest()
    if expected_sha is not None and digest != expected_sha:
        raise ValueError("The selected retained image scan evidence changed")
    return {**scans, "sha256": digest}


def retained_scan_selection(directory):
    scans = verify_retained_scans(directory.resolve(strict=True))
    return {"directory": scans["directory"], "sha256": scans["sha256"]}


def file_sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_bundle_reports(directory, commit, image_ids):
    if not isinstance(image_ids, dict) or set(image_ids) != {"app", "web"} or not all(
        isinstance(value, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value)
        for value in image_ids.values()
    ):
        raise ValueError("Invalid application image bundle identities")
    scan_index = verify_image_scans(directory, image_ids, False)["images"]
    return scan_index, verify_image_licenses(directory, commit, image_ids)


def verify_image_licenses(directory, commit, image_ids):
    return verify_license_report(directory / "release-licenses.json", commit, image_ids, browser=True)


def verify_license_report(path, commit, image_ids, *, browser):
    license_bytes = path.read_bytes()
    licenses = json.loads(license_bytes)
    packages = licenses["packages"]
    expected_scopes = image_ids.keys() | ({"browser"} if browser else set())
    if (licenses["commit"] != commit
            or any(licenses["images"].get(scope) != identity for scope, identity in image_ids.items())
            or not expected_scopes <= {row["scope"] for row in packages}
            or any(row["status"] not in {"allowed", "approved"} for row in packages)):
        raise ValueError("Expected passing license evidence for the exact commit and images")
    if not browser and (licenses["images"] != image_ids or {row["scope"] for row in packages} != expected_scopes):
        raise ValueError("Retained license report must cover exactly the retained images")
    return hashlib.sha256(license_bytes).hexdigest()


def verify_image_bundle(directory, commit, manifest_sha):
    raw = (directory / "bundle.json").read_bytes()
    if hashlib.sha256(raw).hexdigest() != manifest_sha:
        raise ValueError("The selected image bundle manifest changed")
    manifest = json.loads(raw)
    if manifest["schema_version"] != 1 or manifest["commit"] != commit:
        raise ValueError("Image bundle does not match the queued commit")
    scans, license_sha = verify_bundle_reports(directory, commit, manifest["image_ids"])
    if scans != manifest["scans"] or license_sha != manifest["license_sha256"]:
        raise ValueError("Image bundle evidence changed after preparation")
    if file_sha256(directory / "images.tar.gz") != manifest["archive_sha256"]:
        raise ValueError("Image bundle archive checksum differs from its manifest")
    return manifest


@contextmanager
def locked(state, name):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    state.chmod(0o700)
    with (state / name).open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        yield


def jobs(state):
    return sorted((json.loads(path.read_text()) for path in (state / "jobs").glob("*/job.json")),
                  key=lambda job: job["created_ns"])


def check_release(repo, commit):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Use the exact 40-character pushed commit")
    repo = Path(command(repo, "git", "rev-parse", "--show-toplevel", capture=True))
    command(repo, "git", "fetch", "origin", "main")
    command(repo, "git", "merge-base", "--is-ancestor", commit, "origin/main")
    version = json.loads(command(repo, "git", "show", f"{commit}:package.json", capture=True))["version"]
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Release must have a standard MAJOR.MINOR.PATCH version")
    ledger = json.loads(command(repo, "git", "show", f"{commit}:kanban/board.json", capture=True))
    if (not isinstance(ledger, dict) or ledger.get("schema_version") != 1
            or not isinstance(ledger.get("releases"), list)):
        raise ValueError("Invalid release ledger in the pushed commit")
    releases = [record for record in ledger["releases"]
                if isinstance(record, dict) and record.get("version") == version]
    if len(releases) != 1 or releases[0].get("status") != "accepted":
        raise ValueError("The pushed commit must record an accepted milestone for this version")
    acceptance = releases[0].get("acceptance")
    gates = acceptance.get("gates") if isinstance(acceptance, dict) else None
    if not isinstance(gates, dict) or not gates or not all(gates.values()):
        raise ValueError("The accepted milestone must include gate evidence")
    return repo, version


def enqueue(repo, state, commit, screenshots, image_bundle=None, retained_scans=None):
    repo, version = check_release(repo, commit)
    bundle = None
    if image_bundle is not None:
        directory = image_bundle.resolve(strict=True)
        manifest_sha = file_sha256(directory / "bundle.json")
        verify_image_bundle(directory, commit, manifest_sha)
        bundle = {"directory": str(directory), "manifest_sha256": manifest_sha}
    retained = retained_scan_selection(retained_scans) if retained_scans is not None else None
    images = {}
    for path in screenshots:
        data = Path(path).read_bytes()
        if not data.startswith(b"\x89PNG\r\n\x1a\n") or len(data) > 10 * 1024 * 1024:
            raise ValueError("Release screenshots must be PNG files no larger than 10 MiB")
        images[hashlib.sha256(data).hexdigest() + ".png"] = data
    if len(images) > 10:
        raise ValueError("At most ten screenshots can accompany one release album")
    with locked(state, "queue.lock"):
        directory = state / "jobs" / commit
        path = directory / "job.json"
        if path.exists():
            job = json.loads(path.read_text())
            if images and sorted(images) != job["screenshots"]:
                raise ValueError("This commit already has an immutable screenshot selection")
            if bundle is not None and bundle != job.get("image_bundle"):
                raise ValueError("This commit already has an immutable image bundle selection")
            if retained is not None and retained != job.get("retained_scans"):
                raise ValueError("This commit already has an immutable retained scan selection")
            return job
        if any(job["version"] == version for job in jobs(state)):
            raise ValueError("A different queued commit already uses this release version")
        directory.mkdir(parents=True, mode=0o700)
        for name, data in images.items():
            (directory / name).write_bytes(data)
        job = {"commit": commit, "version": version, "repo": str(repo),
               "created_ns": time.time_ns(), "phase": "queued", "screenshots": sorted(images)}
        if bundle is not None:
            job["image_bundle"] = bundle
        if retained is not None:
            job["retained_scans"] = retained
        save(path, job)
        return job


def start_worker(state):
    # Freeze the runner too: subsequent build edits cannot change a waiting worker.
    source = Path(__file__).read_bytes()
    runners = state / "runners"
    runners.mkdir(mode=0o700, exist_ok=True)
    runner = runners / (hashlib.sha256(source).hexdigest() + ".py")
    with locked(state, "queue.lock"):
        if not runner.exists():
            runner.write_bytes(source)
    with (state / "worker.log").open("a") as log:
        process = subprocess.Popen(["rtk", "proxy", sys.executable, str(runner),
                                    "--state-dir", str(state), "work"],
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
    return process.pid


def verified_notifications(checkout, path, job):
    if not path.is_file() or path.stat().st_size > 8192:
        raise ValueError("Missing or invalid Telegram job receipt")
    receipts = json.loads(path.read_bytes())
    if not isinstance(receipts, dict) or set(receipts) - {"summary", "album"}:
        raise ValueError("Missing or invalid Telegram job receipt")
    metadata, notes = runpy.run_path(str(checkout / "deploy/staging/notify-release.py"))["release_details"](checkout, job["commit"])
    if metadata != {"version": job["version"], "commit": job["commit"]}:
        raise ValueError("Telegram job receipt checkout does not match the release")

    def confirmed(receipt):
        return (isinstance(receipt, dict) and receipt.get("status") == "sent"
                and receipt.get("chat_id") == RELEASE_CHAT_ID
                and all(receipt.get(key) == value for key, value in metadata.items()))

    summary = receipts.get("summary")
    if (not confirmed(summary) or type(summary.get("message_id")) is not int
            or summary["message_id"] <= 0
            or summary.get("text_sha256") != hashlib.sha256(notes.encode()).hexdigest()):
        raise ValueError("Telegram job receipt does not confirm the exact release summary")
    album = receipts.get("album")
    photos = job["screenshots"]
    if album is not None:
        if not confirmed(album) or album.get("photo_sha256") != [name[:-4] for name in photos] or not photos:
            raise ValueError("Telegram job receipt does not confirm the queued screenshots")
        ids = album.get("message_ids")
        if (not isinstance(ids, list) or len(ids) != len(photos)
                or any(type(value) is not int or value <= 0 for value in ids)
                or len(set(ids)) != len(ids) or summary["message_id"] in ids
                or (len(photos) > 1 and (not isinstance(album.get("media_group_id"), str) or not album["media_group_id"]))):
            raise ValueError("Telegram job receipt does not confirm one grouped album")
    elif photos and not job.get("screenshot_warning"):
        raise ValueError("Telegram job receipt is missing the queued screenshot outcome")
    return {"summary": summary, **({"album": album} if album is not None else {})}


def read_staging_json(path):
    request = urllib.request.Request(f"{STAGING_ORIGIN}{path}", headers={"Cache-Control": "no-cache"})
    try:
        with release_opener.open(request, timeout=30) as response:
            body = response.read(RELEASE_RESPONSE_LIMIT + 1)
    except urllib.error.HTTPError as error:
        error.close()
        raise ValueError(f"Staging readback rejected with HTTP {error.code}") from None
    except OSError:
        raise ValueError("Staging readback did not return a verifiable JSON response") from None
    if len(body) > RELEASE_RESPONSE_LIMIT:
        raise ValueError("Staging readback exceeded its size limit")
    try:
        return json.loads(body)
    except (UnicodeError, ValueError):
        raise ValueError("Staging readback did not return a verifiable JSON response") from None


def verify_live_release(job):
    live = read_staging_json("/release.json")
    if (not isinstance(live, dict) or live.get("commit") != job["commit"]
            or live.get("version") != job["version"]):
        raise ValueError("Live release does not match the queued version and commit")
    return live


def verify_saved_image_evidence(job, runtime):
    ids = runtime["image_ids"]
    scanned = runtime["image_scans"]
    retained = job.get("retained_scans")
    scan_dir = Path(scanned["directory"])
    commit = job["commit"]
    if verify_image_scans(scan_dir, ids, includes_stateful=retained is None) != scanned:
        raise ValueError("Saved staging image scan receipts changed")
    licensed_ids = {scope: ids[scope] for scope in ("app", "web")}
    stateful_ids = {"postgres-staging": ids["postgres"], "clamav": ids["clamav"]}
    if retained is None:
        licensed_ids.update(stateful_ids)
    else:
        observed = verify_retained_scans(Path(retained["directory"]), ids, retained["sha256"])
        if observed != runtime.get("retained_image_scans"):
            raise ValueError("Saved retained staging image scan receipts changed")
        retained_license = verify_license_report(
            Path(runtime["retained_license_report"]), commit, stateful_ids, browser=False
        )
        if retained_license != runtime.get("retained_license_sha256"):
            raise ValueError("Saved retained staging image license report changed")
    if verify_image_licenses(scan_dir, commit, licensed_ids) != runtime.get("license_sha256"):
        raise ValueError("Saved staging image license report changed")


def verify_running_images(checkout, images):
    host = os.environ.get("BARGHSA_VPS_HOST") or "89.42.199.13"
    port = os.environ.get("BARGHSA_VPS_SSH_PORT") or "30222"
    readback = r"""
set -eu
ids=$(docker container ls --quiet --no-trunc \
    --filter label=com.docker.compose.project=barghsa-staging \
    --filter label=com.docker.compose.oneoff=False)
test -n "$ids"
docker container inspect --format '{{index .Config.Labels "com.docker.compose.service"}} {{.State.Running}} {{.Image}}' $ids
"""
    lines = command(checkout, "ssh", "-p", port, "-o", "BatchMode=yes",
                    "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10",
                    f"root@{host}", readback, capture=True).splitlines()
    expected = {"api": images["app"], "worker": images["app"], "ai-inference": images["app"],
                **{service: images[service] for service in ("web", "postgres", "clamav")}}
    running = set()
    for line in lines:
        columns = line.split()
        if len(columns) != 3:
            raise ValueError("Invalid staging running image readback")
        service, active, image = columns
        if service not in expected:
            continue
        if service in running or active != "true" or image != expected[service]:
            raise ValueError(f"Running staging image differs from the saved receipt: {service}")
        running.add(service)
    if missing := expected.keys() - running:
        raise ValueError(f"Missing running staging services: {', '.join(sorted(missing))}")


def deploy(job, state):
    repo = Path(job["repo"])
    directory = state / "jobs" / job["commit"]
    checkout = directory / "checkout"
    if not checkout.exists():
        # The parent job directory stays private. Docker copies the tracked
        # file modes and the packaged application runs as a non-root user.
        command(repo, "git", "worktree", "add", "--detach", str(checkout), job["commit"],
                umask=0o022)
    if command(checkout, "git", "rev-parse", "HEAD", capture=True) != job["commit"]:
        raise ValueError("Release checkout no longer matches its queued commit")
    # The token remains in the ignored source secret file, excluded by .dockerignore.
    secret = checkout / ".env"
    if not secret.exists() and (repo / ".env").exists():
        secret.symlink_to(repo / ".env")
    if command(checkout, "git", "status", "--porcelain", capture=True):
        raise ValueError("Release checkout has uncommitted files")
    receipt = directory / "runtime-images.json"
    notification_receipt = directory / "telegram.json"
    resume_notification = receipt.exists()
    if resume_notification:
        runtime = json.loads(receipt.read_text())
        images = runtime.get("image_ids") if isinstance(runtime, dict) else None
        if (not isinstance(images, dict) or set(images) != {"app", "web", "postgres", "clamav"}
                or any(not isinstance(value, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", value)
                       for value in images.values())
                or runtime.get("schema_version") != 1 or runtime.get("commit") != job["commit"]):
            raise ValueError("Saved staging runtime receipt does not match the queued release")
        require_migration_checkpoint(job["version"], runtime.get("migration_backup"), job["commit"])
        if not re.match(r"^0\.[0-5]\.", job["version"]):
            verify_saved_image_evidence(job, runtime)
        verify_live_release(job)
        readiness = read_staging_json("/api/health/ready")
        checks = readiness.get("checks") if isinstance(readiness, dict) else None
        if (not isinstance(checks, dict) or readiness.get("status") != "ok"
                or readiness.get("commit") != job["commit"] or readiness.get("warnings", []) != []
                or any(not isinstance(checks.get(name), dict) or checks[name].get("status") != "ok"
                       for name in ("postgresql", "redis", "objectStorage"))):
            raise ValueError("Live staging API is not healthy for the queued release")
        verify_running_images(checkout, images)
    else:
        deploy_args = ["./deploy/staging/deploy.sh", str(receipt)]
        if bundle := job.get("image_bundle"):
            deploy_args.extend([bundle["directory"], bundle["manifest_sha256"]])
        if retained := job.get("retained_scans"):
            if bundle is None:
                deploy_args.extend(["", ""])
            deploy_args.extend([retained["directory"], retained["sha256"]])
        command(checkout, *deploy_args)
    # Older immutable releases predate the receipt argument.
    if receipt.exists():
        job["runtime_images"] = runtime if resume_notification else json.loads(receipt.read_text())
    if resume_notification or job["screenshots"]:
        notify = ["python3", "deploy/staging/notify-release.py", "--commit", job["commit"],
                  "--receipt", str(notification_receipt)]
        args = list(notify)
        for name in job["screenshots"]:
            args.extend(["--screenshot", str(directory / name)])
        job.pop("screenshot_warning", None)
        try:
            command(checkout, *args)
        except subprocess.CalledProcessError as error:
            if not job["screenshots"]:
                raise
            # Images are optional; the exact deployed release and main note are required.
            # Recheck without images, preserving unknown-send receipts and their retry guard.
            command(checkout, *notify)
            job["screenshot_warning"] = {
                "exit_code": error.returncode,
                "message": "Optional screenshots could not all be confirmed; inspect notification receipts and the channel before retrying unknown images.",
            }
    # Read deployed identity back; command exit status alone never completes a job.
    live = verify_live_release(job)
    job["telegram"] = verified_notifications(checkout, notification_receipt, job)
    if secret.is_symlink():
        secret.unlink()
    command(repo, "git", "worktree", "remove", str(checkout))
    return live


def work(state):
    os.nice(10)
    # Blocking in this detached worker prevents lost wakeups when enqueue races exit.
    with locked(state, "worker.lock"):
        for job in jobs(state):
            if job["phase"] == "completed":
                continue
            path = state / "jobs" / job["commit"] / "job.json"
            if job["phase"] != "queued":
                if job["phase"] != "failed":
                    job.update(phase="failed", error="Previous release interrupted; inspect its log before explicit retry")
                    save(path, job)
                return 1
            job.update(phase="deploying", pid=os.getpid())
            save(path, job)
            try:
                with (path.parent / "deploy.log").open("a") as log:
                    # Keep every subprocess and its log in the detached worker.
                    with redirect_log(log):
                        live = deploy(job, state)
                job.update(phase="completed", live_release=live, ci_required=False,
                           completed_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
                save(path, job)
            except Exception as error:
                job.update(phase="failed", error=str(error))
                save(path, job)
                return 1
        return 0


@contextmanager
def redirect_log(log):
    sys.stdout.flush()
    sys.stderr.flush()
    descriptors = [os.dup(1), os.dup(2)]
    try:
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)
        yield
    finally:
        os.dup2(descriptors[0], 1)
        os.dup2(descriptors[1], 2)
        for descriptor in descriptors:
            os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=Path.home() / ".local/state/barghsa-staging-queue")
    actions = parser.add_subparsers(dest="action", required=True)
    add = actions.add_parser("enqueue")
    add.add_argument("--repo", type=Path, default=Path.cwd())
    add.add_argument("--commit", required=True)
    add.add_argument("--screenshot", action="append", default=[])
    add.add_argument("--image-bundle", type=Path)
    add.add_argument("--retained-scans", type=Path, help="Exact PostgreSQL and ClamAV scan directory for initialized staging")
    check = actions.add_parser("check-release")
    check.add_argument("--repo", type=Path, default=Path.cwd())
    check.add_argument("--commit", required=True)
    verify = actions.add_parser("verify-images")
    verify.add_argument("--commit", required=True)
    verify.add_argument("--version", required=True)
    verify.add_argument("--app-id", required=True)
    verify.add_argument("--web-id", required=True)
    verify.add_argument("--postgres-id", required=True)
    verify.add_argument("--clamav-id", required=True)
    verify.add_argument("--release-log", required=True, type=Path)
    verify.add_argument("--scan-dir", required=True, type=Path)
    verify.add_argument("--includes-stateful", action="store_true")
    verify.add_argument("--retained-scans", type=Path)
    verify.add_argument("--retained-sha")
    verify.add_argument("--retained-license-report", type=Path)
    verify.add_argument("--retained-license-sha")
    verify.add_argument("--receipt", type=Path)
    retained = actions.add_parser("verify-retained-scans")
    retained.add_argument("directory", type=Path)
    retained.add_argument("postgres_id")
    retained.add_argument("clamav_id")
    retained.add_argument("sha")
    prepare_bundle = actions.add_parser("prepare-image-bundle")
    prepare_bundle.add_argument("directory", type=Path)
    prepare_bundle.add_argument("commit")
    prepare_bundle.add_argument("app_id")
    prepare_bundle.add_argument("web_id")
    verify_bundle = actions.add_parser("verify-image-bundle")
    verify_bundle.add_argument("directory", type=Path)
    verify_bundle.add_argument("commit")
    verify_bundle.add_argument("manifest_sha")
    actions.add_parser("work")
    actions.add_parser("status")
    retry = actions.add_parser("retry")
    retry.add_argument("--commit", required=True)
    retry.add_argument("--retained-scans", type=Path, help="Supply an omitted retained scan directory")
    args = parser.parse_args()
    state = args.state_dir.expanduser().resolve()
    if args.action == "check-release":
        _, version = check_release(args.repo, args.commit)
        print(version)
        return 0
    if args.action == "verify-retained-scans":
        verify_retained_scans(args.directory, {"postgres": args.postgres_id, "clamav": args.clamav_id}, args.sha)
        return 0
    if args.action == "verify-images":
        release_log = args.release_log.read_text(errors="replace")
        receipt = verify_images(release_log, args.commit, args.app_id, args.web_id,
                                args.postgres_id, args.clamav_id)
        receipt["migration_backup"] = verify_migration_backup(release_log, args.commit)
        require_migration_checkpoint(args.version, receipt["migration_backup"], args.commit)
        receipt["scanner"] = verify_scanner(release_log)
        ids = receipt["image_ids"]
        receipt["image_scans"] = verify_image_scans(args.scan_dir, ids, args.includes_stateful)
        licensed_ids = {scope: ids[scope] for scope in ("app", "web")}
        if args.includes_stateful:
            if args.retained_scans or args.retained_sha or args.retained_license_report or args.retained_license_sha:
                raise ValueError("First staging install scans its newly built stateful images")
            licensed_ids.update({"postgres-staging": ids["postgres"], "clamav": ids["clamav"]})
        else:
            if not all((args.retained_scans, args.retained_sha, args.retained_license_report, args.retained_license_sha)):
                raise ValueError("Initialized staging requires retained PostgreSQL and ClamAV scan and license receipts")
            receipt["retained_image_scans"] = verify_retained_scans(args.retained_scans, ids, args.retained_sha)
            receipt["retained_license_report"] = str(args.retained_license_report.resolve())
            receipt["retained_license_sha256"] = verify_license_report(
                args.retained_license_report, args.commit,
                {"postgres-staging": ids["postgres"], "clamav": ids["clamav"]}, browser=False)
            if receipt["retained_license_sha256"] != args.retained_license_sha:
                raise ValueError("Retained image license evidence changed after preflight")
        receipt["license_sha256"] = verify_image_licenses(args.scan_dir, args.commit, licensed_ids)
        if args.receipt:
            save(args.receipt, receipt)
        return 0
    if args.action == "prepare-image-bundle":
        if not re.fullmatch(r"[a-f0-9]{40}", args.commit):
            raise ValueError("Image bundle preparation requires the full source commit")
        ids = {"app": args.app_id, "web": args.web_id}
        scans, license_sha = verify_bundle_reports(args.directory, args.commit, ids)
        save(args.directory / "bundle.json", {
            "schema_version": 1, "commit": args.commit, "image_ids": ids, "scans": scans,
            "license_sha256": license_sha, "archive_sha256": file_sha256(args.directory / "images.tar.gz"),
        })
        return 0
    if args.action == "verify-image-bundle":
        bundle = verify_image_bundle(args.directory, args.commit, args.manifest_sha)
        print(bundle["image_ids"]["app"], bundle["image_ids"]["web"], bundle["archive_sha256"])
        return 0
    if args.action == "work":
        return work(state)
    if args.action == "status":
        print(json.dumps(jobs(state), indent=2))
        return 0
    if args.action == "retry":
        with locked(state, "worker.lock"):
            matches = [job for job in jobs(state) if job["commit"] == args.commit and job["phase"] == "failed"]
            if len(matches) != 1:
                raise ValueError("Only an existing failed release can be retried")
            job = matches[0]
            if args.retained_scans is not None:
                retained = retained_scan_selection(args.retained_scans)
                if job.get("retained_scans", retained) != retained:
                    raise ValueError("This commit already has an immutable retained scan selection")
                job["retained_scans"] = retained
            job.update(phase="queued")
            job.pop("error", None)
            save(state / "jobs" / job["commit"] / "job.json", job)
    else:
        job = enqueue(args.repo, state, args.commit, args.screenshot, args.image_bundle, args.retained_scans)
    if job["phase"] == "failed":
        raise ValueError("Release failed; inspect its deploy.log before explicit retry")
    pid = start_worker(state) if job["phase"] != "completed" else None
    print(json.dumps({"commit": job["commit"], "version": job["version"], "phase": job["phase"],
                      "worker_pid": pid, "status_path": str(state / "jobs" / job["commit"] / "job.json")}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release queue: {error}", file=sys.stderr)
        sys.exit(1)
