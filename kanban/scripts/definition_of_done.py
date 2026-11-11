"""Check recorded checklist exceptions and the checklist on GitHub PR events."""
from datetime import datetime, timezone
import json
import re
import subprocess
from urllib.parse import urlsplit


CHECKBOX = re.compile(r'^- \[([ xX])\] (.+)$', re.MULTILINE)
PROTECTED_RISKS = {
    'financial_correctness', 'authorization', 'auditability', 'backup_recovery',
    'credential_critical',
}
PROTECTED_ITEMS = {
    'Financial writes are atomic and retain their idempotency and audit records.',
    'Authorization and profile isolation hold on both allowed and denied paths.',
    'Sensitive data stays out of client responses, operational logs and test artifacts.',
    'Dependency, image, secret and license checks cover the proposed release scope.',
    'Release evidence includes the applicable provider, backup and restore receipts.',
    "Production deployment has the owner's explicit approval for the version, commit and target.",
}
RISK_CLASSES = {'product_ux', 'engineering', 'test_quality', 'security_privacy', 'operations'}
FIELDS = {
    'task', 'item', 'commit', 'environment', 'risk_class', 'risk', 'control', 'control_receipt',
    'owner', 'approver', 'approval_ref', 'approved_at', 'expires_at', 'remediation',
}


def checklist(root):
    template = (root / '.github/PULL_REQUEST_TEMPLATE.md').read_text()
    items = [item for _, item in CHECKBOX.findall(template)]
    if len(items) != len(set(items)) or not PROTECTED_ITEMS <= set(items):
        raise ValueError('Invalid Definition of Done checklist or missing protected items')
    return set(items)


def utc_time(value):
    if not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z', value):
        raise ValueError('Definition of Done times must use UTC with second precision')
    return datetime.strptime(value, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)


def exception_state(record, now):
    if 'closed_at' in record:
        return 'resolved'
    return 'expired' if now >= utc_time(record['expires_at']) else 'approved'


def scope(record):
    return tuple(record[field] for field in ('task', 'item', 'commit', 'environment'))


def latest_exceptions(records):
    by_scope = {}
    for record in sorted(records, key=lambda row: row['approved_at']):
        by_scope[scope(record)] = record
    return by_scope


def validate_exceptions(records, tasks, root, now):
    if not isinstance(records, list):
        raise ValueError('Definition of Done exceptions must be a list')
    items = checklist(root)
    seen, approvals = set(), set()
    for index, record in enumerate(records, 1):
        fields = set(record) if isinstance(record, dict) else set()
        if fields not in (FIELDS, FIELDS | {'closed_at', 'closure_ref'}) or any(
            not isinstance(value, str) or not value.strip() for value in record.values()
        ):
            raise ValueError(f'Definition of Done exception {index} has incomplete evidence')
        key, item, commit, environment = scope(record)
        identity = (scope(record), record['approved_at'])
        approval = (scope(record), record['approval_ref'])
        if (key not in tasks or item not in items or not re.fullmatch(r'[a-f0-9]{40}', commit)
                or environment not in {'development', 'staging', 'production'}
                or identity in seen or approval in approvals):
            raise ValueError(f'Definition of Done exception {index} has invalid or duplicate scope')
        seen.add(identity)
        approvals.add(approval)
        if item in PROTECTED_ITEMS or record['risk_class'] in PROTECTED_RISKS:
            raise ValueError(f'Definition of Done exception {index} covers a protected criterion')
        if record['risk_class'] not in RISK_CLASSES:
            raise ValueError(f'Definition of Done exception {index} has an unknown risk class')
        reference = urlsplit(record['approval_ref'])
        if (not re.fullmatch(r'https://[^\s<>]+', record['approval_ref'])
                or not reference.hostname or reference.username is not None):
            raise ValueError(f'Definition of Done exception {index} requires an HTTPS approval link')
        approved = utc_time(record['approved_at'])
        if approved > now or utc_time(record['expires_at']) <= approved:
            raise ValueError(f'Definition of Done exception {index} has invalid approval or expiry')
        if 'closed_at' in record and not approved <= utc_time(record['closed_at']) <= now:
            raise ValueError(f'Definition of Done exception {index} has an invalid closure time')
    for record in latest_exceptions(records).values():
        if 'closed_at' not in record and tasks[record['task']].get('defect_severity') in {'P0', 'P1'}:
            raise ValueError('Definition of Done exception covers a protected criterion on an open approval')


def checklist_section(body):
    lines = []
    fence = None
    for line in re.sub(r'<!--.*?(?:-->|\Z)', '', body, flags=re.DOTALL).splitlines():
        boundary = re.match(r'^ {0,3}(`{3,}|~{3,})(.*)$', line)
        if fence is None and boundary:
            fence = boundary[1]
        elif fence is not None:
            if boundary and boundary[1].startswith(fence) and not boundary[2].strip():
                fence = None
        else:
            lines.append(line)
    visible = '\n'.join(lines)
    headings = list(re.finditer(r'^## +([^\n]+)$', visible, re.MULTILINE))
    for index, heading in enumerate(headings):
        if heading[1].strip().lower() == 'definition of done':
            end = headings[index + 1].start() if index + 1 < len(headings) else len(visible)
            return visible[heading.end():end]
    raise ValueError('Pull request is missing its Definition of Done section')


def verify_pull_request(event_path, root, now, tasks):
    try:
        event = json.loads(event_path.read_text())['pull_request']
        commit, base, body = event['head']['sha'], event['base']['sha'], event['body']
    except (KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError('Invalid pull request event for Definition of Done') from error
    if not isinstance(body, str) or any(
        not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{40}', value)
        for value in (commit, base)
    ):
        raise ValueError('Pull request requires a Definition of Done checklist and exact revisions')
    items = checklist(root)
    section = checklist_section(body)
    links = set(re.findall(r'\[[^\]\n]+\]\((https://[^\s)]+)\)', section))
    addressed = set()
    missing_approvals = set()
    for mark, content in CHECKBOX.findall(section):
        item, _, reason = content.partition(' — N/A: ')
        if item not in items:
            continue
        if item in addressed:
            raise ValueError('Pull request Definition of Done contains a duplicate checklist item')
        addressed.add(item)
        if mark == ' ':
            if item in PROTECTED_ITEMS:
                raise ValueError('Pull request Definition of Done has an unchecked protected criterion')
            if not reason.strip():
                missing_approvals.add(item)
    if addressed != items:
        raise ValueError('Pull request Definition of Done is missing checklist items')
    if missing_approvals:
        try:
            result = subprocess.run(
                ['git', 'show', f'{base}:kanban/board.json'], cwd=root, capture_output=True, timeout=15,
            )
        except subprocess.TimeoutExpired as error:
            raise ValueError('Could not read Definition of Done approvals from the pull request base') from error
        if result.returncode:
            raise ValueError('Could not read Definition of Done approvals from the pull request base')
        ledger = json.loads(result.stdout)
        records = ledger.get('dod_exceptions', [])
        validate_exceptions(records, tasks, root, now)
        approved = {
            record['item'] for record in latest_exceptions(records).values()
            if record['commit'] == commit and record['approval_ref'] in links
            and exception_state(record, now) == 'approved'
        }
        if not missing_approvals <= approved:
            raise ValueError('Pull request Definition of Done has an unresolved checklist item')
