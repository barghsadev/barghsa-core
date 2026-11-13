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
import subprocess
import sys
import time
import urllib.request


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
    license_bytes = (directory / "release-licenses.json").read_bytes()
    licenses = json.loads(license_bytes)
    packages = licenses["packages"]
    if (licenses["commit"] != commit
            or any(licenses["images"].get(scope) != identity for scope, identity in image_ids.items())
            or not (image_ids.keys() | {"browser"}) <= {row["scope"] for row in packages}
            or any(row["status"] not in {"allowed", "approved"} for row in packages)):
        raise ValueError("Expected passing license evidence for the exact commit and images")
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
        job["runtime_images"] = json.loads(receipt.read_text())
    if job["screenshots"]:
        args = ["python3", "deploy/staging/notify-release.py", "--commit", job["commit"]]
        for name in job["screenshots"]:
            args.extend(["--screenshot", str(directory / name)])
        job.pop("screenshot_warning", None)
        try:
            command(checkout, *args)
        except subprocess.CalledProcessError as error:
            # Images are optional; the exact deployed release and main note are required.
            # Recheck without images, preserving unknown-send receipts and their retry guard.
            command(checkout, "python3", "deploy/staging/notify-release.py", "--commit", job["commit"])
            job["screenshot_warning"] = {
                "exit_code": error.returncode,
                "message": "Optional screenshots could not all be confirmed; inspect notification receipts and the channel before retrying unknown images.",
            }
    # Read deployed identity back; command exit status alone never completes a job.
    with urllib.request.urlopen("https://stg.barghsa.com/release.json", timeout=30) as response:
        live = json.load(response)
    if live.get("commit") != job["commit"] or live.get("version") != job["version"]:
        raise ValueError("Live release does not match the queued version and commit")
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
    verify.add_argument("--app-id", required=True)
    verify.add_argument("--web-id", required=True)
    verify.add_argument("--postgres-id", required=True)
    verify.add_argument("--clamav-id", required=True)
    verify.add_argument("--release-log", required=True, type=Path)
    verify.add_argument("--scan-dir", required=True, type=Path)
    verify.add_argument("--includes-stateful", action="store_true")
    verify.add_argument("--retained-scans", type=Path)
    verify.add_argument("--retained-sha")
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
        receipt = verify_images(args.release_log.read_text(errors="replace"), args.commit,
                                args.app_id, args.web_id, args.postgres_id, args.clamav_id)
        ids = receipt["image_ids"]
        receipt["image_scans"] = verify_image_scans(args.scan_dir, ids, args.includes_stateful)
        licensed_ids = {scope: ids[scope] for scope in ("app", "web")}
        if args.includes_stateful:
            if args.retained_scans or args.retained_sha:
                raise ValueError("First staging install scans its newly built stateful images")
            licensed_ids.update({"postgres-staging": ids["postgres"], "clamav": ids["clamav"]})
        else:
            if not args.retained_scans or not args.retained_sha:
                raise ValueError("Initialized staging requires retained PostgreSQL and ClamAV scans")
            receipt["retained_image_scans"] = verify_retained_scans(args.retained_scans, ids, args.retained_sha)
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
