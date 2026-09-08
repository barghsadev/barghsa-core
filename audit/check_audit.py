"""Validate the fixed audit population, archive provenance and saved evidence."""
from pathlib import Path
import gzip
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'audit'


def read(name):
    return json.loads((AUDIT / name).read_text())


def require(condition, message):
    if not condition:
        raise ValueError(message)


def identities(rows, field):
    values = [row[field] for row in rows]
    require(len(values) == len(set(values)), f'Duplicate {field}')
    return set(values)


def main():
    tasks = read('task-review.json')['tasks']
    keys = identities(tasks, 'task_key')
    require(len(keys) == 322, 'Historical task population changed')
    require(identities(read('current-task-requirements.json')['tasks'], 'task_key') == keys,
            'Current requirements do not cover historical tasks')
    closure = read('acceptance-closure.json')
    reviewed = identities(closure['reviewed_tasks'], 'task_key')
    pending = closure['pending_task_keys']
    require(len(pending) == len(set(pending)), 'Duplicate pending key')
    require(not reviewed.intersection(pending) and reviewed.union(pending) == keys,
            'Acceptance population lost, duplicated or reassigned a task')
    statuses = {'acceptance_verified', 'partial', 'blocked', 'deferred', 'retired'}
    require(all(row['status'] in statuses for row in closure['reviewed_tasks']),
            'Unknown acceptance status')
    skips = identities(read('skipped-tasks.json'), 'task_key')
    require(len(skips) == 58 and skips <= keys, 'Historical skip population changed')
    require(identities(read('current-skipped-tasks.json')['tasks'], 'task_key') == skips,
            'Current skip report lost a historical skip')
    prs = identities(read('merged-pr-evidence.json'), 'number')
    require(len(prs) == 301, 'Frozen merged PR inventory changed; reconcile explicitly')
    require(set(read('pr-files.json')) == {str(number) for number in prs},
            'PR file inventory is incomplete')
    progress = read('progress.json')
    require(identities(progress['groups'], 'id') == {f'F{i:02}' for i in range(1, 24)},
            'Original repair group missing or duplicated')
    require(progress['active_step'] in identities(progress['steps'], 'id'), 'Unknown active step')

    manifest = read('cleanup-manifest.json')
    # These paths are read by tests/tools or referenced by immutable migrations.
    for name in ('legacy-inline-constraints.json', 'staff-administrator-review.sql',
                 'notification-template-history-review.sql', 'schema-snapshot-review.md'):
        require((AUDIT / name).is_file(), f'Missing stable audit input: {name}')
    require(len(identities(manifest['files'], 'original_path')) == 99,
            'Cleanup manifest lost an original file')
    for row in manifest['files']:
        target = ROOT / row['current_path']
        require(target.is_file(), f'Missing retained evidence: {target}')
        if row['disposition'] != 'retained':
            require(hashlib.sha256(target.read_bytes()).hexdigest() == row['sha256'],
                    f'Historical evidence changed: {target}')
    logs = read('evidence/index.json')['logs']
    for row in logs:
        require('path' in row, f'Missing saved log: {row["original_path"]}')
        data = (ROOT / row['path']).read_bytes()
        require(hashlib.sha256(data).hexdigest() == row['stored_sha256'], 'Saved log archive changed')
        require(hashlib.sha256(gzip.decompress(data)).hexdigest() == row['sha256'],
                'Saved log content changed')
    for document in AUDIT.glob('*.md'):
        for link in re.findall(r'\]\(([^)]+)\)', document.read_text()):
            if '://' in link or link.startswith('#'):
                continue
            path = re.sub(r':\d+$', '', link.split('#')[0])
            require((document.parent / path).exists(), f'Broken active link: {document}: {link}')
    print(f'Validated {len(keys)} tasks, {len(prs)} PRs, {len(skips)} skips, 23 groups, '
          f'99 original file mappings and {len(logs)} saved logs')


if __name__ == '__main__':
    main()
