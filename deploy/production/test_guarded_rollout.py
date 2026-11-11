from contextlib import redirect_stderr
import fcntl
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('guarded-rollout.py')
SPEC = importlib.util.spec_from_file_location('guarded_rollout', SCRIPT)
rollout = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rollout)
SCOPE = {'environment': 'isolated-rehearsal', 'database': 'core'}
CANDIDATE = {'commit': 'a' * 40, 'app_image': 'sha256:' + 'b' * 64, 'web_image': 'sha256:' + 'c' * 64}
PREVIOUS = {'commit': 'd' * 40, 'app_image': 'sha256:' + 'e' * 64, 'web_image': 'sha256:' + 'f' * 64}


def plan(now=100):
    return {
        'scope': SCOPE, 'candidate': CANDIDATE, 'previous': PREVIOUS,
        'weights': [5, 100],
        'policy': {
            'availability_tier': 'pilot', 'minimum_api_samples': 10, 'minimum_journey_samples': 10,
            'minimum_observation_seconds': 1, 'stage_timeout_seconds': 3, 'poll_seconds': 1,
            'hook_timeout_seconds': 2, 'baseline_max_age_seconds': 60,
            'observation_max_age_seconds': 10, 'max_http_error_ratio': 0.15,
            'max_http_error_increase': 0.05, 'max_slo_burn': 2,
            'max_api_p95_seconds': 0.5, 'max_api_p95_increase_seconds': 0.1,
        },
        'baseline': {'scope': SCOPE, 'revision': PREVIOUS, 'observed_at': now - 1,
                     'window_start': now - 3, 'attempts': 100, 'failures': 2, 'p95_upper_seconds': 0.25,
                     'journeys': {service: {'attempts': 100, 'failures': 1}
                                  for service in rollout.SERVICES}},
        'route': ['/usr/bin/false'],
        'observe': ['/usr/bin/false'],
    }


def sample():
    return {
        'candidate_weight': 5, 'observed_at': 100, 'window_start': 98,
        'smoke': dict.fromkeys(rollout.SMOKE_CHECKS, True),
        'api': {'attempts': 100, 'failures': 2, 'p95_upper_seconds': 0.25},
        'journeys': {service: {'attempts': 100, 'failures': 0} for service in rollout.SERVICES},
        'critical_wallet_drift': 0, 'security_alerts': 0,
    }


class ObservationsTest(unittest.TestCase):
    def evaluate(self, value, selected=None):
        with patch.object(rollout, 'hook', return_value=value), patch.object(rollout.time, 'time', return_value=100):
            return rollout.observe(selected or plan(), 5, 98)

    def test_healthy_window_retains_only_bounded_evidence(self):
        value = sample()
        value['api']['private_input'] = 'SYNTHETIC_SECRET'
        value['journeys']['solar']['private_input'] = 'SYNTHETIC_SECRET'
        ready, details = self.evaluate(value)
        self.assertTrue(ready)
        self.assertEqual(details['api'], {'attempts': 100, 'failures': 2})
        self.assertEqual(details['baseline_http_error_ratio'], 0.02)
        self.assertEqual(details['baseline_api_p95_upper_seconds'], 0.25)
        self.assertEqual(details['api_p95_upper_seconds'], 0.25)
        self.assertEqual(details['journey_burn'], dict.fromkeys(rollout.SERVICES, 0))
        self.assertEqual(details['baseline_journey_burn'], dict.fromkeys(rollout.SERVICES, 2))
        self.assertNotIn('SYNTHETIC_SECRET', json.dumps(details))

    def test_every_rollback_signal_is_evaluated(self):
        for reason in (
            'smoke_failed_consultation', 'http_error_ratio', 'http_error_increase',
            'slo_burn_solar', 'critical_wallet_drift', 'security_alerts',
        ):
            value = sample()
            if reason == 'smoke_failed_consultation':
                value['smoke']['consultation'] = False
            elif reason.startswith('http_error'):
                value['api']['failures'] = 20 if reason.endswith('ratio') else 8
            elif reason == 'slo_burn_solar':
                value['journeys']['solar']['failures'] = 2
            else:
                value[reason] = 1
            with self.subTest(reason=reason), self.assertRaisesRegex(rollout.RolloutError, reason):
                self.evaluate(value)

    def test_unknown_and_stale_evidence_cannot_promote(self):
        for changes, reason in (
            ({'observed_at': 89}, 'observation_stale'),
            ({'window_start': 97}, 'observation_window_mismatch'),
            ({'candidate_weight': 0}, 'observation_weight_mismatch'),
            ({'security_alerts': None}, 'security_alerts_unavailable'),
            ({'critical_wallet_drift': False}, 'critical_wallet_drift_unavailable'),
            ({'smoke': {}}, 'smoke_unavailable'),
            ({'journeys': {}}, 'journey_counts_unavailable'),
        ):
            with self.subTest(reason=reason), self.assertRaisesRegex(rollout.RolloutError, reason):
                self.evaluate({**sample(), **changes})

    def test_latency_only_failure_blocks_advancement(self):
        for bound, reason in (
            (None, 'api_latency_unavailable'),
            (1, 'api_p95_budget'),
            (0.5, 'api_p95_increase'),
        ):
            value = sample()
            value['api']['p95_upper_seconds'] = bound
            with self.subTest(reason=reason), self.assertRaisesRegex(rollout.RolloutError, reason):
                self.evaluate(value)

    def test_each_journey_needs_its_own_volume_and_window(self):
        value = sample()
        value['journeys']['saving']['attempts'] = 9
        self.assertFalse(self.evaluate(value)[0])
        value['journeys']['saving']['attempts'] = 10
        value['window_start'] = 99.5
        self.assertFalse(self.evaluate(value)[0])

    def test_preflight_validates_baseline_and_exact_plan_before_hooks(self):
        value = plan()
        rollout.validate_plan(value, 100)
        for changes, reason in (
            ({'weights': [100]}, 'invalid_weights'),
            ({'weights': [25, 5, 100]}, 'invalid_weights'),
            ({'candidate': PREVIOUS}, 'same_revision'),
            ({'route': ['relative-command']}, 'invalid_route_command'),
            ({'baseline': {**value['baseline'], 'observed_at': 1}}, 'baseline_unavailable'),
            ({'baseline': {**value['baseline'], 'revision': CANDIDATE}}, 'baseline_unavailable'),
            ({'baseline': {**value['baseline'], 'window_start': 99}}, 'baseline_unavailable'),
            ({'baseline': {**value['baseline'], 'p95_upper_seconds': None}}, 'baseline_latency_unavailable'),
            ({'baseline': {**value['baseline'], 'journeys': {}}}, 'baseline_journeys_unavailable'),
        ):
            with self.subTest(reason=reason), self.assertRaisesRegex(rollout.RolloutError, reason):
                rollout.validate_plan({**value, **changes}, 100)

    def test_a_receipt_write_failure_does_not_leave_candidate_traffic(self):
        def record(event, **_):
            if event in ('traffic_verified', 'halted', 'rolled_back'):
                raise OSError('fixture disk full')

        with patch.object(rollout, 'route') as route, patch.object(
            rollout, 'observe', return_value=(True, {})
        ), redirect_stderr(io.StringIO()):
            self.assertEqual(rollout.roll_out(plan(), record), 2)
        self.assertEqual([(args[1], args[2]) for args, _ in route.call_args_list],
                         [('read', 0), ('set', 5), ('set', 0)])

    def test_timed_out_hook_does_not_leave_a_child_running(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'detached-effect'
            child = (
                "from pathlib import Path\nimport sys, time\n"
                "time.sleep(2)\nPath(sys.argv[1]).write_text('unexpected')\n"
            )
            parent = (
                "import subprocess, sys, time\n"
                "subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2]])\n"
                "time.sleep(20)\n"
            )
            selected = plan()
            selected['observe'] = [sys.executable, '-c', parent, child, str(marker)]
            with self.assertRaisesRegex(rollout.RolloutError, 'observe_command_timeout'):
                rollout.hook(selected, 'observe', timeout=1)
            time.sleep(1.2)
            self.assertFalse(marker.exists())


FIXTURE = '''
import json
from pathlib import Path
import sys
import time

state_path, kind, fault = sys.argv[1:]
path = Path(state_path)
state = json.loads(path.read_text())
request = json.load(sys.stdin)
result = {name: request[name] for name in ("scope", "candidate", "previous")}
if kind == "route":
    if request["action"] == "set":
        weight = request["candidate_weight"]
        if fault == "rollback_unavailable" and weight == 0:
            sys.exit(5)
        state["weight"] = weight
        state["changes"].append(weight)
        path.write_text(json.dumps(state))
    result.update(candidate_weight=state["weight"], previous_ready=True)
    if fault == "route_drift" and request["action"] == "read" and state["weight"] == 5:
        result["candidate_weight"] = 4
else:
    weight = request["candidate_weight"]
    assert weight == state["weight"]
    result.update(candidate_weight=weight, observed_at=time.time(), window_start=request["window_start"],
                  smoke=dict.fromkeys(("health", "dashboard", "wallet", "electricity", "saving", "solar", "consultation"), True),
                  api={"attempts": 100, "failures": 2, "p95_upper_seconds": 0.25}, critical_wallet_drift=0, security_alerts=0,
                  journeys={name: {"attempts": 100, "failures": 0}
                            for name in ("electricity", "saving", "solar", "consultation")})
    if fault == "smoke_before_traffic":
        result["smoke"]["health"] = False
    if weight == 5 and fault == "rollback_unavailable":
        result["critical_wallet_drift"] = 1
    if weight == 5 and fault == "no_solar_volume":
        result["journeys"]["solar"]["attempts"] = 0
    if weight == 5 and fault == "foreign_observation":
        result["scope"] = {"environment": "elsewhere", "database": "core"}
    if weight == 100 and fault == "security_at_full_traffic":
        result["security_alerts"] = 1
    if weight == 100 and fault == "latency_at_full_traffic":
        result["api"]["p95_upper_seconds"] = 0.5
print(json.dumps(result))
'''


class IsolatedRolloutTest(unittest.TestCase):
    def run_fixture(self, fault):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            hook = root / 'hook.py'
            hook.write_text(FIXTURE)
            state = root / 'traffic.json'
            state.write_text(json.dumps({'weight': 0, 'changes': []}))
            selected = plan(time.time())
            for kind in ('route', 'observe'):
                selected[kind] = [sys.executable, str(hook), str(state), kind, fault]
            config = root / 'plan.json'
            config.write_text(json.dumps(selected))
            receipt = root / 'receipt.jsonl'
            result = subprocess.run(
                [sys.executable, str(SCRIPT), '--plan', str(config), '--receipt', str(receipt)],
                text=True, capture_output=True, timeout=20,
            )
            self.assertTrue(receipt.exists(), result.stderr)
            self.assertEqual(receipt.stat().st_mode & 0o777, 0o600)
            return result.returncode, json.loads(state.read_text()), [
                json.loads(line) for line in receipt.read_text().splitlines()
            ]

    def test_healthy_ramp_reaches_full_traffic_only_after_observation(self):
        status, state, events = self.run_fixture('healthy')
        self.assertEqual(status, 0)
        self.assertEqual(state, {'weight': 100, 'changes': [5, 100]})
        self.assertEqual(events[-1]['event'], 'completed')
        self.assertEqual([row['weight'] for row in events if row.get('ready')], [5, 100])

    def test_observed_security_alert_restores_previous_after_full_traffic(self):
        status, state, events = self.run_fixture('security_at_full_traffic')
        self.assertEqual(status, 2)
        self.assertEqual(state, {'weight': 0, 'changes': [5, 100, 0]})
        self.assertEqual(events[-2]['reason'], 'security_alerts')
        self.assertEqual(events[-1]['event'], 'rolled_back')

    def test_latency_regression_restores_previous_after_full_traffic(self):
        status, state, events = self.run_fixture('latency_at_full_traffic')
        self.assertEqual(status, 2)
        self.assertEqual(state, {'weight': 0, 'changes': [5, 100, 0]})
        self.assertEqual(events[-2]['reason'], 'api_p95_increase')
        self.assertEqual(events[-2]['observed'], 0.5)
        self.assertEqual(events[-2]['baseline'], 0.25)
        self.assertEqual(events[-1]['event'], 'rolled_back')

    def test_missing_volume_stops_at_first_stage_deadline(self):
        status, state, events = self.run_fixture('no_solar_volume')
        self.assertEqual(status, 2)
        self.assertEqual(state, {'weight': 0, 'changes': [5, 0]})
        self.assertEqual(events[-2]['reason'], 'observation_deadline')
        self.assertEqual(events[-1]['event'], 'rolled_back')

    def test_failed_smoke_does_not_move_traffic_and_foreign_data_restores_it(self):
        for fault, reason, status, changes in (
            ('smoke_before_traffic', 'smoke_failed_health', 1, []),
            ('foreign_observation', 'observe_identity_mismatch', 2, [5, 0]),
            ('route_drift', 'route_weight_mismatch', 2, [5, 0]),
        ):
            with self.subTest(fault=fault):
                observed, state, events = self.run_fixture(fault)
                self.assertEqual(observed, status)
                self.assertEqual(state, {'weight': 0, 'changes': changes})
                self.assertIn(reason, [event.get('reason') for event in events])

    def test_failed_restore_remains_unverified(self):
        status, state, events = self.run_fixture('rollback_unavailable')
        self.assertEqual(status, 3)
        self.assertEqual(state, {'weight': 5, 'changes': [5]})
        self.assertEqual(events[-2]['reason'], 'critical_wallet_drift')
        self.assertEqual(events[-1]['event'], 'rollback_unverified')

    def test_shared_operator_lock_rejects_a_concurrent_invocation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = root / 'plan.json'
            config.write_text(json.dumps(plan(time.time())))
            receipt = root / 'receipt.jsonl'
            with (root / '.rollout.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = subprocess.run(
                    [sys.executable, str(SCRIPT), '--plan', str(config), '--receipt', str(receipt)],
                    text=True, capture_output=True, timeout=5,
                )
            self.assertEqual(result.returncode, 1)
            self.assertFalse(receipt.exists())


if __name__ == '__main__':
    unittest.main()
