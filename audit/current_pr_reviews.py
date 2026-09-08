"""Generate the merged-PR review checklist from saved provenance and task acceptance."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def report(root: Path = ROOT) -> str:
    names = ['merged-pr-evidence.json', 'task-review.json',
             'acceptance-closure.json', 'pr-deferrals.json']
    raw = {name: (root / 'audit' / name).read_bytes() for name in names}
    data = {name: json.loads(value) for name, value in raw.items()}
    prs = data[names[0]]
    tasks = data[names[1]]['tasks']
    reviewed = {row['task_key']: row for row in data[names[2]]['reviewed_tasks']}
    deferrals = {row['pr']: row['historical_deferrals'] for row in data[names[3]]}
    by_pr: dict[int, list[dict]] = defaultdict(list)
    numbers = {pr['number'] for pr in prs}
    if len(numbers) != len(prs):
        raise ValueError('Duplicate PR identity')
    for task in tasks:
        for number in task['merged_prs']:
            if number not in numbers:
                raise ValueError(f'Task references absent PR #{number}')
            by_pr[number].append(task)
    if not set(deferrals) <= numbers:
        raise ValueError('Deferral references absent PR')

    def status(task: dict) -> str:
        return reviewed.get(task['task_key'], {}).get('status', 'pending')

    def state(number: int) -> str:
        if not by_pr[number]:
            return 'Unmapped'
        if all(status(task) == 'acceptance_verified' for task in by_pr[number]):
            return 'Mapped tasks verified'
        return 'Task review remains'

    counts = Counter(state(pr['number']) for pr in prs)
    domains = Counter(task['task_key'].split('#')[0] for task in tasks
                      if task['merged_prs'] and status(task) != 'acceptance_verified')
    legacy = sum(not task['merged_prs'] and status(task) != 'acceptance_verified'
                 for task in tasks)
    lines = ['# Merged-PR review checklist', '',
             'Generated from the saved inventory and current task acceptance. This report makes no new GitHub query.',
             'A PR body checkbox is historical author evidence, not independent acceptance. Review the final combined implementation once per qualified task; reuse valid evidence for every contributing PR.', '',
             f'{len(prs)} merged PRs: {counts["Task review remains"]} have unresolved mapped tasks; '
             f'{counts["Unmapped"]} have no current task mapping; '
             f'{counts["Mapped tasks verified"]} map only to verified tasks.',
             f'{sum(map(len, deferrals.values()))} historical deferral statements from {len(deferrals)} PRs still need explicit reconciliation. '
             'Even a verified task does not automatically dispose of every statement in its PR body.', '',
             'Use [current requirements](current-task-requirements.json), [task acceptance](acceptance-closure.json), '
             '[PR bodies](merged-pr-evidence.json), [changed files](pr-files.json) and [deferral statements](pr-deferrals.json).', '',
             '## Remaining task review by domain', '',
             '| Canonical epic | PR-backed tasks unresolved |', '| --- | ---: |']
    lines += [f'| {name} | {count} |' for name, count in sorted(domains.items())]
    lines += [f'| Total | {sum(domains.values())} |', '',
              f'Also review {legacy} unresolved historical claims without a direct merged PR. '
              'Their exact keys are retained in the task ledger. Historical skips overlap these populations.', '',
              '## Every merged PR', '',
              'The task-status column is derived. It is not a new PR approval or a claim that historical deferrals are resolved.', '',
              '| PR | Qualified tasks and current acceptance | Review remaining | Historical deferrals |',
              '| --- | --- | --- | ---: |']
    for pr in sorted(prs, key=lambda row: row['number']):
        number = pr['number']
        keys = '<br>'.join(f"{task['task_key']} ({status(task)})" for task in by_pr[number])
        if not keys:
            keys = pr['title'].replace('|', '\\|').replace('\n', ' ')
        lines.append(f'| [#{number}]({pr["html_url"]}) | {keys} | {state(number)} | '
                     f'{len(deferrals.get(number, []))} |')
    repeated = [task for task in tasks if len(task['merged_prs']) > 1]
    lines += ['', '## Repeated task groups', '',
              f'Keep all {len(repeated)} groups below. Multiple PRs can contain useful corrections. '
              'Remove code only after demonstrating redundant or conflicting behavior, never because an ID repeats.', '',
              '| Qualified task | Contributing PRs |', '| --- | --- |']
    lines += [f'| {task["task_key"]} | ' + ', '.join(f'#{n}' for n in sorted(task['merged_prs'])) + ' |'
              for task in repeated]
    lines += ['', 'PR #47 needs strict-dependency disposition under R05. PRs #234, #235 and #242 need loop-protocol disposition under V01. '
              'PR #298 may implement incidental overpayment credit for `04-invoices-wallet-contracts.md#T-04.3.01.06`; '
              'review that path before scheduling the queue gap.', '', '## Input digests', '']
    lines += [f'- `{name}`: `{hashlib.sha256(value).hexdigest()}`' for name, value in raw.items()]
    return '\n'.join(lines) + '\n'


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    text = report()
    target = ROOT / 'audit' / 'merged-pr-review.md'
    if args.write:
        target.write_text(text, encoding='utf-8')
    elif not target.exists() or target.read_text(encoding='utf-8') != text:
        print('Merged-PR review checklist is stale; regenerate with --write')
        return 1
    print('Validated merged-PR review checklist')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
