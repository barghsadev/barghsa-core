import copy
import json
import tempfile
import unittest
from pathlib import Path

import build_backlog as backlog


class BacklogIdentityTests(unittest.TestCase):
    def test_queue_rejects_changed_fields_even_with_original_key(self):
        tasks = [backlog.Task('epic.md', 'T-01.01.01', 'First', 'S', 1)]
        original = [task.as_json() for task in tasks]
        backlog.validate_queue(original, tasks)
        for field, value in {
            'key': 'other.md#T-01.01.01', 'fname': 'other.md',
            'id': 'T-01.01.02', 'title': 'Different task',
            'complexity': 'L', 'source_line': True,
        }.items():
            with self.subTest(field=field):
                changed = copy.deepcopy(original)
                changed[0][field] = value
                with self.assertRaises(ValueError):
                    backlog.validate_queue(changed, tasks)

    def test_queue_rejects_reordering_duplicates_extra_fields_and_wrong_shape(self):
        tasks = [backlog.Task('epic.md', f'T-01.01.0{i}', str(i), 'S', i) for i in (1, 2)]
        rows = [task.as_json() for task in tasks]
        for changed in (rows[::-1], rows + [rows[0]], rows[:1], {},
                        [dict(rows[0], extra='untrusted'), rows[1]]):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                backlog.validate_queue(changed, tasks)

    def test_context_includes_story_but_not_siblings_or_next_story(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'epic.md').write_text(
                '### Story one\nRequired invariant\n'
                '- **T-01.01.01:** First\n  - Complexity: S\n'
                '- **T-01.01.02:** Second\n  - Notes: detail\n  - Complexity: M\n'
                '### Story two\nUnrelated requirement\n'
                '**T-01.02.01 — Third**\n- Complexity: S\n'
            )
            context = backlog.task_context({
                'key': 'epic.md#T-01.01.02', 'fname': 'epic.md', 'id': 'T-01.01.02',
            }, root)
            self.assertIn('Required invariant', context)
            self.assertIn('Notes: detail', context)
            self.assertNotIn('First', context)
            self.assertNotIn('Unrelated requirement', context)

    def test_every_current_task_format_can_be_dispatched_with_its_requirements(self):
        tasks = backlog.parse_all_tasks()
        self.assertGreater(len(tasks), 1000)
        backlog.validate_queue(json.loads(backlog.QUEUE_PATH.read_text()), backlog.queue_tasks(tasks))
        for task in tasks:
            with self.subTest(task=task.key):
                self.assertIn(task.task_id, backlog.task_context(task.as_json()))

    def test_priority_preserves_tasks_and_rejects_ambiguous_rules(self):
        tasks = [backlog.Task('epic.md', f'T-01.01.0{i}', str(i), 'S', i) for i in (1, 2, 3)]
        rule = {'before': tasks[0].key, 'tasks': [tasks[2].key]}
        self.assertEqual(backlog.prioritize_tasks(tasks, [rule]), [tasks[2], *tasks[:2]])
        for rules in ([rule, rule], [{'before': 'missing', 'tasks': [tasks[1].key]}],
                      [{'before': tasks[0].key, 'tasks': [tasks[0].key]}], {}):
            with self.subTest(rules=rules), self.assertRaises(ValueError):
                backlog.prioritize_tasks(tasks, rules)

    def test_context_rejects_mismatched_or_escaping_identity(self):
        for task in (
            {'key': 'other.md#T-01.01.01', 'fname': 'epic.md', 'id': 'T-01.01.01'},
            {'key': '../epic.md#T-01.01.01', 'fname': '../epic.md', 'id': 'T-01.01.01'},
        ):
            with self.assertRaises(ValueError):
                backlog.task_context(task)


if __name__ == '__main__':
    unittest.main()
