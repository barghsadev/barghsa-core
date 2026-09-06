import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "check_secrets", Path(__file__).with_name("check-secrets.py")
)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


class SecretScanTests(unittest.TestCase):
    def test_rejects_changed_download_before_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(scanner.platform, "system", return_value="Linux"), patch.object(
                scanner.platform, "machine", return_value="x86_64"
            ), patch.object(scanner.urllib.request, "urlopen", return_value=io.BytesIO(b"changed")):
                with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                    scanner.install(Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_extracts_only_verified_binary_without_trusting_archive_paths(self):
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode="w:gz") as archive:
            for name in ["gitleaks", "../outside"]:
                member = tarfile.TarInfo(name)
                member.size = 7
                archive.addfile(member, io.BytesIO(b"fixture"))
        data = payload.getvalue()
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "extracted"
            destination.mkdir()
            with patch.object(scanner.platform, "system", return_value="Fixture"), patch.object(
                scanner.platform, "machine", return_value="fixture"
            ), patch.dict(scanner.ARCHIVES, {
                ("Fixture", "fixture"): ("fixture", hashlib.sha256(data).hexdigest())
            }), patch.object(scanner.urllib.request, "urlopen", return_value=io.BytesIO(data)):
                binary = scanner.install(destination)
            self.assertEqual(binary.read_bytes(), b"fixture")
            self.assertEqual(list(destination.iterdir()), [binary])
            self.assertFalse((Path(directory) / "outside").exists())

    def test_scan_keeps_failure_code_and_requires_redaction_and_all_history(self):
        with patch.object(scanner.subprocess, "run", return_value=SimpleNamespace(returncode=2)) as run:
            self.assertEqual(scanner.scan(Path("binary"), Path("repo"), Path("report"), Path("ignore")), 2)
        args = run.call_args.args[0]
        self.assertIn("--redact", args)
        self.assertIn("--log-opts=--all", args)
        self.assertIn("--gitleaks-ignore-path=ignore", args)
        self.assertNotIn("--exit-code=0", args)

    def test_shallow_history_fails_before_tool_download(self):
        with patch("sys.argv", ["check-secrets.py", "--report", "/tmp/unused-report.json"]), patch.object(
            scanner.subprocess, "check_output", return_value="true\n"
        ), patch.object(scanner, "install") as install:
            with self.assertRaisesRegex(RuntimeError, "complete Git history"):
                scanner.main()
        install.assert_not_called()


if __name__ == "__main__":
    unittest.main()
