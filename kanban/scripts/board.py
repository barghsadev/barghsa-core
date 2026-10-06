#!/usr/bin/env python3
"""Validate or query the single task/release ledger. Never dispatch or build code."""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys

from specs import HEADING_RE, parse_epic
import re

ROOT = Path(__file__).resolve().parents[2]
STATES = {'todo', 'in_progress', 'partial', 'blocked', 'verify', 'done', 'superseded'}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(root=ROOT):
    return json.loads((root / 'kanban/board.json').read_text())


def validate(board, root=ROOT):
    if board.get('schema_version') != 1:
        raise ValueError('Unsupported board schema')
    if set(board['launch_scope']) != {'electricity', 'saving', 'solar', 'consultation'}:
        raise ValueError('First launch must retain all four services')
    tasks = board['tasks']
    by_key = {t['key']: t for t in tasks}
    if len(by_key) != len(tasks):
        raise ValueError('Duplicate qualified task identity')
    releases = {r['version']: r for r in board['releases']}
    if len(releases) != len(board['releases']):
        raise ValueError('Duplicate release version')
    prior = set()
    for r in board['releases']:
        if not set(r['depends_on']) <= prior or not r['goal'] or not r['gates']:
            raise ValueError('Invalid release dependency, goal or gates')
        if r['status'] not in {'planned', 'in_progress', 'blocked', 'accepted', 'released'}:
            raise ValueError('Invalid release status')
        if r['status'] in {'accepted', 'released'} and not r.get('acceptance'):
            raise ValueError('Release acceptance requires recorded gate evidence')
        if r['status'] == 'released' and (not r['published_commit'] or not r['staging_receipt'] or not r['telegram_receipt']):
            raise ValueError('Released milestone requires push, staging and Telegram receipts')
        prior.add(r['version'])
    original = [t for t in tasks if t['spec'] is not None]
    original_keys = sorted(t['key'] for t in original)
    expected = board['migration']
    if len(original) != expected['original_tasks'] or hashlib.sha256('\n'.join(original_keys).encode()).hexdigest() != expected['original_keys_sha256']:
        raise ValueError('Original task inventory changed or lost')
    for name, expected_sha in {**board['specification_sources'], **board['requirement_sources']}.items():
        if sha(root / name) != expected_sha:
            raise ValueError(f'Specification changed without reconciliation: {name}')
    canonical = []
    for path in sorted((root / 'kanban/epics').glob('*.md')):
        parsed = parse_epic(path)
        canonical.extend(parsed)
        lines = path.read_text().splitlines()
        for i, source in enumerate(parsed):
            start = source.line - 1
            end = parsed[i + 1].line - 1 if i + 1 < len(parsed) else len(lines)
            for line in range(start + 1, end):
                heading = HEADING_RE.match(lines[line])
                if heading and (len(heading.group(1)) <= 3 or re.match(r'S-\d', heading.group(2))):
                    end = line
                    break
            if source.key in by_key and by_key[source.key]['requirement'] != '\n'.join(lines[start:end]).strip():
                raise ValueError(f'Stale original task requirement: {source.key}')
    if {t.key for t in canonical} != set(original_keys):
        raise ValueError('Board does not contain every original specification task')
    for source in canonical:
        task = by_key[source.key]
        if task['title'] != source.title or task['complexity'] != source.complexity or task['spec']['line'] != source.line or task['spec']['path'] != 'kanban/epics/' + source.fname:
            raise ValueError(f'Stale original task metadata: {source.key}')
    for task in tasks:
        key = task['key']
        if task['status'] not in STATES or task['release'] not in releases:
            raise ValueError(f'Invalid task state or release: {key}')
        if not task['title'] or not task['requirement'] or not isinstance(task['launch_required'], bool):
            raise ValueError(f'Missing task requirement or launch disposition: {key}')
        if task['spec'] is not None and task['spec']['story'] not in board['stories']:
            raise ValueError(f'Missing original story context: {key}')
        if not set(task['depends_on']) <= set(by_key) or key in task['depends_on']:
            raise ValueError(f'Unknown or self dependency: {key}')
        if task['status'] == 'blocked' and not task.get('blocker'):
            raise ValueError(f'Blocked task has no blocker: {key}')
        if task['status'] == 'superseded' and (not task.get('disposition') or task['launch_required']):
            raise ValueError(f'Superseded task has no explicit non-launch disposition: {key}')
        evidence = task['evidence']
        if any(b not in board['batch_evidence'] for b in evidence.get('batches', [])):
            raise ValueError(f'Unknown batch evidence: {key}')
        if task['status'] == 'done':
            accepted = evidence.get('current_acceptance')
            if not accepted or not accepted.get('checks') or not accepted.get('source_evidence'):
                raise ValueError(f'Done task lacks acceptance evidence: {key}')
            for source in accepted['source_evidence']:
                if sha(root / source['path']) != source['sha256']:
                    raise ValueError(f'Done evidence changed; return task to verify: {key}')
            if task['remaining']:
                raise ValueError(f'Done task still has remaining requirements: {key}')
    visiting, visited = set(), set()
    def visit(key):
        if key in visiting:
            raise ValueError(f'Task dependency cycle: {key}')
        if key in visited:
            return
        visiting.add(key)
        for dependency in by_key[key]['depends_on']:
            visit(dependency)
        visiting.remove(key)
        visited.add(key)
    for key in by_key:
        visit(key)
    for source in board['requirement_sources']:
        entries = [s for s in board['source_sections'] if s['source'] == source]
        covered = {line for s in entries for line in range(s['start_line'], s['end_line'] + 1)}
        total = len((root / source).read_text().splitlines())
        if not entries or covered != set(range(1, total + 1)):
            raise ValueError(f'Requirement section inventory is incomplete: {source}')
    for key in board['next_batch']['task_keys']:
        if key not in by_key or by_key[key]['release'] != board['next_batch']['release']:
            raise ValueError('Next batch references an invalid task or release')


def render(board):
    counts = Counter(t['status'] for t in board['tasks'])
    next_release = next((r['version'] for r in board['releases'] if r['status'] != 'released'), None)
    lines = ['# Current task board', '', '<!-- Generated from board.json. Edit the JSON, then run board.py render. -->', '',
             f"Snapshot: {board['updated']}. First production launch: electricity, saving, solar and consultation.", '',
             f"Last confirmed staging release: **v{board['latest_release']['version']}**. Next milestone: **{('v'+next_release) if next_release else 'none planned'}**.", '',
             'Counts describe evidence and task acceptance, not the percentage of product built.', '',
             '| State | Tasks | Meaning |', '| --- | ---: | --- |']
    meanings = {'done':'Accepted with unchanged source bindings.', 'verify':'Existing work may be complete; inspect evidence before building.',
                'partial':'An earlier review found unmet criteria; reconcile later fixes.', 'todo':'New, concrete work or release checks.',
                'in_progress':'Existing work to finish.', 'blocked':'Named owner or external prerequisite.', 'superseded':'Explicit approved scope disposition.'}
    for state in ['done','verify','partial','todo','in_progress','blocked','superseded']:
        lines.append(f'| {state} | {counts[state]} | {meanings[state]} |')
    lines += ['', 'The earlier audit accepted 219 tasks, found 54 partial claims and deferred 49. Changed source bindings require renewal. All original 1,355 tasks are retained. No evidence means unknown, not unbuilt.', '',
              'Start with [release plan](RELEASES.md) and [working process](WORKFLOW.md). Use `python3 kanban/scripts/board.py show <qualified-key>` for complete criteria and evidence.', '',
              '## Existing product work', '', 'These are recorded implementations, not blanket certification of each domain. Fixture-backed journeys and live production evidence are distinct.', '',
              '| Area | Recorded implementation | Acceptance still needed |', '| --- | --- | --- |']
    for capability in board['capabilities']:
        lines.append(f"| {capability['name']} | {capability['recorded_work']} | {capability['release_acceptance']} |")
    lines += ['', '## Next batch', '', board['next_batch']['goal'], '']
    for key in board['next_batch']['task_keys']:
        task = next(t for t in board['tasks'] if t['key'] == key)
        lines.append(f'- `{key}`: {task["title"]}')
    for release in board['releases']:
        version = release['version']
        selected = [t for t in board['tasks'] if t['release'] == version]
        lines += ['', f'## v{version}: {release["title"]}', '', release['goal'], '',
                  '| Qualified task | State | Build evidence | Required work |', '| --- | --- | --- | --- |']
        for t in sorted(selected, key=lambda t: (t['spec'] is not None, t['key'])):
            ev = t['evidence']
            history = ev.get('historical_acceptance')
            proof = ('Earlier '+history['status'] if history else 'Recorded batch work' if ev.get('batches') else 'Inventory needed')
            title = t['title'].replace('|','\\|').replace('\n',' ')
            lines.append(f'| `{t["key"]}` | {t["status"]} | {proof} | {title} |')
    return '\n'.join(lines) + '\n'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['check','render','list','show','evidence','next','ready'])
    parser.add_argument('key', nargs='?')
    parser.add_argument('--release')
    parser.add_argument('--status', choices=sorted(STATES))
    args = parser.parse_args()
    try:
        board = read()
        validate(board)
        if args.action == 'render':
            (ROOT / 'kanban/BOARD.md').write_text(render(board))
        elif args.action == 'check':
            if (ROOT / 'kanban/BOARD.md').read_text() != render(board):
                raise ValueError('Generated board is stale; run board.py render')
            print(f"Validated {len(board['tasks'])} tasks, {len(board['releases'])} releases and {len(board['source_sections'])} source sections")
        elif args.action == 'show':
            match = next((t for t in board['tasks'] if t['key'] == args.key), None)
            if not match:
                raise ValueError('Unknown qualified task key')
            detail = {**match}
            if match['spec']:
                detail['story_context'] = board['stories'][match['spec']['story']]['context']
            print(json.dumps(detail, ensure_ascii=False, indent=2))
        elif args.action == 'evidence':
            match = board['batch_evidence'].get(args.key)
            if not match:
                raise ValueError('Unknown historical batch ID')
            print(json.dumps(match, ensure_ascii=False, indent=2))
        elif args.action == 'ready':
            release = next((r for r in board['releases'] if r['version'] == args.release), None)
            if not release:
                raise ValueError('Use --release with a known milestone')
            earlier = {r['version'] for r in board['releases'][:board['releases'].index(release) + 1]}
            unresolved = [t for t in board['tasks'] if t['launch_required'] and t['release'] in earlier and t['status'] != 'done']
            print(f"v{release['version']}: {len(unresolved)} unresolved launch-required tasks through this milestone")
            print('Business gates also need recorded acceptance; this query does not certify them.')
            return 1 if unresolved or not release.get('acceptance') else 0
        else:
            for task in board['tasks']:
                if args.action == 'next' and task['key'] not in board['next_batch']['task_keys']:
                    continue
                if args.release and task['release'] != args.release or args.status and task['status'] != args.status:
                    continue
                print(f"{task['status']:12} v{task['release']} {task['key']} {task['title']}")
        return 0
    except (OSError, ValueError, KeyError) as error:
        print(f'Board validation failed: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
