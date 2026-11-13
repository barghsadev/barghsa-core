import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release_queue", Path(__file__).with_name("release-queue.py"))
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)


class RuntimeImageReceiptTests(unittest.TestCase):
    def test_rejects_invalid_or_ambiguous_image_receipts(self):
        commit = "a" * 40
        app, web, postgres, clamav = ["sha256:" + c * 64 for c in "bcde"]
        receipt = f"BARGHSA_STAGING_RUNTIME_IMAGES_V1 {commit} {app} {web} {postgres} {clamav}"
        for log, error in (
            ("No marker", "exactly one complete"),
            (f"{receipt}\n{receipt}", "exactly one complete"),
            (receipt.removesuffix(f" {clamav}"), "exactly one complete"),
            (receipt.replace(commit, "f" * 40), "does not match the queued commit"),
            (receipt.replace(postgres, "postgres:latest"), "invalid image ID"),
            (receipt.replace(web, app), "differs from the transferred image"),
            (receipt.replace(postgres, app), "differs from the candidate manifest"),
            (receipt.replace(clamav, web), "differs from the candidate manifest"),
        ):
            with self.subTest(error=error):
                with self.assertRaisesRegex(ValueError, error):
                    queue.verify_images(log, commit, app, web, postgres, clamav)

    def test_binds_scan_receipts_and_artifact_checksums_to_running_images(self):
        image_ids = {scope: "sha256:" + character * 64 for scope, character in
                     zip(("app", "web", "postgres", "clamav"), "bcde")}
        for scopes, includes_stateful in (
            (("app", "web"), False),
            (("postgres", "clamav", "app", "web"), True),
        ):
            with self.subTest(scopes=scopes), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                receipts = {}
                for index, scope in enumerate(scopes, 1):
                    artifact = f"{scope} fixture".encode()
                    digest = hashlib.sha256(artifact).hexdigest()
                    scan = {"image_id": image_ids[scope], "blocked": False,
                            "report_sha256": digest, "sbom_sha256": digest}
                    receipt = json.dumps(scan).encode()
                    (directory / f"{index}-image.json").write_bytes(receipt)
                    (directory / f"{index}-vulnerabilities.json").write_bytes(artifact)
                    (directory / f"{index}-sbom.cdx.json").write_bytes(artifact)
                    receipts[scope] = {"index": index, "receipt_sha256": hashlib.sha256(receipt).hexdigest()}
                self.assertEqual(queue.verify_image_scans(directory, image_ids, includes_stateful),
                                 {"directory": str(directory.resolve()), "images": receipts})

                with self.assertRaisesRegex(ValueError, "Missing passing scan"):
                    queue.verify_image_scans(directory, {**image_ids, "web": image_ids["app"]}, includes_stateful)
                (directory / f"{index}-sbom.cdx.json").write_text("changed")
                with self.assertRaisesRegex(ValueError, "artifact checksum differs"):
                    queue.verify_image_scans(directory, image_ids, includes_stateful)
                (directory / f"{index}-image.json").write_text(json.dumps({**scan, "blocked": True}))
                with self.assertRaisesRegex(ValueError, "Missing passing scan"):
                    queue.verify_image_scans(directory, image_ids, includes_stateful)


class ReleaseQueueTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo, self.remote, self.state = [self.root / name for name in ["repo", "remote", "state"]]
        self.repo.mkdir()
        self.capture = self.root / "capture"
        self.capture.mkdir()
        queue.command(self.root, "git", "init", "--bare", str(self.remote), capture=True)
        queue.command(self.repo, "git", "init", "-b", "main", capture=True)
        for key, value in [("user.name", "Queue test"), ("user.email", "queue@example.test")]:
            queue.command(self.repo, "git", "config", key, value)
        queue.command(self.repo, "git", "remote", "add", "origin", str(self.remote))
        (self.repo / ".gitignore").write_text(".env\n")
        (self.repo / ".env").write_text("private-test-value")
        scripts = self.repo / "deploy/staging"
        scripts.mkdir(parents=True)
        deploy = scripts / "deploy.sh"
        deploy.write_text('''#!/bin/sh
set -eu
git rev-parse HEAD > "$QUEUE_CAPTURE/deployed-head"
test -z "$(git status --porcelain)"
python3 - <<'PYTHON'
from pathlib import Path
assert Path("package.json").stat().st_mode & 0o777 == 0o644
assert Path("deploy/staging/deploy.sh").stat().st_mode & 0o777 == 0o755
assert Path("..").stat().st_mode & 0o777 == 0o700
PYTHON
if [ "$#" -gt 1 ]; then
    printf '%s\\n' "$2" "$3" > "$QUEUE_CAPTURE/image-bundle"
fi
if [ "$#" -gt 3 ]; then
    printf '%s\\n' "$4" "$5" > "$QUEUE_CAPTURE/retained-scans"
fi
if [ "${QUEUE_TEST_WRITE_IMAGES:-}" = 1 ]; then
    printf '%s\\n' "$QUEUE_TEST_IMAGES" > "$1"
fi
python3 deploy/staging/notify-release.py --commit "$(git rev-parse HEAD)"
''')
        deploy.chmod(0o755)
        (scripts / "notify-release.py").write_text('''import json, os, pathlib, sys
with (pathlib.Path(os.environ['QUEUE_CAPTURE'])/'notifications').open('a') as log:
    log.write(json.dumps(sys.argv[1:])+'\\n')
''')
        self.commit = self.publish("0.1.3")
        self.image = self.root / "reviewed.png"
        self.image.write_bytes(b"\x89PNG\r\n\x1a\nreviewed-image")
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {"QUEUE_CAPTURE": str(self.capture)}).start()
        patch.object(queue.os, "nice").start()

    def write_ledger(self, version, status, with_gate_evidence=True):
        ledger = self.repo / "kanban/board.json"
        ledger.parent.mkdir(exist_ok=True)
        ledger.write_text(json.dumps({"schema_version": 1, "releases": [{
            "version": version,
            "status": status,
            "gates": ["Fixture acceptance gate"],
            "acceptance": {
                "accepted_at": "2026-11-10T04:00:00Z",
                "gates": {"fixture": "Verified fixture"} if with_gate_evidence else {},
            } if status == "accepted" else None,
        }]}))

    def publish(self, version, status="accepted", with_gate_evidence=True):
        (self.repo / "package.json").write_text(json.dumps({"version": version}))
        self.write_ledger(version, status, with_gate_evidence)
        queue.command(self.repo, "git", "add", ".gitignore", "package.json", "deploy", "kanban/board.json")
        queue.command(self.repo, "git", "commit", "-m", "fixture release", capture=True)
        queue.command(self.repo, "git", "push", "origin", "main", capture=True)
        return queue.command(self.repo, "git", "rev-parse", "HEAD", capture=True)

    def live(self, commit=None):
        return patch.object(queue.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps({
            "version": "0.1.3", "commit": commit or self.commit,
        }).encode()))

    def test_duplicate_enqueue_and_screenshots_are_immutable(self):
        first = queue.enqueue(self.repo, self.state, self.commit, [self.image])
        second = queue.enqueue(self.repo, self.state, self.commit, [self.image])
        self.assertEqual(first, second)
        self.assertEqual(len(queue.jobs(self.state)), 1)
        stored = self.state / "jobs" / self.commit / first["screenshots"][0]
        before = stored.read_bytes()
        self.image.write_bytes(b"\x89PNG\r\n\x1a\ndifferent-image")
        self.assertEqual(stored.read_bytes(), before)
        with self.assertRaisesRegex(ValueError, "immutable"):
            queue.enqueue(self.repo, self.state, self.commit, [self.image])

    def test_queued_image_bundle_requires_passing_evidence_and_retains_its_identity(self):
        directory = self.root / "bundle"
        directory.mkdir()
        ids = {"app": "sha256:" + "b" * 64, "web": "sha256:" + "c" * 64}
        for index, image_id in enumerate(ids.values(), 1):
            artifact = b"fixture"
            sha = hashlib.sha256(artifact).hexdigest()
            (directory / f"{index}-vulnerabilities.json").write_bytes(artifact)
            (directory / f"{index}-sbom.cdx.json").write_bytes(artifact)
            (directory / f"{index}-image.json").write_text(json.dumps({
                "image_id": image_id, "blocked": False, "report_sha256": sha, "sbom_sha256": sha,
            }))
        license_path = directory / "release-licenses.json"
        licenses = {"commit": self.commit, "images": ids, "packages": [
            {"scope": scope, "status": "allowed"} for scope in ("app", "web", "browser")
        ]}
        license_path.write_text(json.dumps(licenses))
        archive = directory / "images.tar.gz"
        archive.write_bytes(b"fixture archive")
        prepare = [sys.executable, queue.__file__, "prepare-image-bundle", str(directory), self.commit, *ids.values()]
        subprocess.run(prepare, check=True)
        manifest = directory / "bundle.json"
        original = manifest.read_bytes()
        sha = hashlib.sha256(original).hexdigest()
        with self.assertRaisesRegex(ValueError, "queued commit"):
            queue.verify_image_bundle(directory, "0" * 40, sha)
        licenses["packages"][0]["status"] = "review-required"
        license_path.write_text(json.dumps(licenses))
        with self.assertRaisesRegex(ValueError, "passing license"):
            queue.enqueue(self.repo, self.state, self.commit, [], directory)
        self.assertEqual(queue.jobs(self.state), [])
        licenses["packages"][0]["status"] = "allowed"
        license_path.write_text(json.dumps(licenses))
        job = queue.enqueue(self.repo, self.state, self.commit, [], directory)
        self.assertEqual(job["image_bundle"], {"directory": str(directory.resolve()), "manifest_sha256": sha})
        archive.write_bytes(b"tampered archive")
        with self.assertRaisesRegex(ValueError, "archive checksum"):
            queue.verify_image_bundle(directory, self.commit, sha)
        subprocess.run(prepare, check=True)
        with self.assertRaisesRegex(ValueError, "immutable image bundle"):
            queue.enqueue(self.repo, self.state, self.commit, [], directory)
        archive.write_bytes(b"fixture archive")
        manifest.write_bytes(original)
        with self.live():
            self.assertEqual(queue.work(self.state), 0)
        self.assertEqual((self.capture / "image-bundle").read_text().splitlines(), [str(directory.resolve()), sha])

    def test_queued_retained_scan_selection_is_immutable_and_passed_to_worker(self):
        directories = [self.root / name for name in ("retained", "changed")]
        for directory in directories:
            directory.mkdir()
            for index, code in enumerate("de", 1):
                artifact = f"{directory.name} fixture {index}".encode()
                digest = hashlib.sha256(artifact).hexdigest()
                (directory / f"{index}-vulnerabilities.json").write_bytes(artifact)
                (directory / f"{index}-sbom.cdx.json").write_bytes(artifact)
                (directory / f"{index}-image.json").write_text(json.dumps({
                    "image_id": "sha256:" + code * 64, "blocked": False,
                    "report_sha256": digest, "sbom_sha256": digest,
                }))
        retained, changed = directories
        job = queue.enqueue(self.repo, self.state, self.commit, [], retained_scans=retained)
        selection = job["retained_scans"]
        self.assertEqual(selection["directory"], str(retained.resolve()))
        with self.assertRaisesRegex(ValueError, "immutable retained scan selection"):
            queue.enqueue(self.repo, self.state, self.commit, [], retained_scans=changed)
        with self.live():
            self.assertEqual(queue.work(self.state), 0)
        self.assertEqual((self.capture / "retained-scans").read_text().splitlines(),
                         [str(retained.resolve()), selection["sha256"]])

        path = self.state / "jobs" / self.commit / "job.json"
        path.write_text(json.dumps({**queue.jobs(self.state)[0], "phase": "failed"}))
        retry = ["release-queue.py", "--state-dir", str(self.state), "retry", "--commit", self.commit,
                 "--retained-scans"]
        with patch.object(queue, "start_worker", return_value=123), patch.object(sys, "argv", [*retry, str(changed)]):
            with self.assertRaisesRegex(ValueError, "immutable retained scan selection"):
                queue.main()
        job = queue.jobs(self.state)[0]
        self.assertEqual(job["phase"], "failed")
        del job["retained_scans"]
        path.write_text(json.dumps(job))
        with patch.object(queue, "start_worker", return_value=123), patch.object(sys, "argv", [*retry, str(retained)]):
            self.assertEqual(queue.main(), 0)
        self.assertEqual(queue.jobs(self.state)[0]["retained_scans"], selection)

    def test_bootstrap_license_receipt_requires_all_transferred_images_and_browser(self):
        path = self.root / "release-licenses.json"
        ids = dict(zip(("app", "web", "postgres-staging", "clamav"), ("sha256:" + c * 64 for c in "bcde")))
        packages = [{"scope": scope, "status": "allowed"} for scope in (*ids, "browser")]
        report = {"commit": self.commit, "images": ids, "packages": packages}
        path.write_text(json.dumps(report))
        self.assertEqual(queue.verify_image_licenses(self.root, self.commit, ids),
                         hashlib.sha256(path.read_bytes()).hexdigest())
        for invalid in (
            {"commit": "0" * 40},
            {"images": ids | {"postgres-staging": ids["app"]}},
            {"packages": [row for row in packages if row["scope"] != "postgres-staging"]},
            {"packages": packages[:-1]},
            {"packages": packages[:-1] + [{"scope": "browser", "status": "review-required"}]},
        ):
            path.write_text(json.dumps(report | invalid))
            with self.assertRaisesRegex(ValueError, "passing license evidence"):
                queue.verify_image_licenses(self.root, self.commit, ids)

    def test_pushed_unaccepted_release_cannot_use_working_tree_acceptance(self):
        commit = self.publish("0.1.4", "in_progress")
        self.write_ledger("0.1.4", "accepted")
        with self.assertRaisesRegex(ValueError, "accepted milestone"):
            queue.enqueue(self.repo, self.state, commit, [])
        self.assertEqual(queue.jobs(self.state), [])

    def test_acceptance_without_gate_evidence_cannot_create_a_job(self):
        commit = self.publish("0.1.4", with_gate_evidence=False)
        with self.assertRaisesRegex(ValueError, "gate evidence"):
            queue.enqueue(self.repo, self.state, commit, [])
        self.assertEqual(queue.jobs(self.state), [])

    def test_deployment_check_uses_pushed_acceptance_without_creating_a_job(self):
        pending = self.publish("0.1.4", "in_progress")
        args = [sys.executable, queue.__file__, "--state-dir", str(self.state),
                "check-release", "--repo", str(self.repo), "--commit"]
        rejected = subprocess.run([*args, pending], capture_output=True, text=True)
        self.assertEqual(rejected.returncode, 1)
        self.assertIn("accepted milestone", rejected.stderr)
        accepted = subprocess.run([*args, self.commit], capture_output=True, text=True)
        self.assertEqual(accepted.returncode, 0, accepted.stderr)
        self.assertEqual(accepted.stdout.strip(), "0.1.3")
        self.assertFalse(self.state.exists())

    def test_more_than_one_album_is_rejected_before_a_job_is_created(self):
        images = []
        for i in range(11):
            path = self.root / f'image-{i}.png'
            path.write_bytes(b'\x89PNG\r\n\x1a\n'+str(i).encode())
            images.append(path)
        with self.assertRaisesRegex(ValueError, 'At most ten'):
            queue.enqueue(self.repo, self.state, self.commit, images)
        self.assertFalse((self.state/'jobs'/self.commit/'job.json').exists())

    def test_deploy_uses_pushed_commit_while_builder_advances_and_has_dirty_files(self):
        queue.enqueue(self.repo, self.state, self.commit, [self.image])
        newer = self.publish("0.1.4")
        (self.repo / "next-batch.txt").write_text("unfinished builder draft")
        original_umask = os.umask(0o077)
        try:
            with self.live():
                self.assertEqual(queue.work(self.state), 0)
        finally:
            os.umask(original_umask)
        self.assertEqual((self.capture / "deployed-head").read_text().strip(), self.commit)
        self.assertEqual(queue.command(self.repo, "git", "rev-parse", "HEAD", capture=True), newer)
        self.assertTrue((self.repo / "next-batch.txt").exists())
        self.assertEqual((self.repo / ".env").read_text(), "private-test-value")
        job = queue.jobs(self.state)[0]
        self.assertEqual(job["phase"], "completed")
        self.assertFalse(job["ci_required"])
        self.assertNotIn("runtime_images", job)
        notifications = [json.loads(line) for line in (self.capture / "notifications").read_text().splitlines()]
        self.assertEqual(notifications[0], ["--commit", self.commit])
        self.assertEqual(notifications[1][:3], ["--commit", self.commit, "--screenshot"])
        self.assertEqual(Path(notifications[1][3]).read_bytes(), self.image.read_bytes())
        self.assertFalse((self.state / "jobs" / self.commit / "checkout").exists())

    def test_completed_job_retains_deployment_image_receipt(self):
        receipt = {"schema_version": 1, "commit": self.commit, "image_ids": {
            name: "sha256:" + character * 64 for name, character in
            zip(("app", "web", "postgres", "clamav"), "bcde")
        }}
        queue.enqueue(self.repo, self.state, self.commit, [])
        with self.live(), patch.dict(os.environ, {
            "QUEUE_TEST_WRITE_IMAGES": "1", "QUEUE_TEST_IMAGES": json.dumps(receipt),
        }):
            self.assertEqual(queue.work(self.state), 0)
        self.assertEqual(queue.jobs(self.state)[0]["runtime_images"], receipt)
        receipt_path = self.state / "jobs" / self.commit / "runtime-images.json"
        self.assertEqual(json.loads(receipt_path.read_text()), receipt)

    def test_optional_screenshot_failure_keeps_required_confirmation_and_advances_queue(self):
        queue.enqueue(self.repo, self.state, self.commit, [self.image])
        newer = self.publish("0.1.4")
        queue.enqueue(self.repo, self.state, newer, [])
        original = queue.command
        calls = []
        def invoke(repo, *args, **kwargs):
            calls.append(args)
            if "--screenshot" in args:
                raise subprocess.CalledProcessError(1, list(args))
            return original(repo, *args, **kwargs)
        def live(*args, **kwargs):
            deployed = (self.capture / "deployed-head").read_text().strip()
            return io.BytesIO(json.dumps({
                "commit": deployed, "version": "0.1.3" if deployed == self.commit else "0.1.4",
            }).encode())
        with patch.object(queue, "command", side_effect=invoke), patch.object(queue.urllib.request, "urlopen", side_effect=live):
            self.assertEqual(queue.work(self.state), 0)
        jobs = queue.jobs(self.state)
        self.assertEqual([job["phase"] for job in jobs], ["completed", "completed"])
        self.assertEqual(jobs[0]["screenshot_warning"]["exit_code"], 1)
        self.assertNotIn("screenshot_warning", jobs[1])
        self.assertIn(("python3", "deploy/staging/notify-release.py", "--commit", self.commit), calls)
        self.assertEqual(sum("--screenshot" in call for call in calls), 1)
        self.assertFalse(any("--retry-unknown" in call for call in calls))
        self.assertEqual((self.capture / "deployed-head").read_text().strip(), newer)

    def test_optional_failure_cannot_bypass_required_announcement_confirmation(self):
        queue.enqueue(self.repo, self.state, self.commit, [self.image])
        newer = self.publish("0.1.4")
        queue.enqueue(self.repo, self.state, newer, [])
        original = queue.command
        def invoke(repo, *args, **kwargs):
            if args[:2] == ("python3", "deploy/staging/notify-release.py"):
                raise subprocess.CalledProcessError(1, list(args))
            return original(repo, *args, **kwargs)
        with patch.object(queue, "command", side_effect=invoke), self.live():
            self.assertEqual(queue.work(self.state), 1)
        self.assertEqual([job["phase"] for job in queue.jobs(self.state)], ["failed", "queued"])

    def test_optional_screenshot_failure_cannot_bypass_live_identity(self):
        queue.enqueue(self.repo, self.state, self.commit, [self.image])
        original = queue.command
        def invoke(repo, *args, **kwargs):
            if "--screenshot" in args:
                raise subprocess.CalledProcessError(1, list(args))
            return original(repo, *args, **kwargs)
        with patch.object(queue, "command", side_effect=invoke), self.live("a" * 40):
            self.assertEqual(queue.work(self.state), 1)
        self.assertEqual(queue.jobs(self.state)[0]["phase"], "failed")
        self.assertIn("Live release", queue.jobs(self.state)[0]["error"])

    def test_failed_release_stops_queue_without_automatic_retry_or_success(self):
        queue.enqueue(self.repo, self.state, self.commit, [])
        newer = self.publish("0.1.4")
        queue.enqueue(self.repo, self.state, newer, [])
        with patch.object(queue, "deploy", side_effect=RuntimeError("deployment failed")) as deploy:
            self.assertEqual(queue.work(self.state), 1)
            self.assertEqual(queue.work(self.state), 1)
            self.assertEqual(deploy.call_count, 1)
        self.assertEqual([job["phase"] for job in queue.jobs(self.state)], ["failed", "queued"])
        self.assertEqual(queue.jobs(self.state)[0]["error"], "deployment failed")

    def test_interrupted_job_requires_explicit_recovery(self):
        job = queue.enqueue(self.repo, self.state, self.commit, [])
        job["phase"] = "deploying"
        queue.save(self.state / "jobs" / self.commit / "job.json", job)
        with patch.object(queue, "deploy") as deploy:
            self.assertEqual(queue.work(self.state), 1)
            deploy.assert_not_called()
        self.assertEqual(queue.jobs(self.state)[0]["phase"], "failed")

    def test_wrong_live_identity_cannot_complete_job(self):
        queue.enqueue(self.repo, self.state, self.commit, [])
        with self.live("a" * 40):
            self.assertEqual(queue.work(self.state), 1)
        job = queue.jobs(self.state)[0]
        self.assertEqual(job["phase"], "failed")
        self.assertIn("Live release", job["error"])

    def test_unpushed_commit_invalid_identity_and_invalid_image_are_rejected(self):
        (self.repo / "package.json").write_text('{"version":"0.1.4"}')
        queue.command(self.repo, "git", "add", "package.json")
        queue.command(self.repo, "git", "commit", "-m", "unpublished", capture=True)
        unpublished = queue.command(self.repo, "git", "rev-parse", "HEAD", capture=True)
        with self.assertRaises(subprocess.CalledProcessError):
            queue.enqueue(self.repo, self.state, unpublished, [])
        with self.assertRaisesRegex(ValueError, "40-character"):
            queue.enqueue(self.repo, self.state, "main; unexpected-command", [])
        self.image.write_text("not an image")
        with self.assertRaisesRegex(ValueError, "PNG"):
            queue.enqueue(self.repo, self.state, self.commit, [self.image])
        self.assertEqual(queue.jobs(self.state), [])

    def test_different_commit_cannot_reuse_queued_version(self):
        queue.enqueue(self.repo, self.state, self.commit, [])
        (self.repo / "new-file").write_text("different release")
        queue.command(self.repo, "git", "add", "new-file")
        newer = self.publish("0.1.3")
        with self.assertRaisesRegex(ValueError, "already uses"):
            queue.enqueue(self.repo, self.state, newer, [])
        self.assertEqual(len(queue.jobs(self.state)), 1)

    def test_enqueue_worker_returns_while_another_worker_holds_the_lock(self):
        processes = []
        real_popen = subprocess.Popen
        def spawn(*args, **kwargs):
            process = real_popen(*args, **kwargs)
            processes.append(process)
            return process
        with queue.locked(self.state, "worker.lock"):
            started = time.monotonic()
            with patch.object(queue.subprocess, "Popen", side_effect=spawn):
                pid = queue.start_worker(self.state)
            self.assertLess(time.monotonic() - started, 1)
            self.assertEqual(processes[0].pid, pid)
            self.assertIsNone(processes[0].poll())
        try:
            self.assertEqual(processes[0].wait(timeout=5), 0)
        finally:
            if processes[0].poll() is None:
                processes[0].terminate()
                processes[0].wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
