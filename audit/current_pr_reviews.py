"""Generate the merged-PR review checklist from saved provenance and task acceptance."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verified_protocol_review(row: dict, root: Path) -> bool:
    """Allow unmapped protocol work only with explicit, current review evidence."""
    review = row.get('protocol_review')
    if not isinstance(review, dict) or not row.get('reason') or not row.get('evidence'):
        return False
    for field in ('requirements', 'validation'):
        values = review.get(field)
        if not isinstance(values, list) or not values or any(
                not isinstance(value, str) or not value.strip() for value in values):
            return False
    sources = review.get('source_evidence')
    if not isinstance(sources, list) or not sources:
        return False
    seen = set()
    for source in sources:
        if not isinstance(source, dict) or not isinstance(source.get('path'), str):
            return False
        path = source['path']
        target = (root / path).resolve()
        if (Path(path).is_absolute() or not target.is_relative_to(root.resolve())
                or path in seen or not target.is_file()):
            return False
        if hashlib.sha256(target.read_bytes()).hexdigest() != source.get('sha256'):
            return False
        seen.add(path)
    return True


def report(root: Path = ROOT) -> str:
    names = ['merged-pr-evidence.json', 'task-review.json',
             'acceptance-closure.json', 'pr-deferrals.json', 'evidence/step-reviews.json']
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

    dispositions = {}
    for step in data[names[4]]['steps']:
        seen = set()
        for row in step.get('pr_dispositions', []):
            number = row['pr']
            if number in seen or number not in numbers:
                raise ValueError('Duplicate or absent PR in batch disposition')
            if row['status'] not in {'closed', 'open', 'blocked'}:
                raise ValueError('Unknown PR disposition')
            seen.add(number)
            dispositions[number] = {**row, 'review_record': step['id']}

    def status(task: dict) -> str:
        return reviewed.get(task['task_key'], {}).get('status', 'pending')

    def state(number: int) -> str:
        if not by_pr[number]:
            return 'Unmapped'
        if all(status(task) == 'acceptance_verified' for task in by_pr[number]):
            return 'Mapped tasks verified'
        return 'Task review remains'

    counts = Counter(state(pr['number']) for pr in prs)
    closure_counts = Counter(row['status'] for row in dispositions.values())
    for number, row in dispositions.items():
        if row['status'] == 'closed':
            replacements = row.get('superseded_by_task_keys', [])
            verified_replacement = (
                state(number) == 'Unmapped'
                and isinstance(replacements, list)
                and bool(replacements)
                and all(isinstance(key, str) and key in reviewed
                        and reviewed[key]['status'] == 'acceptance_verified'
                        for key in replacements)
                and len(set(replacements)) == len(replacements)
                and bool(row.get('reason'))
                and bool(row.get('evidence'))
            )
            verified_protocol = state(number) == 'Unmapped' and verified_protocol_review(row, root)
            if state(number) != 'Mapped tasks verified' and not verified_replacement and not verified_protocol:
                raise ValueError(f'PR #{number} cannot close with unresolved mapped tasks')
            saved = next((p for p in data[names[3]] if p['pr'] == number), {})
            resolved = {item['statement_index'] for item in saved.get('dispositions', [])}
            if resolved != set(range(len(deferrals.get(number, [])))):
                raise ValueError(f'PR #{number} has undispositioned historical deferrals')
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
             f'{sum(map(len, deferrals.values()))} historical deferral statements from {len(deferrals)} PRs are retained; see the deferral register for explicit dispositions. '
             'Even a verified task does not automatically dispose of every statement in its PR body.', '',
             f'Explicit PR dispositions: **{closure_counts["closed"]} closed / '
             f'{closure_counts["open"]} open / {closure_counts["blocked"]} blocked**; '
             f'{len(prs) - len(dispositions)} have no explicit PR review yet. '
             'These are local review dispositions at the recorded revisions, not GitHub merge or approval actions.', '',
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
              '| PR | Qualified tasks and current acceptance | Task mapping | PR disposition | Historical deferrals |',
              '| --- | --- | --- | --- | ---: |']
    for pr in sorted(prs, key=lambda row: row['number']):
        number = pr['number']
        keys = '<br>'.join(f"{task['task_key']} ({status(task)})" for task in by_pr[number])
        if not keys:
            keys = pr['title'].replace('|', '\\|').replace('\n', ' ')
        disposition = dispositions.get(number)
        if disposition and disposition.get('superseded_by_task_keys'):
            keys += '<br>Superseded by verified: ' + ', '.join(disposition['superseded_by_task_keys'])
        if disposition and disposition.get('protocol_review'):
            keys += '<br>Protocol requirements reviewed separately; no product task mapping'
        label = (f'[{disposition["status"]}](evidence/step-reviews.json#{disposition["review_record"]})'
                 if disposition else 'Not reviewed')
        lines.append(f'| [#{number}]({pr["html_url"]}) | {keys} | {state(number)} | {label} | '
                     f'{len(deferrals.get(number, []))} |')
    repeated = [task for task in tasks if len(task['merged_prs']) > 1]
    lines += ['', '## Repeated task groups', '',
              f'Keep all {len(repeated)} groups below. Multiple PRs can contain useful corrections. '
              'Remove code only after demonstrating redundant or conflicting behavior, never because an ID repeats.', '',
              '| Qualified task | Contributing PRs |', '| --- | --- |']
    lines += [f'| {task["task_key"]} | ' + ', '.join(f'#{n}' for n in sorted(task['merged_prs'])) + ' |'
              for task in repeated]
    lines += ['', 'Unmapped historical PRs retain their original inventory. A superseded workaround may close only with explicit links to verified replacement tasks and dispositioned historical deferrals. '
              'Protocol work may close with explicit requirements, validation and current source hashes; it cannot bypass unresolved mapped tasks or historical deferrals. '
              'See each PR row for its current review; repeated or unmapped provenance alone does not authorize rebuilding.', '', '## Input digests', '']
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
