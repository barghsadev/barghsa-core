import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
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

    def test_album_upload_binds_each_attachment_and_accepts_array_result(self):
        images = [b'first original PNG bytes', b'second original PNG bytes']
        payload = {'chat_id': -100123, 'media': json.dumps([
            {'type': 'photo', 'media': 'attach://image0'},
            {'type': 'photo', 'media': 'attach://image1'},
        ])}
        response = io.BytesIO(b'{"ok":true,"result":[{"message_id":21},{"message_id":22}]}')
        with patch.object(release.urllib.request, 'urlopen', return_value=response) as api:
            result = release.telegram_call('synthetic', 'sendMediaGroup', payload, images)
        self.assertEqual([r['message_id'] for r in result], [21, 22])
        request = api.call_args.args[0]
        for i, data in enumerate(images):
            self.assertIn(f'name="image{i}"'.encode(), request.data)
            self.assertIn(f'attach://image{i}'.encode(), request.data)
            self.assertIn(data, request.data)

    def test_two_or_ten_screenshots_use_one_album_and_cannot_add_another(self):
        for count in [2, 10]:
            with self.subTest(count=count):
                state = self.root / str(count)
                images = [f'original {i}'.encode() for i in range(count)]
                def send(token, method, payload, photo=None):
                    if method == 'getChat': return self.channel
                    self.assertEqual(method, 'sendMediaGroup')
                    self.assertEqual(photo, images)
                    media = json.loads(payload['media'])
                    return [{'message_id': 100+i, 'chat': self.channel, 'photo': [{'file_id': f'photo-{i}'}],
                             'media_group_id': 'one-album', **({'caption': media[0]['caption']} if i==0 else {})}
                            for i in range(count)]
                with patch.object(release, 'telegram_call', side_effect=send) as api, patch.object(release, 'request_json', return_value=self.metadata):
                    for _ in range(2):
                        release.announce_screenshots(self.metadata, 'synthetic', '@barghsa_releases', state, images)
                    with self.assertRaisesRegex(ValueError, 'no additional post'):
                        release.announce_screenshots(self.metadata, 'synthetic', '@barghsa_releases', state, [b'new capture'])
                self.assertEqual(sum(c.args[1]=='sendMediaGroup' for c in api.call_args_list), 1)
                receipt = json.loads(next(state.glob('album-*.json')).read_text())
                self.assertEqual(receipt['status'], 'sent')
                self.assertEqual(len(receipt['message_ids']), count)

    def test_album_unknown_and_wrong_group_never_confirm_or_blindly_resend(self):
        images = [b'first', b'second']
        def send(token, method, payload, photo=None):
            if method == 'getChat': return self.channel
            media = json.loads(payload['media'])
            return [{'message_id': 21+i, 'chat': self.channel, 'photo':[{'file_id':'photo'}],
                     'caption':media[0]['caption'] if i==0 else '', 'media_group_id':str(i)} for i in range(2)]
        with patch.object(release, 'telegram_call', side_effect=send) as api, patch.object(release, 'request_json', return_value=self.metadata):
            with self.assertRaisesRegex(ValueError, 'one grouped update'):
                release.announce_screenshots(self.metadata, 'synthetic', '@barghsa_releases', self.root, images)
            with self.assertRaisesRegex(ValueError, 'outcome is unknown'):
                release.announce_screenshots(self.metadata, 'synthetic', '@barghsa_releases', self.root, images)
        self.assertEqual(sum(c.args[1]=='sendMediaGroup' for c in api.call_args_list), 1)
        self.assertEqual(json.loads(next(self.root.glob('album-*.json')).read_text())['status'], 'unknown')

    def test_album_limit_rejects_before_any_remote_call(self):
        with patch.object(release, 'telegram_call') as api:
            with self.assertRaisesRegex(ValueError, 'at most ten'):
                release.announce_screenshots(self.metadata, 'synthetic', '@barghsa_releases', self.root, [b'photo']*11)
            api.assert_not_called()

    def test_legacy_receipts_do_not_create_an_extra_album(self):
        import hashlib
        image = b'legacy capture'
        prior = {**self.metadata, 'chat_id':self.channel['id'], 'photo_sha256':hashlib.sha256(image).hexdigest(), 'status':'sent', 'message_id':13}
        (self.root/'photo-legacy.json').write_text(json.dumps(prior))
        with patch.object(release, 'telegram_call', return_value=self.channel) as api, patch.object(release, 'request_json', return_value=self.metadata):
            release.announce_screenshots(self.metadata, 'synthetic', '@barghsa_releases', self.root, [image])
            with self.assertRaisesRegex(ValueError, 'Legacy screenshot receipts'):
                release.announce_screenshots(self.metadata, 'synthetic', '@barghsa_releases', self.root, [image,b'new'])
        self.assertTrue(all(c.args[1]=='getChat' for c in api.call_args_list))

    def test_deployment_announces_only_after_success_and_preflight_precedes_images(self):
        # Execute the real deployment script against subprocess stubs, with no network or Docker writes.
        staging = self.root / "deploy/staging"
        staging.mkdir(parents=True)
        for script in ("deploy.sh", "build-postgres-image.sh", "release-queue.py"):
            shutil.copy(Path(__file__).with_name(script), staging / script)
        bins = self.root / "bin"
        bins.mkdir()
        log = self.root / "calls.log"
        scripts = self.root / "scripts"
        scripts.mkdir()
        (scripts / "check-runtime-images.sh").write_text('exec scan-runtime "$@"\n')
        stub = """#!/usr/bin/env python3
import hashlib,json,os,pathlib,subprocess,sys
name=pathlib.Path(sys.argv[0]).name
args=sys.argv[1:]
with pathlib.Path(os.environ['CALL_LOG']).open('a') as log: log.write(name+' '+ ' '.join(args)+'\\n')
prefixes={'barghsa-app:':'b','barghsa-web:':'c','barghsa-postgres:':'d','barghsa-clamav:':'e'}
def identity(tag):
    return 'sha256:'+next(letter for prefix,letter in prefixes.items() if tag.startswith(prefix))*64
if name=='git' and args==['rev-parse','HEAD']: print('a'*40)
elif name=='git' and args==['rev-parse','--short=12','HEAD']: print('a'*12)
elif name=='python3' and args[:2]==['deploy/staging/release-queue.py','check-release']:
    if os.environ.get('FAIL_ACCEPTANCE'): sys.exit(1)
    print('0.6.0')
elif name=='python3' and args==['kanban/scripts/board.py','ready','--release','0.6.0']:
    sys.exit(int(os.environ.get('FAIL_READINESS','0')))
elif name=='python3' and args[1] in ('verify-images','verify-image-bundle','verify-retained-scans'):
    if args[1]=='verify-images' and os.environ.get('CHANGE_RETAINED_AFTER_TRANSFER'):
        path=pathlib.Path(args[args.index('--retained-scans')+1])/'2-sbom.cdx.json'
        path.write_text('tampered')
    if args[1]=='verify-images' and os.environ.get('CHANGE_RETAINED_LICENSE_AFTER_TRANSFER'):
        path=pathlib.Path(args[args.index('--retained-license-report')+1])
        path.write_bytes(path.read_bytes()+b' ')
    os.execv(sys.executable,[sys.executable,*args])
elif name=='python3' and args[0]=='scripts/check-release-licenses.py' and args[3]=='--staging-retained':
    assert args[4:7]==['sha256:'+'d'*64,'sha256:'+'e'*64,'--report']
    if os.environ.get('FAIL_RETAINED_LICENSE'): sys.exit(1)
    ids=dict(zip(('postgres-staging','clamav'),args[4:6]))
    pathlib.Path(args[7]).write_text(json.dumps({
        'commit': args[2], 'images': ids, 'packages': [
            {'scope':scope,'status':'allowed'} for scope in ids
        ],
    }))
elif name=='python3' and args[0]=='scripts/check-release-licenses.py':
    assert args[3:6]==['--staging-local','bootstrap' if os.environ['FRESH_STAGING']=='1' else 'initialized','--report']
    if os.environ.get('FAIL_LICENSE'): sys.exit(1)
    ids={scope:'sha256:'+value*64 for scope,value in [('app','b'),('web','c')]}
    if args[4]=='bootstrap': ids.update({'postgres-staging':'sha256:'+'d'*64,'clamav':'sha256:'+'e'*64})
    pathlib.Path(args[6]).write_text(json.dumps({
        'commit': args[2], 'images': ids, 'packages': [
            {'scope':scope,'status':'allowed'} for scope in [*ids,'browser']
        ],
    }))
elif name=='python3' and '--check' in args: sys.exit(int(os.environ.get('FAIL_PREFLIGHT','0')))
elif name=='docker' and args[:2]==['image','inspect']: print(identity(args[-1]))
elif name=='sha256sum':
    assert args==['--check','--status']
    expected,path=sys.stdin.read().rstrip('\\n').split('  ',1)
    sys.exit(int(hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()!=expected))
elif name=='scan-runtime':
    if os.environ.get('FAIL_SCAN'): sys.exit(1)
    root=pathlib.Path(args[0])
    for index,tag in enumerate(args[1:],1):
        payload=json.dumps({'fixture':tag}).encode()
        sha=hashlib.sha256(payload).hexdigest()
        (root/f'{index}-vulnerabilities.json').write_bytes(payload)
        (root/f'{index}-sbom.cdx.json').write_bytes(payload)
        (root/f'{index}-image.json').write_text(json.dumps({'image_id':identity(tag),'blocked':False,'report_sha256':sha,'sbom_sha256':sha}))
elif name=='ssh' and args[-1]=='gzip -d | docker load': sys.stdin.buffer.read()
elif name=='ssh' and args[-1].startswith('bash -c '):
    archive=sys.stdin.buffer.read()
    if os.environ.get('CORRUPT_TRANSFER'): archive+=b'tampered'
    sys.exit(subprocess.run(['bash','-c',args[-1]],input=archive).returncode)
elif name=='ssh' and args[-1]=='test -r /etc/barghsa/staging/active-images.env': sys.exit(int(os.environ['FRESH_STAGING']))
elif name=='ssh' and 'grep -E' in args[-1] and os.environ['FRESH_STAGING']=='0': print('BARGHSA_POSTGRES_IMAGE=barghsa-postgres:vps-existing\\nBARGHSA_CLAMAV_IMAGE=barghsa-clamav:vps-existing')
elif name=='ssh' and args[-1].startswith('docker image inspect '):
    print('sha256:'+'d'*64)
    print('unknown' if os.environ.get('INVALID_RETAINED_ID') else 'sha256:'+'e'*64)
elif name=='scp' and pathlib.Path(args[-2]).name=='candidate.env':
    manifest=dict(line.split('=',1) for line in pathlib.Path(args[-2]).read_text().splitlines())
    assert manifest['BARGHSA_POSTGRES_IMAGE_ID']=='sha256:'+'d'*64
    assert manifest['BARGHSA_CLAMAV_IMAGE_ID']=='sha256:'+'e'*64
elif name=='ssh' and args[-1].startswith('/usr/local/sbin/barghsa-staging-release '):
    if not os.environ.get('MISSING_BACKUP'):
        backup = {'disposable': True} if os.environ['FRESH_STAGING']=='1' else {
            'version':1,'label':'release-'+'a'*12+'-20261113T230000Z-123',
            'system_id':'123456','blob':'blobs/'+'d'*32+'.tar.gpg','size':42000,
            'sha256':'f'*64,'upload_verified':True,
        }
        print('BARGHSA_STAGING_MIGRATION_BACKUP_V1',json.dumps(backup))
    if not os.environ.get('MISSING_IMAGES'):
        app='f' if os.environ.get('WRONG_IMAGES') else 'b'
        clamav='f' if os.environ.get('WRONG_RETAINED_ID') else 'e'
        print('BARGHSA_STAGING_RUNTIME_IMAGES_V1','a'*40,*('sha256:'+c*64 for c in (app,'c','d',clamav)))
    sys.exit(int(os.environ.get('FAIL_RELEASE','0')))
"""
        for name in ["git", "python3", "ssh", "scp", "docker", "scan-runtime", "sha256sum"]:
            file = bins / name
            file.write_text(stub.replace("#!/usr/bin/env python3", f"#!{sys.executable}"))
            file.chmod(0o700)
        bundle = self.root / "bundle"
        bundle.mkdir()
        subprocess.run(
            [str(bins / "scan-runtime"), str(bundle), "barghsa-app:fixture", "barghsa-web:fixture"],
            env={**os.environ, "CALL_LOG": str(log)}, check=True,
        )
        (bundle / "images.tar.gz").write_bytes(b"image archive fixture")
        (bundle / "release-licenses.json").write_text(json.dumps({
            "commit": "a" * 40, "images": {"app": "sha256:" + "b" * 64, "web": "sha256:" + "c" * 64},
            "packages": [{"scope": scope, "status": "allowed"} for scope in ("app", "web", "browser")],
        }))
        subprocess.run([
            sys.executable, str(staging / "release-queue.py"), "prepare-image-bundle", str(bundle), "a" * 40,
            "sha256:" + "b" * 64, "sha256:" + "c" * 64,
        ], check=True)
        bundle_sha = hashlib.sha256((bundle / "bundle.json").read_bytes()).hexdigest()
        retained = self.root / "retained"
        retained.mkdir()
        subprocess.run(
            [str(bins / "scan-runtime"), str(retained), "barghsa-postgres:retained", "barghsa-clamav:retained"],
            env={**os.environ, "CALL_LOG": str(log)}, check=True,
        )
        retained_sha = runpy.run_path(str(staging / "release-queue.py"))["verify_retained_scans"](retained)["sha256"]
        retained_sbom = retained / "2-sbom.cdx.json"
        retained_sbom_bytes = retained_sbom.read_bytes()
        scenarios = [(failure, False, False) for failure in (
            "FAIL_ACCEPTANCE", "FAIL_READINESS", "FAIL_PREFLIGHT", "FAIL_SCAN", "FAIL_LICENSE", "FAIL_RELEASE", "MISSING_IMAGES", "WRONG_IMAGES", "MISSING_BACKUP", None,
            "INVALID_RETAINED_ID", "WRONG_RETAINED_ID", "ABSENT_RETAINED_EVIDENCE", "WRONG_RETAINED_EVIDENCE",
            "CHANGE_RETAINED_AFTER_TRANSFER", "FAIL_RETAINED_LICENSE", "CHANGE_RETAINED_LICENSE_AFTER_TRANSFER",
        )]
        for failure, fresh, prebuilt in [*scenarios, (None, True, False), ("FAIL_LICENSE", True, False), (None, False, True),
                                        ("CORRUPT_TRANSFER", False, True), ("FAIL_RETAINED_LICENSE", False, True)]:
            with self.subTest(failure=failure, fresh=fresh, prebuilt=prebuilt):
                log.unlink(missing_ok=True)
                receipt = self.root / "runtime-images.json"
                receipt.unlink(missing_ok=True)
                env = {
                    **os.environ,
                    "HOME": str(self.root),
                    "PATH": str(bins) + os.pathsep + os.environ["PATH"],
                    "CALL_LOG": str(log),
                    "FRESH_STAGING": str(int(fresh)),
                }
                if failure:
                    env[failure] = "1"
                command = ["bash", str(staging / "deploy.sh")]
                if not fresh:
                    command.append(str(receipt))
                if prebuilt:
                    command.extend([str(bundle), bundle_sha])
                if not fresh and failure != "ABSENT_RETAINED_EVIDENCE":
                    if not prebuilt:
                        command.extend(["", ""])
                    command.extend([str(retained), "0" * 64 if failure == "WRONG_RETAINED_EVIDENCE" else retained_sha])
                retained_sbom.write_bytes(retained_sbom_bytes)
                result = subprocess.run(command, env=env, capture_output=True, text=True)
                calls = log.read_text().splitlines()
                sends = [line for line in calls if line.startswith('python3 deploy/staging/notify-release.py') and '--check' not in line]
                acceptance = 'python3 deploy/staging/release-queue.py check-release --commit ' + 'a'*40
                readiness = 'python3 kanban/scripts/board.py ready --release 0.6.0'
                preflight = 'python3 deploy/staging/notify-release.py --check --commit ' + 'a'*40
                self.assertIn(acceptance, calls)
                self.assertEqual(len(sends), 0 if failure else 1, result.stderr)
                self.assertEqual(result.returncode, 1 if failure else 0, result.stderr)
                self.assertEqual(receipt.exists(), not failure and not fresh)
                if not failure:
                    verification = next(line for line in calls if 'release-queue.py verify-images' in line)
                    self.assertLess(calls.index(verification), calls.index(sends[0]))
                    if not fresh:
                        retained_check = next(line for line in calls if '--staging-retained' in line)
                        transfer = next(line for line in calls if line.startswith(('docker save ', 'docker load ')))
                        self.assertLess(calls.index(retained_check), calls.index(transfer))
                        evidence = json.loads(receipt.read_text())
                        self.assertEqual(evidence["schema_version"], 1)
                        self.assertEqual(evidence["commit"], "a" * 40)
                        self.assertEqual(evidence["migration_backup"], {
                            "status": "verified", "label": "release-" + "a" * 12 + "-20261113T230000Z-123",
                            "system_id": "123456", "blob": "blobs/" + "d" * 32 + ".tar.gpg",
                            "size": 42000, "sha256": "f" * 64,
                        })
                        self.assertEqual(evidence["image_ids"], dict(zip(
                            ("app", "web", "postgres", "clamav"), ("sha256:" + c * 64 for c in "bcde"),
                        )))
                        self.assertEqual(set(evidence["image_scans"]["images"]), {"app", "web"})
                        self.assertEqual(set(evidence["retained_image_scans"]["images"]), {"postgres", "clamav"})
                        self.assertEqual(evidence["retained_image_scans"]["sha256"], retained_sha)
                        license_report = Path(evidence["image_scans"]["directory"]) / "release-licenses.json"
                        self.assertEqual(evidence["license_sha256"], hashlib.sha256(license_report.read_bytes()).hexdigest())
                        retained_report = Path(evidence["retained_license_report"])
                        self.assertEqual(evidence["retained_license_sha256"], hashlib.sha256(retained_report.read_bytes()).hexdigest())
                        self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
                if failure == "FAIL_ACCEPTANCE":
                    self.assertNotIn(readiness, calls)
                else:
                    self.assertLess(calls.index(acceptance), calls.index(readiness))
                if failure in {"FAIL_ACCEPTANCE", "FAIL_READINESS"}:
                    self.assertNotIn(preflight, calls)
                else:
                    self.assertLess(calls.index(readiness), calls.index(preflight))
                if failure in {"FAIL_ACCEPTANCE", "FAIL_READINESS", "FAIL_PREFLIGHT"}:
                    self.assertFalse(any(line.startswith('docker ') or line.startswith('ssh ') for line in calls))
                elif failure == "INVALID_RETAINED_ID":
                    self.assertIn("Invalid PostgreSQL or ClamAV image ID", result.stderr)
                    self.assertFalse(any(line.startswith(("docker ", "scp ")) for line in calls))
                elif failure in {"ABSENT_RETAINED_EVIDENCE", "WRONG_RETAINED_EVIDENCE"}:
                    self.assertIn("retained", result.stderr)
                    self.assertFalse(any(line.startswith(("docker ", "scp ")) for line in calls))
                elif failure == "FAIL_RETAINED_LICENSE":
                    self.assertTrue(any("--staging-retained" in line for line in calls))
                    self.assertFalse(any(line.startswith(("docker ", "scp ")) for line in calls))
                elif prebuilt:
                    self.assertFalse(any(line.startswith(("docker build ", "docker save ", "scan-runtime "))
                                         or "--staging-local" in line for line in calls))
                    self.assertEqual(sum(line.startswith("docker load ") for line in calls), 0 if failure else 1)
                    if failure:
                        self.assertFalse(any(line.startswith("scp ") for line in calls))
                else:
                    for dockerfile in ('Dockerfile.base', 'Dockerfile.web'):
                        builds = [line for line in calls if line.startswith('docker build ') and f'-f {dockerfile} ' in line]
                        self.assertEqual(len(builds), 1)
                        self.assertIn('--build-arg BARGHSA_RELEASE_SHA=' + 'a'*40, builds[0])
                    tag = 'vps-' + 'a'*40
                    helper = (
                        'docker build --platform linux/amd64 -f packages/db/scripts/backup/Dockerfile '
                        f'-t barghsa-postgres-helpers:{tag} .'
                    )
                    postgres = (
                        'docker buildx build --load --platform linux/amd64 '
                        '--no-cache-filter ubuntu-archive,runtime,build,staging '
                        f'--build-arg BACKUP_HELPERS_IMAGE=barghsa-postgres-helpers:{tag} '
                        f'-f deploy/staging/Dockerfile.postgres -t barghsa-postgres:{tag} .'
                    )
                    scan = next(line for line in calls if line.startswith('scan-runtime '))
                    if failure == "FAIL_SCAN":
                        self.assertFalse(any(line.startswith(('docker save ', 'scp ')) for line in calls))
                        continue
                    license_check = next(line for line in calls if '--staging-local' in line)
                    self.assertLess(calls.index(scan), calls.index(license_check))
                    if failure == "FAIL_LICENSE":
                        self.assertFalse(any(line.startswith(('docker save ', 'scp ')) for line in calls))
                        continue
                    transfer = next(line for line in calls if line.startswith('docker save '))
                    self.assertLess(calls.index(license_check), calls.index(transfer))
                    if fresh:
                        self.assertLess(calls.index(helper), calls.index(postgres))
                        self.assertLess(calls.index(postgres), calls.index(transfer))
                        self.assertIn(f'barghsa-postgres:{tag}', transfer.split())
                        self.assertNotIn(f'barghsa-postgres-helpers:{tag}', transfer.split())
                    else:
                        self.assertNotIn(helper, calls)
                        self.assertNotIn(postgres, calls)
                        self.assertFalse(any(image.startswith('barghsa-postgres:') for image in transfer.split()))


if __name__ == "__main__":
    unittest.main()
