from contextlib import redirect_stderr
from datetime import date
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "operator_log_archive", Path(__file__).with_name("operator-log-archive.py")
)
archive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(archive)


class OperatorLogRestoreTests(unittest.TestCase):
    def test_restore_verifies_the_selected_environment_and_day_before_emitting_bytes(self):
        day = date(2026, 11, 1)
        expected_error = "requested environment and UTC day"
        header = {"version": 1, "environment": "staging", "day": day.isoformat()}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            key = root / "passphrase"
            key.write_text("private test passphrase\n")
            for name, summary, error in (
                ("correct", header, None),
                ("wrong environment", {**header, "environment": "production"}, expected_error),
                ("wrong day", {**header, "day": "2026-11-02"}, expected_error),
                ("invalid version", {**header, "version": True}, expected_error),
                ("oversized header", {**header, "environment": "x" * 2048}, "Invalid operator log archive header"),
            ):
                with self.subTest(name=name):
                    original = root / "archive.jsonl.gz"
                    with gzip.open(original, "wt", encoding="utf-8") as output:
                        output.write(json.dumps(summary) + "\n")
                        output.write(json.dumps({"records": 0}) + "\n")
                    cipher = root / "archive.gpg"

                    store = Mock()
                    store.get.side_effect = lambda _: {"Body": cipher.open("rb")}
                    result = io.BytesIO()
                    errors = io.StringIO()
                    with patch.dict(os.environ, {
                        "BACKUP_GPG_PASSPHRASE_FILE": str(key),
                        "BACKUP_CLUSTER_ID": "staging",
                        "BACKUP_S3_BUCKET": "private-test-bucket",
                    }), patch.object(archive, "Store", return_value=store), \
                            patch.object(sys, "argv", ["operator-log-archive", "restore", day.isoformat()]), \
                            patch.object(sys, "stdout", Mock(buffer=result)), redirect_stderr(errors):
                        archive.crypt(original, cipher)
                        if error is None:
                            archive.main()
                            self.assertEqual(result.getvalue(), original.read_bytes())
                        else:
                            with self.assertRaises(SystemExit) as failure:
                                archive.main()
                            self.assertEqual(failure.exception.code, 1)
                            self.assertIn(error, errors.getvalue())
                            self.assertEqual(result.getvalue(), b"")
                    store.get.assert_called_once_with("daily/2026-11-01.jsonl.gz.gpg")
