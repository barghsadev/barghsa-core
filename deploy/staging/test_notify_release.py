import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("notify_release", Path(__file__).with_name("notify-release.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseNotificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)
        self.metadata = {"version": "0.1.0", "commit": "a" * 40}
        self.channel = {"id": -100123, "type": "channel", "username": "barghsa_releases"}
        self.text = "برقسا نسخه 0.1.0\n\n- A verified batch change."

    def call(self, method, payload):
        if method == "getChat":
            return self.channel
        self.assertEqual(method, "sendMessage")
        self.assertEqual(payload["chat_id"], self.channel["id"])
        self.assertEqual(payload["text"], self.text)
        return {"message_id": 12, "text": self.text, "chat": self.channel}

    def announce(self, **kwargs):
        release.announce(self.metadata, self.text, "synthetic", "@barghsa_releases", self.root, **kwargs)

    def test_live_identity_gate_and_confirmed_duplicate(self):
        with patch.object(release, "telegram_call", side_effect=lambda token, method, payload: self.call(method, payload)) as api, patch.object(release, "request_json", return_value=self.metadata):
            self.announce()
            self.announce()
            self.assertEqual([call.args[1] for call in api.call_args_list].count("sendMessage"), 1)
        receipt = json.loads(next(self.root.glob("*.json")).read_text())
        self.assertEqual(receipt["status"], "sent")
        self.assertEqual(receipt["message_id"], 12)
        self.assertNotIn("synthetic", json.dumps(receipt))

    def test_wrong_deployed_commit_never_sends(self):
        with patch.object(release, "telegram_call", return_value=self.channel) as api, patch.object(release, "request_json", return_value={**self.metadata, "commit": "b" * 40}):
            with self.assertRaisesRegex(ValueError, "do not match"):
                self.announce()
            self.assertEqual(api.call_count, 1)
            self.assertFalse(list(self.root.glob("*.json")))

    def test_unconfirmed_send_is_retained_and_never_automatically_retried(self):
        def failed(token, method, payload):
            if method == "getChat":
                return self.channel
            raise ValueError("Network result unknown")
        with patch.object(release, "telegram_call", side_effect=failed) as api, patch.object(release, "request_json", return_value=self.metadata):
            with self.assertRaisesRegex(ValueError, "Network result unknown"):
                self.announce()
            with self.assertRaisesRegex(ValueError, "outcome is unknown"):
                self.announce()
            self.assertEqual([call.args[1] for call in api.call_args_list].count("sendMessage"), 1)
        with patch.object(release, "telegram_call", side_effect=lambda token, method, payload: self.call(method, payload)), patch.object(release, "request_json", return_value=self.metadata):
            self.announce(retry_unknown=True)

    def test_wrong_message_receipt_cannot_record_success(self):
        with patch.object(release, "telegram_call", side_effect=[self.channel, {"message_id": 12, "text": self.text, "chat": {"id": -999}}]), patch.object(release, "request_json", return_value=self.metadata):
            with self.assertRaisesRegex(ValueError, "receipt did not match"):
                self.announce()
        self.assertEqual(json.loads(next(self.root.glob("*.json")).read_text())["status"], "unknown")

    def test_channel_identity_rejects_dm_group_and_wrong_destination(self):
        for channel in [{**self.channel, "type": "private"}, {**self.channel, "type": "supergroup"}, {**self.channel, "username": "different_channel"}]:
            with self.subTest(channel=channel), self.assertRaises(ValueError):
                release.verify_channel(channel, "@barghsa_releases")
        release.verify_channel(self.channel, "-100123")

    def test_notes_require_matching_semver_changes_and_message_length(self):
        (self.root / "releases").mkdir()
        (self.root / "package.json").write_text(json.dumps({"version": "0.1.0"}))
        notes = self.root / "releases/0.1.0.md"
        notes.write_text("برقسا نسخه 0.1.0\n\n- Verified change.")
        metadata, text = release.release_details(self.root, "a" * 40)
        self.assertEqual(metadata, self.metadata)
        self.assertIn("- Verified change.", text)
        for invalid in ["برقسا نسخه 0.0.9\n\n- Stale notes.", "برقسا نسخه 0.1.0\nNo changes", "برقسا نسخه 0.1.0\n- " + "x" * 4096]:
            notes.write_text(invalid)
            with self.assertRaises(ValueError):
                release.release_details(self.root, "a" * 40)
        (self.root / "package.json").write_text(json.dumps({"version": "01.1.0"}))
        with self.assertRaisesRegex(ValueError, "MAJOR.MINOR.PATCH"):
            release.release_details(self.root, "a" * 40)

    def test_private_config_and_invalid_secret_are_rejected_without_exposure(self):
        config = self.root / "telegram.json"
        synthetic = "123" + ":" + "synthetic_bot_credential"
        config.write_text(json.dumps({"bot_token": synthetic, "chat_id": "@barghsa_releases"}))
        with patch.dict(os.environ, {"BARGHSA_TELEGRAM_CONFIG": str(config)}, clear=True):
            config.chmod(0o644)
            with self.assertRaisesRegex(ValueError, "permissions 600"):
                release.telegram_config()
            config.chmod(0o600)
            self.assertEqual(release.telegram_config(), (synthetic, "@barghsa_releases"))
            config.write_text(json.dumps({"bot_token": "malformed", "chat_id": "@barghsa_releases"}))
            with self.assertRaisesRegex(ValueError, "missing or malformed"):
                release.telegram_config()

    def test_screenshot_multipart_preserves_bytes_and_persian_caption(self):
        data = b"\x89PNG\r\n\x1a\n" + b"synthetic image bytes"
        caption = "تصویر محیط آزمایشی برقسا، نسخه 0.1.0"
        with patch.object(release.urllib.request, "urlopen", return_value=io.BytesIO(b'{"ok":true}')) as send:
            self.assertEqual(release.request_json("https://example.test", {"chat_id": -100123, "caption": caption}, data), {"ok": True})
        request = send.call_args.args[0]
        self.assertIn(data, request.data)
        self.assertIn(caption.encode(), request.data)
        self.assertIn(b'name="photo"; filename="screenshot.png"', request.data)
        self.assertTrue(request.get_header("Content-type").startswith("multipart/form-data; boundary="))

    def test_screenshots_confirm_once_and_reject_a_wrong_receipt(self):
        data = b"\x89PNG\r\n\x1a\n" + b"synthetic image bytes"
        def send(token, method, payload, photo=None):
            if method == "getChat":
                return self.channel
            self.assertEqual(method, "sendPhoto")
            self.assertEqual(photo, data)
            return {"message_id": 13, "caption": payload["caption"], "chat": self.channel, "photo": [{"file_id": "synthetic"}]}
        with patch.object(release, "telegram_call", side_effect=send) as api, patch.object(release, "request_json", return_value=self.metadata):
            for _ in range(2):
                release.announce_screenshots(self.metadata, "synthetic", "@barghsa_releases", self.root, [data])
            self.assertEqual([call.args[1] for call in api.call_args_list].count("sendPhoto"), 1)
        other = self.root / "unknown"
        with patch.object(release, "telegram_call", side_effect=[self.channel, {"message_id": 13}]), patch.object(release, "request_json", return_value=self.metadata):
            with self.assertRaisesRegex(ValueError, "screenshot receipt did not match"):
                release.announce_screenshots(self.metadata, "synthetic", "@barghsa_releases", other, [data])
        with patch.object(release, "telegram_call", return_value=self.channel) as api, patch.object(release, "request_json", return_value=self.metadata):
            with self.assertRaisesRegex(ValueError, "screenshot outcome is unknown"):
                release.announce_screenshots(self.metadata, "synthetic", "@barghsa_releases", other, [data])
            self.assertEqual(api.call_count, 1)

    def test_deployment_announces_only_after_success_and_preflight_precedes_images(self):
        # Execute the real deployment script against subprocess stubs, with no network or Docker writes.
        staging = self.root / "deploy/staging"
        staging.mkdir(parents=True)
        shutil.copy(Path(__file__).with_name("deploy.sh"), staging / "deploy.sh")
        bins = self.root / "bin"
        bins.mkdir()
        log = self.root / "calls.log"
        stub = """#!/usr/bin/env python3
import os,pathlib,sys
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
with pathlib.Path(os.environ['CALL_LOG']).open('a') as log: log.write(name+' '+ ' '.join(args)+'\\n')
if name=='git' and args==['rev-parse','HEAD']: print('a'*40)
elif name=='git' and args==['rev-parse','--short=12','HEAD']: print('a'*12)
elif name=='python3' and '--check' in args: sys.exit(int(os.environ.get('FAIL_PREFLIGHT','0')))
elif name=='ssh' and args[-1]=='gzip -d | docker load': sys.stdin.buffer.read()
elif name=='ssh' and 'grep -E' in args[-1]: print('BARGHSA_POSTGRES_IMAGE=barghsa-postgres:vps-existing\\nBARGHSA_CLAMAV_IMAGE=barghsa-clamav:vps-existing')
elif name=='ssh' and args[-1].startswith('/usr/local/sbin/barghsa-staging-release '): sys.exit(int(os.environ.get('FAIL_RELEASE','0')))
"""
        for name in ["git", "python3", "ssh", "scp", "docker"]:
            file = bins / name
            file.write_text(stub.replace("#!/usr/bin/env python3", f"#!{sys.executable}"))
            file.chmod(0o700)
        for failure in ["FAIL_PREFLIGHT", "FAIL_RELEASE", None]:
            with self.subTest(failure=failure):
                log.unlink(missing_ok=True)
                env = {**os.environ, "PATH": str(bins) + os.pathsep + os.environ["PATH"], "CALL_LOG": str(log)}
                if failure:
                    env[failure] = "1"
                result = subprocess.run(["bash", str(staging / "deploy.sh")], env=env, capture_output=True, text=True)
                calls = log.read_text().splitlines()
                sends = [line for line in calls if line.startswith('python3 deploy/staging/notify-release.py') and '--check' not in line]
                self.assertEqual(len(sends), 0 if failure else 1)
                self.assertEqual(result.returncode, 1 if failure else 0, result.stderr)
                if failure == "FAIL_PREFLIGHT":
                    self.assertFalse(any(line.startswith('docker ') or line.startswith('ssh ') for line in calls))
                else:
                    self.assertTrue(any('--build-arg BARGHSA_RELEASE_SHA=' + 'a'*40 in line for line in calls))


if __name__ == "__main__":
    unittest.main()
