#!/usr/bin/env python3
"""Verify the exact first-launch candidate recorded on the dispatching main commit."""

import argparse
import json
import re
import subprocess
import sys


VERSION = '0.9.0'


def git(*args):
    return subprocess.check_output(['git', *args], text=True, stderr=subprocess.DEVNULL, timeout=15)


def release_at(commit):
    ledger = json.loads(git('show', f'{commit}:kanban/board.json'))
    if ledger.get('schema_version') != 1:
        raise ValueError('Unsupported release ledger')
    releases = [release for release in ledger['releases'] if release['version'] == VERSION]
    if len(releases) != 1:
        raise ValueError('Expected one first-launch release entry')
    return releases[0]


def verify_candidate(candidate, main):
    if not all(re.fullmatch(r'[0-9a-f]{40}', commit) for commit in (candidate, main)):
        raise ValueError('Provide full commit SHAs')
    if git('rev-parse', 'HEAD').strip() != main:
        raise ValueError('Expected the exact main checkout for this dispatch')
    released = release_at(main)
    staging = released.get('staging_receipt')
    if (released.get('status') != 'released' or released.get('published_commit') != candidate
            or not isinstance(staging, dict) or staging.get('commit') != candidate
            or staging.get('version') != VERSION or not released.get('telegram_receipt')):
        raise ValueError('Main must record this exact staging release and its Telegram receipts')
    if git('merge-base', candidate, main).strip() != candidate:
        raise ValueError('The staged commit must be an ancestor of protected main')
    accepted = release_at(candidate)
    gates = (accepted.get('acceptance') or {}).get('gates')
    if (json.loads(git('show', f'{candidate}:package.json')).get('version') != VERSION
            or accepted.get('status') != 'accepted' or not isinstance(gates, dict)
            or not gates or not all(gates.values())):
        raise ValueError('The staged commit must record acceptance of the first-launch release')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate')
    parser.add_argument('main')
    args = parser.parse_args()
    try:
        verify_candidate(args.candidate, args.main)
    except (OSError, AttributeError, KeyError, TypeError, subprocess.SubprocessError, json.JSONDecodeError):
        print('Could not verify the staged commit and main release ledger', file=sys.stderr)
        return 1
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
