#!/usr/bin/env python3
"""Surgically transition kanban/loop-state.json.

Usage:
  transition_state.py building <fname>#<id> <task_id> <task_file> <branch>
  transition_state.py in_review
  transition_state.py fixing
  transition_state.py blocked <reason>
  transition_state.py merged <branch>   # append task to build_completed_tasks, clear current fields

Reads the CURRENT on-disk state, sets the requested fields, appends exactly ONE
status_history entry, trims the history to the latest 100 entries, and writes
back. Never drops existing history.
"""
import json
import sys
import datetime

STATE = 'kanban/loop-state.json'


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load():
    with open(STATE) as f:
        return json.load(f)


def save(s):
    with open(STATE, 'w') as f:
        json.dump(s, f, indent=2, ensure_ascii=False)
        f.write('\n')


def main():
    cmd = sys.argv[1]
    s = load()
    if cmd == 'building':
        key, task_id, task_file, branch = sys.argv[2:6]
        s['status'] = 'building'
        s['current_task_key'] = key
        s['current_task_id'] = task_id
        s['current_task_file'] = task_file
        s['current_branch'] = branch
        s['current_pr_url'] = ''
        s['fix_attempts'] = 0
        s['last_error'] = None
        s['status_history'].append({'status': 'building', 'task_key': key, 'at': now_iso()})
    elif cmd == 'in_review':
        s['status'] = 'in_review'
        s['last_error'] = None
        if len(sys.argv) > 2:
            s['current_pr_url'] = sys.argv[2]
        s['status_history'].append({
            'status': 'in_review',
            'task_key': s['current_task_key'],
            'at': now_iso(),
        })
    elif cmd == 'fixing':
        s['status'] = 'fixing'
        s['fix_attempts'] = s.get('fix_attempts', 0) + 1
        s['status_history'].append({
            'status': 'fixing',
            'task_key': s['current_task_key'],
            'at': now_iso(),
        })
    elif cmd == 'blocked':
        reason = sys.argv[2]
        s['status'] = 'blocked'
        s['last_error'] = reason
        s['status_history'].append({
            'status': 'blocked',
            'task_key': s.get('current_task_key') or '',
            'at': now_iso(),
        })
    elif cmd == 'merged':
        key = s['current_task_key']
        if key and key not in s['build_completed_tasks']:
            s['build_completed_tasks'].append(key)
        s['status'] = 'idle'
        s['current_task_key'] = ''
        s['current_task_id'] = ''
        s['current_task_file'] = ''
        s['current_branch'] = ''
        s['current_pr_url'] = ''
        s['fix_attempts'] = 0
        s['last_error'] = None
        s['status_history'].append({'status': 'merged', 'task_key': key, 'at': now_iso()})
    else:
        print(f'unknown command {cmd}', file=sys.stderr)
        sys.exit(2)

    # Keep history bounded to the latest 100 transitions.
    s['status_history'] = s['status_history'][-100:]
    s['last_updated'] = now_iso()
    save(s)
    print(f"status -> {s['status']} (history {len(s['status_history'])} entries)")


if __name__ == '__main__':
    main()
