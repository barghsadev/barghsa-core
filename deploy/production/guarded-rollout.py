#!/usr/bin/env python3
"""Advance a monitored application rollout through an operator-owned ingress."""

import argparse
import fcntl
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time


MAX_JSON_BYTES = 65536
SERVICES = ('electricity', 'saving', 'solar', 'consultation')
SMOKE_CHECKS = ('health', 'dashboard', 'wallet', *SERVICES)
ERROR_BUDGET = {'pilot': 0.005, 'commercial': 0.001}


class RolloutError(Exception):
    def __init__(self, reason, **evidence):
        super().__init__(reason)
        self.evidence = evidence


def require(condition, reason, **evidence):
    if not condition:
        raise RolloutError(reason, **evidence)


def finite(value, minimum, maximum):
    return type(value) in (int, float) and minimum <= value <= maximum


def integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def identity(value):
    return isinstance(value, dict) and set(value) == {'environment', 'database'} and all(
        isinstance(v, str) and re.fullmatch(r'[a-zA-Z0-9_.-]{1,64}', v) for v in value.values()
    )


def revision(value):
    return isinstance(value, dict) and set(value) == {'commit', 'app_image', 'web_image'} and all(
        isinstance(value[key], str) and re.fullmatch(pattern, value[key])
        for key, pattern in (
            ('commit', r'[a-f0-9]{40}'),
            ('app_image', r'sha256:[a-f0-9]{64}'),
            ('web_image', r'sha256:[a-f0-9]{64}'),
        )
    )


def traffic_counts(value):
    return isinstance(value, dict) and integer(value.get('attempts'), 0, 10**12) and integer(
        value.get('failures'), 0, value['attempts']
    )


def journey_counts(value):
    return isinstance(value, dict) and set(value) == set(SERVICES) and all(
        traffic_counts(counts) for counts in value.values()
    )


def validate_plan(plan, now):
    require(isinstance(plan, dict), 'invalid_plan')
    require(identity(plan.get('scope')), 'invalid_scope')
    require(revision(plan.get('candidate')) and revision(plan.get('previous')), 'invalid_revision')
    require(plan['candidate']['commit'] != plan['previous']['commit'], 'same_revision')
    weights = plan.get('weights')
    require(
        isinstance(weights, list) and 2 <= len(weights) <= 10
        and all(integer(weight, 1, 100) for weight in weights)
        and weights[-1] == 100 and weights == sorted(set(weights)),
        'invalid_weights',
    )
    policy = plan.get('policy')
    require(isinstance(policy, dict), 'invalid_policy')
    tier = policy.get('availability_tier')
    require(isinstance(tier, str) and tier in ERROR_BUDGET, 'invalid_availability_tier')
    for field, low, high in (
        ('minimum_api_samples', 1, 10**9),
        ('minimum_journey_samples', 1, 10**9),
        ('minimum_observation_seconds', 1, 3600),
        ('stage_timeout_seconds', 2, 7200),
        ('poll_seconds', 1, 60),
        ('hook_timeout_seconds', 1, 120),
        ('baseline_max_age_seconds', 1, 86400),
        ('observation_max_age_seconds', 1, 300),
    ):
        require(integer(policy.get(field), low, high), 'invalid_' + field)
    require(
        policy['stage_timeout_seconds'] > policy['minimum_observation_seconds'],
        'invalid_observation_window',
    )
    for field, high in (
        ('max_http_error_ratio', 1),
        ('max_http_error_increase', 1),
        ('max_api_p95_increase_seconds', 10),
        ('max_slo_burn', 1000),
    ):
        require(finite(policy.get(field), 0, high), 'invalid_' + field)
    require(finite(policy.get('max_api_p95_seconds'), 0.005, 10), 'invalid_max_api_p95_seconds')
    baseline = plan.get('baseline')
    require(
        traffic_counts(baseline) and baseline.get('revision') == plan['previous']
        and baseline.get('scope') == plan['scope']
        and finite(baseline.get('observed_at'), now - policy['baseline_max_age_seconds'], now)
        and finite(baseline.get('window_start'), baseline['observed_at'] - 7200,
                   baseline['observed_at'] - policy['minimum_observation_seconds'])
        and baseline['attempts'] >= policy['minimum_api_samples'],
        'baseline_unavailable',
    )
    require(finite(baseline.get('p95_upper_seconds'), 0.005, 10), 'baseline_latency_unavailable')
    require(journey_counts(baseline.get('journeys')) and all(
        counts['attempts'] >= policy['minimum_journey_samples'] for counts in baseline['journeys'].values()
    ), 'baseline_journeys_unavailable')
    for key in ('route', 'observe'):
        command = plan.get(key)
        require(
            isinstance(command, list) and 1 <= len(command) <= 32
            and all(isinstance(part, str) and 0 < len(part) <= 4096 and '\0' not in part for part in command)
            and os.path.isabs(command[0]),
            'invalid_' + key + '_command',
        )


def hook(plan, kind, *, timeout=None, **fields):
    request = {
        'scope': plan['scope'],
        'candidate': plan['candidate'],
        'previous': plan['previous'],
        **fields,
    }
    limit = plan['policy']['hook_timeout_seconds']
    if timeout is not None:
        require(timeout > 0, 'observation_deadline')
        limit = min(limit, timeout)
    try:
        with tempfile.TemporaryFile() as output:
            with subprocess.Popen(
                plan[kind], stdin=subprocess.PIPE, stdout=output,
                stderr=subprocess.DEVNULL, start_new_session=True,
            ) as process:
                try:
                    process.communicate(json.dumps(request).encode(), timeout=limit)
                except (subprocess.TimeoutExpired, KeyboardInterrupt):
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                    raise
                require(process.returncode == 0, kind + '_command_failed')
            output.seek(0)
            body = output.read(MAX_JSON_BYTES + 1)
            require(len(body) <= MAX_JSON_BYTES, kind + '_response_too_large')
            result = json.loads(body)
    except subprocess.TimeoutExpired as error:
        raise RolloutError(kind + '_command_timeout') from error
    except (OSError, ValueError, TypeError, RecursionError) as error:
        raise RolloutError(kind + '_response_unavailable') from error
    require(isinstance(result, dict), kind + '_response_invalid')
    require(all(result.get(key) == request[key] for key in ('scope', 'candidate', 'previous')),
            kind + '_identity_mismatch')
    return result


def route(plan, action, weight, *, timeout=None):
    response = hook(plan, 'route', timeout=timeout, action=action, candidate_weight=weight)
    require(integer(response.get('candidate_weight'), 0, 100) and
            response['candidate_weight'] == weight, 'route_weight_mismatch')
    require(response.get('previous_ready') is True, 'previous_not_ready')


def observe(plan, weight, since, *, preflight=False, timeout=None):
    sample = hook(plan, 'observe', timeout=timeout, candidate_weight=weight, window_start=since)
    policy = plan['policy']
    now = time.time()
    require(integer(sample.get('candidate_weight'), 0, 100) and
            sample['candidate_weight'] == weight, 'observation_weight_mismatch')
    require(finite(sample.get('observed_at'), max(since, now - policy['observation_max_age_seconds']), now),
            'observation_stale')
    observed_at = sample['observed_at']
    require(finite(sample.get('window_start'), since, observed_at), 'observation_window_mismatch')
    smoke = sample.get('smoke')
    require(isinstance(smoke, dict) and set(smoke) == set(SMOKE_CHECKS), 'smoke_unavailable')
    for name, passed in smoke.items():
        require(type(passed) is bool, 'smoke_unavailable')
        require(passed, 'smoke_failed_' + name)
    for field in ('critical_wallet_drift', 'security_alerts'):
        require(integer(sample.get(field), 0, 10**12), field + '_unavailable')
        require(sample[field] == 0, field, count=sample[field])
    signals = {
        'observed_at': observed_at,
        'window_start': sample['window_start'],
        'smoke': smoke,
        'critical_wallet_drift': sample['critical_wallet_drift'],
        'security_alerts': sample['security_alerts'],
    }
    if preflight:
        return True, signals

    api = sample.get('api')
    journeys = sample.get('journeys')
    require(traffic_counts(api), 'api_counts_unavailable')
    require(journey_counts(journeys), 'journey_counts_unavailable')
    baseline = plan['baseline']['failures'] / plan['baseline']['attempts']
    baseline_p95 = plan['baseline']['p95_upper_seconds']
    candidate_p95 = api.get('p95_upper_seconds')
    error_ratio = api['failures'] / api['attempts'] if api['attempts'] else None
    burn = {}
    api_ready = api['attempts'] >= policy['minimum_api_samples']
    journeys_ready = True
    if api_ready:
        require(error_ratio <= policy['max_http_error_ratio'], 'http_error_ratio',
                observed=error_ratio, limit=policy['max_http_error_ratio'])
        require(error_ratio - baseline <= policy['max_http_error_increase'], 'http_error_increase',
                observed=error_ratio, baseline=baseline, limit=policy['max_http_error_increase'])
        require(finite(candidate_p95, 0.005, 10), 'api_latency_unavailable')
        require(candidate_p95 <= policy['max_api_p95_seconds'], 'api_p95_budget',
                observed=candidate_p95, baseline=baseline_p95, limit=policy['max_api_p95_seconds'])
        require(candidate_p95 <= baseline_p95 + policy['max_api_p95_increase_seconds'], 'api_p95_increase',
                observed=candidate_p95, baseline=baseline_p95, limit=policy['max_api_p95_increase_seconds'])
    budget = ERROR_BUDGET[policy['availability_tier']]
    previous_journeys = plan['baseline']['journeys']
    previous_burn = {
        service: (counts['failures'] / counts['attempts']) / budget
        for service, counts in previous_journeys.items()
    }
    for service, counts in journeys.items():
        attempts = counts['attempts']
        burn[service] = (counts['failures'] / attempts) / budget if attempts else None
        if attempts >= policy['minimum_journey_samples']:
            require(burn[service] <= policy['max_slo_burn'], 'slo_burn_' + service,
                    observed=burn[service], limit=policy['max_slo_burn'])
        else:
            journeys_ready = False
    window_ready = observed_at - sample['window_start'] >= policy['minimum_observation_seconds']
    return api_ready and journeys_ready and window_ready, {
        **signals,
        'api': {'attempts': api['attempts'], 'failures': api['failures']},
        'baseline_http_error_ratio': baseline,
        'http_error_ratio': error_ratio,
        'baseline_api_p95_upper_seconds': baseline_p95,
        'api_p95_upper_seconds': candidate_p95 if finite(candidate_p95, 0.005, 10) else None,
        'journeys': {
            service: {'attempts': counts['attempts'], 'failures': counts['failures']}
            for service, counts in journeys.items()
        },
        'journey_burn': burn,
        'baseline_journey_burn': previous_burn,
    }


def roll_out(plan, record):
    traffic_attempted = False
    try:
        route(plan, 'read', 0)
        _, preflight = observe(plan, 0, time.time(), preflight=True)
        record('preflight_passed', weight=0, **preflight)
        policy = plan['policy']
        for weight in plan['weights']:
            record('traffic_change_requested', weight=weight)
            traffic_attempted = True
            route(plan, 'set', weight)
            since = time.time()
            record('traffic_verified', weight=weight)
            deadline = time.monotonic() + policy['stage_timeout_seconds']
            while True:
                route(plan, 'read', weight, timeout=deadline - time.monotonic())
                ready, evidence = observe(plan, weight, since, timeout=deadline - time.monotonic())
                record('observation', weight=weight, ready=ready, **evidence)
                require(time.monotonic() <= deadline, 'observation_deadline')
                if ready:
                    break
                time.sleep(min(policy['poll_seconds'], max(0, deadline - time.monotonic())))
                require(time.monotonic() < deadline, 'observation_deadline')
        record('completed', weight=100)
        return 0
    except (RolloutError, OSError, KeyboardInterrupt) as error:
        if isinstance(error, RolloutError):
            reason = str(error)
            evidence = error.evidence
        else:
            reason = 'interrupted' if isinstance(error, KeyboardInterrupt) else 'receipt_unavailable'
            evidence = {}
        record_failure(record, 'halted', reason=reason, **evidence)
        if not traffic_attempted:
            return 1
        try:
            route(plan, 'set', 0)
            record_failure(record, 'rolled_back', weight=0)
            return 2
        except (RolloutError, KeyboardInterrupt):
            record_failure(record, 'rollback_unverified')
            return 3


def record_failure(record, event, **fields):
    try:
        record(event, **fields)
    except OSError:
        print(event, file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        plan_path = args.plan.resolve()
        with plan_path.open('rb') as file:
            content = file.read(MAX_JSON_BYTES + 1)
        require(len(content) <= MAX_JSON_BYTES, 'plan_too_large')
        plan = json.loads(content)
        validate_plan(plan, time.time())
        with (plan_path.parent / '.rollout.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with args.receipt.open('x') as receipt:
                def record(event, **fields):
                    receipt.write(json.dumps({'event': event, 'recorded_at': time.time(), **fields}) + '\n')
                    receipt.flush()
                    os.fsync(receipt.fileno())

                record('plan', sha256=sha256(content).hexdigest(), scope=plan['scope'],
                       candidate=plan['candidate'], previous=plan['previous'])
                return roll_out(plan, record)
    except RolloutError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, TypeError, RecursionError):
        print('rollout_plan_or_receipt_unavailable', file=sys.stderr)
        return 1


def interrupt(_signal, _frame):
    raise KeyboardInterrupt


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupt)
    sys.exit(main())
