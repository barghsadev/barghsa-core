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


def command(repo, *args, capture=False):
    result = subprocess.run(["rtk", "proxy", *args], cwd=repo, check=True,
                            stdout=subprocess.PIPE if capture else None,
                            text=capture)
    return result.stdout.strip() if capture else None


def save(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


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


def enqueue(repo, state, commit, screenshots):
    if not re.fullmatch(r"[a-f0-9]{40}", commit):
        raise ValueError("Use the exact 40-character pushed commit")
    repo = Path(command(repo, "git", "rev-parse", "--show-toplevel", capture=True))
    command(repo, "git", "fetch", "origin", "main")
    command(repo, "git", "merge-base", "--is-ancestor", commit, "origin/main")
    version = json.loads(command(repo, "git", "show", f"{commit}:package.json", capture=True))["version"]
    if not isinstance(version, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", version):
        raise ValueError("Release must have a standard MAJOR.MINOR.PATCH version")
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
            return job
        if any(job["version"] == version for job in jobs(state)):
            raise ValueError("A different queued commit already uses this release version")
        directory.mkdir(parents=True, mode=0o700)
        for name, data in images.items():
            (directory / name).write_bytes(data)
        job = {"commit": commit, "version": version, "repo": str(repo),
               "created_ns": time.time_ns(), "phase": "queued", "screenshots": sorted(images)}
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
        command(repo, "git", "worktree", "add", "--detach", str(checkout), job["commit"])
    if command(checkout, "git", "rev-parse", "HEAD", capture=True) != job["commit"]:
        raise ValueError("Release checkout no longer matches its queued commit")
    # The token remains in the ignored source secret file, excluded by .dockerignore.
    secret = checkout / ".env"
    if not secret.exists() and (repo / ".env").exists():
        secret.symlink_to(repo / ".env")
    if command(checkout, "git", "status", "--porcelain", capture=True):
        raise ValueError("Release checkout has uncommitted files")
    command(checkout, "./deploy/staging/deploy.sh")
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
    actions.add_parser("work")
    actions.add_parser("status")
    retry = actions.add_parser("retry")
    retry.add_argument("--commit", required=True)
    args = parser.parse_args()
    state = args.state_dir.expanduser().resolve()
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
            job.update(phase="queued")
            job.pop("error", None)
            save(state / "jobs" / job["commit"] / "job.json", job)
    else:
        job = enqueue(args.repo, state, args.commit, args.screenshot)
    if job["phase"] == "failed":
        raise ValueError("Release failed; inspect its deploy.log before explicit retry")
    pid = start_worker(state) if job["phase"] != "completed" else None
    print(json.dumps({"commit": job["commit"], "version": job["version"], "phase": job["phase"],
                      "worker_pid": pid, "status_path": str(state / "jobs" / job["commit"] / "job.json")}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"Release queue: {error}", file=sys.stderr)
        sys.exit(1)
