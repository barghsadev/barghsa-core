import importlib.util
from contextlib import ExitStack
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location('deploy_pilot', Path(__file__).with_name('deploy-pilot.py'))
pilot = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pilot)


class PilotRolloutTest(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.root = Path(stack.enter_context(tempfile.TemporaryDirectory()))
        self.config = self.root / 'nginx.conf'
        self.original = Path(__file__).with_name('nginx.conf').read_text()
        self.config.write_text(self.original)
        self.plan = {
            'hostname': 'barghsa.example.com', 'proxy_config': str(self.config),
            'proxy_pid': '/var/run/nginx.pid', 'drain_seconds': 60,
            **{key: str(self.root / key) for key in ('compose_env', 'runtime', 'migration')},
            'transition_dir': str(self.root),
            'previous': {'slot': 'blue', 'commit': 'a' * 40},
            'candidate': {'slot': 'green', 'commit': 'b' * 40},
        }
        for release in ('previous', 'candidate'):
            self.plan[release]['images'] = {
                role: {'ref': f"registry.example.com/{role}@sha256:{'a' * 64}", 'id': 'sha256:' + 'b' * 64}
                for role in ('app', 'web', 'scanner')
            }
        self.events = []
        self.serving = 'blue'
        self.running = {'blue'}
        self.failure = None
        self.previous_retired = False
        for name in ('compose', 'check_images', 'check_containers', 'containers', 'smoke',
                     'workers', 'install_config', 'wait_for_route', 'drain'):
            stack.enter_context(patch.object(pilot, name, side_effect=getattr(self, name)))
        stack.enter_context(patch.object(pilot, 'prepare_transition', return_value=None))

    def compose(self, plan, release, *args, **kwargs):
        slot, action = release['slot'], args[0]
        self.events.append((action, slot))
        if self.failure == 'migration' and action == 'run':
            raise pilot.RolloutError('migration failed')
        if action == 'up':
            if self.failure == 'previous-restart' and slot == 'blue':
                raise pilot.RolloutError('previous slot did not restart')
            self.running.add(slot)
        if action == 'stop':
            self.running.remove(slot)
            if slot == 'blue':
                self.previous_retired = True

    def check_images(self, release, **kwargs):
        self.events.append(('image', release['slot'], kwargs.get('pull', False)))

    def check_containers(self, release):
        slot = release['slot']
        self.events.append(('container-health', slot))
        if self.failure == 'candidate-health' and slot == 'green':
            raise pilot.RolloutError('candidate not healthy')

    def containers(self, release):
        return [release['slot']] if release['slot'] in self.running else []

    def smoke(self, plan, release, *, through_proxy=False):
        slot = release['slot']
        self.events.append(('smoke', slot, through_proxy))
        self.assertIn(slot, self.running)
        if through_proxy:
            self.assertEqual(slot, self.serving)
            if self.failure in ('post-retirement-smoke', 'previous-restart') and slot == 'green' and self.previous_retired:
                raise pilot.RolloutError('candidate failed after retirement')

    def workers(self, path):
        return {1 if self.serving == 'blue' else 2: 'nginx: worker process'}

    def install_config(self, path, config, mode):
        self.serving = 'green' if ':13000 ' in config else 'blue'
        self.events.append(('switch', self.serving))
        path.write_text(config)

    def wait_for_route(self, plan, release):
        slot = release['slot']
        self.events.append(('readback', slot))
        if self.failure == 'unknown-route' or (self.failure == 'candidate-route' and slot == 'green'):
            raise pilot.RolloutError('proxy readback failed')
        self.smoke(plan, release, through_proxy=True)

    def drain(self, plan, workers, release):
        self.events.append(('drain', release['slot'], tuple(workers)))
        self.assertEqual(self.running, {'blue', 'green'})

    def test_success_migrates_and_verifies_before_switch_then_drains(self):
        pilot.validate(self.plan)
        pilot.rollout(self.plan)
        order = [self.events.index(event) for event in (
            ('image', 'green', True), ('run', 'green'), ('up', 'green'),
            ('container-health', 'green'), ('smoke', 'green', False), ('switch', 'green'),
            ('readback', 'green'), ('drain', 'green', (1,)), ('stop', 'blue'),
        )]
        self.assertEqual(order, sorted(order))
        self.assertEqual(self.running, {'green'})
        self.assertIn('127.0.0.1:14000', self.config.read_text())
        saved = self.root / f".barghsa-pilot-{self.plan['candidate']['commit']}.previous"
        self.assertEqual(saved.read_text(), self.original)
        self.assertEqual(saved.stat().st_mode & 0o777, 0o600)

    def test_migration_failure_keeps_previous_route_and_runtime(self):
        self.failure = 'migration'
        with self.assertRaisesRegex(pilot.RolloutError, 'migration failed'):
            pilot.rollout(self.plan)
        self.assertEqual(self.running, {'blue'})
        self.assertEqual(self.config.read_text(), self.original)
        self.assertNotIn(('up', 'green'), self.events)

    def test_unhealthy_candidate_never_receives_traffic(self):
        self.failure = 'candidate-health'
        with self.assertRaisesRegex(pilot.RolloutError, 'verified previous pilot route'):
            pilot.rollout(self.plan)
        self.assertEqual(self.running, {'blue'})
        self.assertEqual(self.config.read_text(), self.original)
        self.assertNotIn(('switch', 'green'), self.events)

    def test_failed_candidate_readback_restores_and_verifies_old_route(self):
        self.failure = 'candidate-route'
        with self.assertRaisesRegex(pilot.RolloutError, 'verified previous pilot route'):
            pilot.rollout(self.plan)
        self.assertEqual(self.running, {'blue'})
        self.assertEqual(self.config.read_text(), self.original)
        self.assertLess(self.events.index(('readback', 'blue')), self.events.index(('stop', 'green')))
        self.assertNotIn(('stop', 'blue'), self.events)

    def test_unverified_rollback_keeps_both_slots_running(self):
        self.failure = 'unknown-route'
        with self.assertRaisesRegex(pilot.RolloutError, 'rollback or cleanup could not be verified'):
            pilot.rollout(self.plan)
        self.assertEqual(self.running, {'blue', 'green'})
        self.assertEqual(self.config.read_text(), self.original)

    def test_post_retirement_failure_restarts_previous_before_restoring_traffic(self):
        self.failure = 'post-retirement-smoke'
        transition = self.root / 'active.json'
        transition.write_text('reviewed schema transition')
        with patch.object(pilot, 'prepare_transition', return_value=transition):
            with self.assertRaisesRegex(pilot.RolloutError, 'Post-retirement smoke failed; verified previous pilot route'):
                pilot.rollout(self.plan)
        recovery = self.events[self.events.index(('stop', 'blue')):]
        order = [recovery.index(event) for event in (
            ('stop', 'blue'), ('image', 'blue', False), ('up', 'blue'),
            ('container-health', 'blue'), ('smoke', 'blue', False), ('switch', 'blue'), ('readback', 'blue'),
            ('drain', 'blue', (2,)), ('stop', 'green'),
        )]
        self.assertEqual(order, sorted(order))
        self.assertEqual(self.running, {'blue'})
        self.assertEqual(self.config.read_text(), self.original)
        self.assertTrue(transition.exists())

    def test_failed_previous_restart_does_not_switch_or_stop_candidate(self):
        self.failure = 'previous-restart'
        with self.assertRaisesRegex(pilot.RolloutError, 'Post-retirement rollback could not be verified'):
            pilot.rollout(self.plan)
        self.assertEqual(self.serving, 'green')
        self.assertEqual(self.running, {'green'})
        self.assertNotIn(('switch', 'blue'), self.events)
        self.assertNotIn(('stop', 'green'), self.events)

    def test_unknown_active_proxy_and_occupied_candidate_refuse_changes(self):
        self.config.write_text(self.original.replace(':4000 ', ':4001 '))
        with self.assertRaisesRegex(pilot.RolloutError, 'expected api upstream'):
            pilot.rollout(self.plan)
        self.assertEqual(self.events, [])
        self.config.write_text(self.original)
        self.running.add('green')
        with self.assertRaisesRegex(pilot.RolloutError, 'already has running containers'):
            pilot.rollout(self.plan)
        self.assertNotIn(('run', 'green'), self.events)


class PilotImageTest(unittest.TestCase):
    def test_pull_and_inspect_use_the_pinned_reference_and_verify_image_id_and_revision(self):
        commit, image_id = 'a' * 40, 'sha256:' + 'b' * 64
        images = {role: {'ref': f"registry.example.com/{role}@sha256:{'c' * 64}", 'id': image_id}
                  for role in ('app', 'web', 'scanner')}
        with patch.object(pilot, 'run', return_value=f'{image_id} {commit}\n'.encode()) as command:
            pilot.check_images({'commit': commit, 'images': images}, pull=True)
            calls = [call.args[0] for call in command.call_args_list]
            for image in images.values():
                self.assertIn(['docker', 'pull', image['ref']], calls)
                self.assertTrue(any(args[:3] == ['docker', 'image', 'inspect'] and args[-1] == image['ref']
                                    for args in calls))
            with self.assertRaisesRegex(pilot.RolloutError, 'source revision differs'):
                pilot.check_images({'commit': 'f' * 40, 'images': images})
            command.return_value = f"sha256:{'d' * 64} {commit}\n".encode()
            with self.assertRaisesRegex(pilot.RolloutError, 'scan receipt'):
                pilot.check_images({'commit': commit, 'images': images})

    def test_schema_transition_requires_exact_history_and_protected_previous_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = {'transition_dir': directory, 'schema_transition_verified': True}
            previous = {'commit': 'a' * 40}
            candidate = {'commit': 'b' * 40}
            old_head = {'hash': 'c' * 64, 'created_at': '1000'}
            new_head = {'hash': 'd' * 64, 'created_at': '2000'}
            old = {'heads': [old_head], 'transition': 1}
            new = {'heads': [old_head, new_head], 'transition': 1}
            with patch.object(pilot, 'containers', return_value=['api-id']), \
                 patch.object(pilot, 'image_schema', side_effect=[old, new]), \
                 patch.object(pilot, 'run', return_value=b'unexpected mount'):
                with self.assertRaisesRegex(pilot.RolloutError, 'read-only schema transition mount'):
                    pilot.prepare_transition(plan, previous, candidate)
            self.assertFalse((Path(directory) / 'active.json').exists())
            inspected = f'{Path(directory).resolve()} false\nverified\nverified'.encode()
            with patch.object(pilot, 'containers', return_value=['api-id']), \
                 patch.object(pilot, 'image_schema', side_effect=[old, new]), \
                 patch.object(pilot, 'run', return_value=inspected):
                active = pilot.prepare_transition(plan, previous, candidate)
            self.assertIn(new_head['hash'], active.read_text())
            self.assertIn(previous['commit'], active.read_text())
            self.assertEqual(active.stat().st_mode & 0o777, 0o644)
            with patch.object(pilot, 'image_schema', side_effect=[old, {'heads': [new_head], 'transition': 1}]):
                with self.assertRaisesRegex(pilot.RolloutError, 'must extend'):
                    pilot.prepare_transition(plan, previous, candidate)


class PilotComposeTest(unittest.TestCase):
    def test_encrypted_launcher_includes_the_pilot_overlay_only_when_requested(self):
        source = pilot.PRODUCTION / 'compose-with-credentials.py'
        spec = importlib.util.spec_from_file_location('compose_with_credentials', source)
        launcher = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(launcher)
        options = SimpleNamespace(env_file='/protected/compose.env', runtime='runtime.cred',
                                  migration='migration.cred', pilot=False)
        with patch.object(launcher.os, 'memfd_create', create=True), \
             patch.object(launcher, 'open_credential', side_effect=[(1, 10), (2, 20)] * 2), \
             patch.object(launcher, 'resolve_credential', side_effect=['/runtime', '/migration'] * 2), \
             patch.object(launcher.subprocess, 'run') as command:
            launcher.run_compose(options, ['config', '--quiet'])
            options.pilot = True
            launcher.run_compose(options, ['config', '--quiet'])
        default, enabled = [call.args[0] for call in command.call_args_list]
        self.assertEqual(enabled, [*default[:-2], '-f', str(launcher.PILOT_OVERLAY), *default[-2:]])
        for call in command.call_args_list:
            self.assertEqual(call.kwargs['env']['BARGHSA_RUNTIME_ENV_FILE'], '/runtime')
            self.assertEqual(call.kwargs['env']['BARGHSA_MIGRATION_ENV_FILE'], '/migration')


if __name__ == '__main__':
    unittest.main()
