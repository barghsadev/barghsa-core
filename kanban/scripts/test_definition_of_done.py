from datetime import datetime, timezone
import json
from pathlib import Path
from subprocess import CompletedProcess
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from definition_of_done import (
    PROTECTED_ITEMS, PROTECTED_RISKS, checklist, exception_state, latest_exceptions,
    validate_exceptions, verify_pull_request,
)


ROOT = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 12, 12, 0, 0, tzinfo=timezone.utc)
TASK = 'example.md#T-01'
ITEM = "Affected desktop and mobile layouts preserve the user's inputs and actions."
HEAD = 'a' * 40
BASE = 'b' * 40
APPROVAL = 'https://example.test/reviews/123#approval'


def record(**changes):
    return {
        'task': TASK, 'item': ITEM, 'commit': HEAD, 'environment': 'staging',
        'risk_class': 'product_ux', 'risk': 'Visual inconsistency on the test account',
        'control': 'The existing review flow is available',
        'control_receipt': 'restricted-review-1', 'owner': 'UI owner',
        'approver': 'Release reviewer', 'approval_ref': APPROVAL,
        'approved_at': '2026-11-12T09:00:00Z', 'expires_at': '2026-11-13T09:00:00Z',
        'remediation': 'Correct and retest the affected layout', **changes,
    }


class DefinitionOfDoneTests(unittest.TestCase):
    def setUp(self):
        self.tasks = {TASK: {}}
        self.complete = '## Definition of done\n\n' + '\n'.join(
            '- [x] ' + item for item in sorted(checklist(ROOT))
        )
        self.incomplete = self.complete.replace('- [x] ' + ITEM, '- [ ] ' + ITEM)

    def verify_pr(self, body, **pull_request):
        event = {'pull_request': {'head': {'sha': HEAD}, 'base': {'sha': BASE},
                                  'body': body, **pull_request}}
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'event.json'
            path.write_text(json.dumps(event))
            verify_pull_request(path, ROOT, NOW, self.tasks)

    def test_protected_risk_classes_items_and_defects_cannot_be_approved(self):
        denied = [record(risk_class=risk) for risk in PROTECTED_RISKS]
        denied += [record(item=item) for item in PROTECTED_ITEMS]
        for exception in denied:
            with self.subTest(item=exception['item'], risk=exception['risk_class']):
                with self.assertRaisesRegex(ValueError, 'protected criterion'):
                    validate_exceptions([exception], self.tasks, ROOT, NOW)
        self.tasks[TASK]['defect_severity'] = 'P1'
        with self.assertRaisesRegex(ValueError, 'protected criterion'):
            validate_exceptions([record()], self.tasks, ROOT, NOW)

    def test_renewal_and_resolution_keep_previous_approval(self):
        expired = record(approved_at='2026-11-11T09:00:00Z', expires_at='2026-11-12T09:00:00Z')
        renewal = record(approval_ref='https://example.test/reviews/123#renewal')
        validate_exceptions([expired, renewal], self.tasks, ROOT, NOW)
        self.assertEqual(exception_state(expired, NOW), 'expired')
        self.assertEqual(list(latest_exceptions([renewal, expired]).values()), [renewal])
        self.assertEqual(exception_state(renewal, NOW), 'approved')
        resolved = {**renewal, 'closed_at': '2026-11-12T10:00:00Z', 'closure_ref': 'verified-layout-2'}
        validate_exceptions([expired, resolved], self.tasks, ROOT, NOW)
        self.assertEqual(exception_state(resolved, NOW), 'resolved')

    def test_rejects_missing_evidence_and_reused_approval(self):
        for changes in (
            {'control_receipt': ''}, {'approval_ref': 'http://example.test/approval'},
            {'approved_at': '2026-11-13T08:00:00Z'}, {'expires_at': '2026-11-11T09:00:00Z'},
            {'closed_at': '2026-11-12T10:00:00Z'}, {'commit': 'not-a-commit'},
        ):
            with self.subTest(changes=changes):
                with self.assertRaises(ValueError):
                    validate_exceptions([record(**changes)], self.tasks, ROOT, NOW)
        with self.assertRaisesRegex(ValueError, 'invalid or duplicate scope'):
            validate_exceptions([record(), record(approved_at='2026-11-12T10:00:00Z')],
                                self.tasks, ROOT, NOW)

    def test_checklist_requires_actual_checked_lines_or_reason(self):
        self.verify_pr(self.complete.replace('\n', '\r\n'))
        self.verify_pr(self.incomplete.replace(ITEM, ITEM + ' — N/A: No interface change'))
        duplicate = self.complete + '\n- [x] ' + ITEM
        missing = self.complete.replace('- [x] ' + ITEM, '<!-- - [x] ' + ITEM + ' -->')
        fenced = self.complete.replace('- [x] ' + ITEM, '```markdown\n- [x] ' + ITEM + '\n````')
        for body, error in ((duplicate, 'duplicate'), (missing, 'missing checklist'), (fenced, 'missing checklist')):
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                self.verify_pr(body)
        protected = next(iter(PROTECTED_ITEMS))
        with self.assertRaisesRegex(ValueError, 'unchecked protected criterion'):
            self.verify_pr(self.complete.replace('- [x] ' + protected, '- [ ] ' + protected + ' — N/A: No review'))

    @patch('definition_of_done.subprocess.run')
    def test_pr_requires_linked_current_approval_from_base_for_exact_head(self, git):
        body = self.incomplete + f'\n[Approval]({APPROVAL})'

        def ledger(*records):
            git.return_value = CompletedProcess([], 0, json.dumps({'dod_exceptions': records}).encode())

        ledger(record())
        self.verify_pr(body)
        self.assertEqual(git.call_args.args[0], ['git', 'show', f'{BASE}:kanban/board.json'])
        for exception in (
            record(commit='c' * 40),
            record(approved_at='2026-11-11T09:00:00Z', expires_at='2026-11-12T12:00:00Z'),
            record(closed_at='2026-11-12T11:00:00Z', closure_ref='layout-proof'),
        ):
            ledger(exception)
            with self.subTest(exception=exception), self.assertRaisesRegex(ValueError, 'unresolved'):
                self.verify_pr(body)
        ledger(record())
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            self.verify_pr(self.incomplete + f'\n<!-- [Approval]({APPROVAL}) -->')
        ledger()
        with self.assertRaisesRegex(ValueError, 'unresolved'):
            self.verify_pr(body, dod_exceptions=[record()])


if __name__ == '__main__':
    unittest.main()
