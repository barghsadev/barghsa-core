import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release_queue", Path(__file__).with_name("release-queue.py"))
queue = importlib.util.module_from_spec(spec)
spec.loader.exec_module(queue)


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

    def publish(self, version):
        (self.repo / "package.json").write_text(json.dumps({"version": version}))
        queue.command(self.repo, "git", "add", ".gitignore", "package.json", "deploy")
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
        with self.live():
            self.assertEqual(queue.work(self.state), 0)
        self.assertEqual((self.capture / "deployed-head").read_text().strip(), self.commit)
        self.assertEqual(queue.command(self.repo, "git", "rev-parse", "HEAD", capture=True), newer)
        self.assertTrue((self.repo / "next-batch.txt").exists())
        self.assertEqual((self.repo / ".env").read_text(), "private-test-value")
        job = queue.jobs(self.state)[0]
        self.assertEqual(job["phase"], "completed")
        self.assertFalse(job["ci_required"])
        notifications = [json.loads(line) for line in (self.capture / "notifications").read_text().splitlines()]
        self.assertEqual(notifications[0], ["--commit", self.commit])
        self.assertEqual(notifications[1][:3], ["--commit", self.commit, "--screenshot"])
        self.assertEqual(Path(notifications[1][3]).read_bytes(), self.image.read_bytes())
        self.assertFalse((self.state / "jobs" / self.commit / "checkout").exists())

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
