import base64
from contextlib import ExitStack
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('compose-with-credentials.py')
SPEC = importlib.util.spec_from_file_location('compose_with_credentials', SCRIPT)
launcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(launcher)


class CredentialInputTest(unittest.TestCase):
    def test_credential_must_be_private_regular_file(self):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            source = Path(directory) / 'source'
            source.write_bytes(b'fixture')
            source.chmod(0o644)
            link = source.with_name('link')
            link.symlink_to(source)
            for path in (source, link, Path(directory)):
                with self.subTest(path=path), self.assertRaisesRegex(ValueError, 'private, nonempty regular file'):
                    launcher.open_credential(stack, path, 'runtime')

    def test_keyless_format_is_rejected_before_decryption(self):
        with tempfile.TemporaryFile() as source, ExitStack() as stack:
            keyless_format = bytes.fromhex('058469daf6f54324800549da0f8ea2fb')
            source.write(base64.b64encode(keyless_format + b'fixture'))
            source.flush()
            with self.assertRaisesRegex(ValueError, 'deployment host key'):
                launcher.resolve_credential(stack, source.fileno(), 'runtime')


@unittest.skipUnless(
    hasattr(os, 'memfd_create') and shutil.which('systemd-creds') and shutil.which('docker'),
    'requires Linux, systemd-creds and Docker Compose',
)
class ComposeIntegrationTest(unittest.TestCase):
    def setUp(self):
        directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.dict(os.environ, {'SYSTEMD_CREDENTIAL_SECRET': str(directory / 'host-key')}))
        manifest = directory / 'images.env'
        ca = directory / 'ca.pem'
        ca.touch()
        manifest.write_text(
            ''.join(f'BARGHSA_{name}_REPOSITORY=example.invalid/{name.lower()}\n'
                    f'BARGHSA_{name}_DIGEST={"a" * 64}\n' for name in ('APP', 'WEB', 'CLAMAV'))
            + f'BARGHSA_DATABASE_CA_FILE={ca}\n', encoding='utf-8',
        )
        for role in ('runtime', 'migration'):
            path = directory / f'{role}.cred'
            subprocess.run(
                ['systemd-creds', 'encrypt', '--with-key=host', f'--name=barghsa-{role}', '-', str(path)],
                input=f'REHEARSAL_ROLE={role}\n'.encode(), capture_output=True, check=True,
            )
            path.chmod(0o600)
        self.options = SimpleNamespace(
            env_file=str(manifest), runtime=directory / 'runtime.cred', migration=directory / 'migration.cred',
        )

    def assert_service_roles(self, config):
        expected_roles = {
            'api': 'runtime', 'worker': 'runtime', 'ai-inference': 'runtime',
            'migrate': 'migration', 'web': None, 'clamav': None,
        }
        services = json.loads(config)['services']
        for name, expected in expected_roles.items():
            self.assertEqual(services[name].get('environment', {}).get('REHEARSAL_ROLE'), expected)

    def test_compose_resolves_distinct_roles_and_closes_memory_files(self):
        actual_run = subprocess.run
        paths = []

        def inspect_run(args, **kwargs):
            if args[:2] == ['docker', 'compose']:
                env = kwargs['env']
                for role in ('RUNTIME', 'MIGRATION'):
                    path = Path(env[f'BARGHSA_{role}_ENV_FILE'])
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                    paths.append(path)
                result = actual_run([*args[:-1], '--format', 'json'], env=env, capture_output=True, check=True)
                self.assert_service_roles(result.stdout)
            return actual_run(args, **kwargs)

        with patch.object(launcher.subprocess, 'run', side_effect=inspect_run):
            self.assertEqual(launcher.run_compose(self.options, ['config', '--quiet']), 0)
        self.assertEqual(len(set(paths)), 2)
        self.assertTrue(all(not path.exists() for path in paths))

    def test_protected_dotenv_files_use_the_same_manifest(self):
        env = os.environ.copy()
        for role in ('runtime', 'migration'):
            path = Path(self.options.env_file).with_name(f'{role}.env')
            path.write_text(f'REHEARSAL_ROLE={role}\n', encoding='utf-8')
            path.chmod(0o600)
            env[f'BARGHSA_{role.upper()}_ENV_FILE'] = str(path)
        result = subprocess.run(
            ['docker', 'compose', '--env-file', self.options.env_file, '-f', str(launcher.COMPOSE_FILE),
             'config', '--format', 'json'], env=env, capture_output=True, check=True,
        )
        self.assert_service_roles(result.stdout)

    def test_swapped_and_aliased_inputs_fail(self):
        self.options.runtime, self.options.migration = self.options.migration, self.options.runtime
        with self.assertRaisesRegex(ValueError, 'runtime credential could not be decrypted'):
            launcher.run_compose(self.options, ['config', '--quiet'])
        os.unlink(self.options.migration)
        os.link(self.options.runtime, self.options.migration)
        with self.assertRaisesRegex(ValueError, 'separate credential files'):
            launcher.run_compose(self.options, ['config', '--quiet'])

    def test_full_config_output_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'config --quiet'):
            launcher.run_compose(self.options, ['config'])


if __name__ == '__main__':
    unittest.main()
