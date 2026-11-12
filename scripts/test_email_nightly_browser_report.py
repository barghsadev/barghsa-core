import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location(
    "nightly_email", Path(__file__).with_name("email-nightly-browser-report.py")
)
nightly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nightly)


class NightlyBrowserEmailTests(unittest.TestCase):
    def setUp(self):
        scratch = TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.receipt = self.root / "receipt.json"
        self.summary = self.root / "nightly-browser-summary.md"
        self.summary.write_text(
            "### Nightly browser outcomes\n\n"
            "Current result is **passed**. 40 of 40 shards reported.\n\n"
            "### Scheduled runs over the previous seven days\n"
        )
        self.env = {
            "GITHUB_EVENT_NAME": "schedule",
            "GITHUB_RUN_ATTEMPT": "1",
            "GITHUB_REPOSITORY": "owner/repo",
            "GITHUB_RUN_ID": "12345",
            "GITHUB_SHA": "a" * 40,
            "NIGHTLY_BROWSER_EMAIL_FROM": "ci@example.test",
            "NIGHTLY_BROWSER_EMAIL_TO": "operations@example.test",
            "NIGHTLY_BROWSER_RESEND_KEY": "re_fixture",
            "NIGHTLY_CONTRACTS_RESULT": "success",
            "NIGHTLY_BROWSERS_RESULT": "success",
            "NIGHTLY_REPORT_RESULT": "success",
        }

    def provider(self, response_status=200, data=b'{"id":"01900000-0000-7000-8000-000000000001"}'):
        patcher = patch.object(nightly, "HTTPSConnection")
        self.addCleanup(patcher.stop)
        factory = patcher.start()
        response = factory.return_value.getresponse.return_value
        response.status = response_status
        response.read.return_value = data
        return factory

    def test_submits_exact_run_once_and_preserves_acceptance_without_credentials(self):
        factory = self.provider()
        self.assertTrue(nightly.send(self.root, self.receipt, self.env))
        factory.assert_called_once_with("api.resend.com", timeout=10)
        request = factory.return_value.request
        request.assert_called_once()
        method, path, body, headers = request.call_args.args
        self.assertEqual((method, path), ("POST", "/emails"))
        self.assertEqual(headers["Authorization"], "Bearer re_fixture")
        self.assertEqual(headers["Idempotency-Key"], "barghsa-nightly/owner/repo/12345")
        message = json.loads(body)
        self.assertEqual(message["to"], ["operations@example.test"])
        self.assertEqual(message["from"], "ci@example.test")
        self.assertIn("passed", message["subject"])
        self.assertIn("https://github.com/owner/repo/actions/runs/12345", message["text"])
        self.assertIn("Scheduled runs over the previous seven days", message["text"])
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual(receipt["status"], "accepted")
        self.assertEqual(receipt["provider_email_id"], "01900000-0000-7000-8000-000000000001")
        self.assertEqual(receipt["commit"], "a" * 40)
        self.assertNotIn("re_fixture", self.receipt.read_text())
        self.assertNotIn("operations@example.test", self.receipt.read_text())
        factory.return_value.close.assert_called_once()

    def test_manual_rerun_and_invalid_configuration_never_connect(self):
        factory = self.provider()
        for key, value in (
            ("GITHUB_EVENT_NAME", "workflow_dispatch"),
            ("GITHUB_RUN_ATTEMPT", "2"),
            ("GITHUB_SHA", "unknown"),
            ("NIGHTLY_BROWSER_EMAIL_TO", "team@example.test,other@example.test"),
            ("NIGHTLY_BROWSER_RESEND_KEY", "re_fixture\r\n"),
        ):
            with self.subTest(key=key), self.assertRaises(ValueError):
                nightly.send(self.root, self.receipt, {**self.env, key: value})
        factory.assert_not_called()

    def test_missing_report_never_says_passed(self):
        factory = self.provider()
        self.summary.unlink()
        self.assertTrue(nightly.send(self.root, self.receipt, self.env))
        payload = json.loads(factory.return_value.request.call_args.args[2])
        self.assertIn("requires review", payload["subject"])
        self.assertIn("outcome report is unavailable", payload["text"])

    def test_failed_security_check_remains_visible_in_the_email(self):
        factory = self.provider()
        self.env["NIGHTLY_CONTRACTS_RESULT"] = "failure"
        self.assertTrue(nightly.send(self.root, self.receipt, self.env))
        payload = json.loads(factory.return_value.request.call_args.args[2])
        self.assertIn("requires review", payload["subject"])
        self.assertIn("Dependency, security and contract checks · failure", payload["text"])

    def test_redirect_is_unconfirmed_without_following_or_retrying(self):
        factory = self.provider(302, b'{"location":"https://another.example"}')
        self.assertFalse(nightly.send(self.root, self.receipt, self.env))
        self.assertEqual(factory.call_count, 1)
        factory.return_value.request.assert_called_once()
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual((receipt["status"], receipt["http_status"]), ("unconfirmed", 302))
        self.assertNotIn("provider_email_id", receipt)

    def test_success_status_without_valid_receipt_is_unconfirmed(self):
        factory = self.provider()
        for body in (b'{"id":"invalid"}', b'x' * (nightly.MAX_RECEIPT + 1), b'{'):
            with self.subTest(body_length=len(body)):
                factory.return_value.getresponse.return_value.read.return_value = body
                self.assertFalse(nightly.send(self.root, self.receipt, self.env))
                self.assertEqual(json.loads(self.receipt.read_text())["status"], "unconfirmed")
        self.assertEqual(factory.return_value.request.call_count, 3)

    def test_timeout_retains_the_unconfirmed_receipt_and_never_resends(self):
        factory = self.provider()
        factory.return_value.getresponse.side_effect = TimeoutError()
        self.assertFalse(nightly.send(self.root, self.receipt, self.env))
        self.assertEqual(json.loads(self.receipt.read_text())["status"], "unconfirmed")
        factory.return_value.request.assert_called_once()
        factory.return_value.close.assert_called_once()
