import concurrent.futures
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
INIT = ROOT / 'deploy/staging/init-runtime.sh'


class AiRuntimeConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runtime = Path(self.temp.name) / 'private/runtime.env'

    def initialize(self):
        return subprocess.run(
            ['bash', str(INIT)], capture_output=True, text=True, timeout=15,
            env={**os.environ, 'BARGHSA_STAGING_RUNTIME_FILE': str(self.runtime)},
        )

    def write(self, contents):
        self.runtime.parent.mkdir(parents=True, exist_ok=True)
        self.runtime.write_text(contents)

    def secret(self):
        return re.findall(r'^AI_INFERENCE_SHARED_SECRET=(.+)$', self.runtime.read_text(), re.M)

    def test_new_private_runtime_contains_a_random_secret_without_printing_it(self):
        result = self.initialize()
        self.assertEqual(result.returncode, 0, result.stderr)
        values = self.secret()
        self.assertEqual(len(values), 1)
        self.assertRegex(values[0], r'^[a-f0-9]{64}$')
        self.assertNotIn(values[0], result.stdout + result.stderr)
        self.assertEqual(self.runtime.stat().st_mode & 0o777, 0o600)
        self.assertIn('AI_MODEL_ENCRYPTION_KEY=', self.runtime.read_text())

    def test_existing_runtime_keeps_every_original_byte_and_credential(self):
        original = 'UNRELATED_VALUE=keep\nAI_MODEL_ENCRYPTION_KEY=existing-key'
        self.write(original)
        result = self.initialize()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.runtime.read_text().startswith(original + '\n'))
        self.assertEqual(len(self.secret()), 1)
        self.assertNotIn(self.secret()[0], result.stdout + result.stderr)

    def test_existing_strong_secret_is_not_rotated(self):
        original = 'AI_INFERENCE_SHARED_SECRET="' + 'a' * 64 + '"\nOTHER=preserved\n'
        self.write(original)
        self.assertEqual(self.initialize().returncode, 0)
        self.assertEqual(self.runtime.read_text(), original)

    def test_short_secret_is_refused_without_modifying_or_printing_it(self):
        original = 'AI_INFERENCE_SHARED_SECRET=short-private\nOTHER=preserved\n'
        self.write(original)
        result = self.initialize()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.runtime.read_text(), original)
        self.assertNotIn('short-private', result.stdout + result.stderr)

    def test_duplicate_secret_is_refused_without_modifying_the_file(self):
        original = 'AI_INFERENCE_SHARED_SECRET=' + 'a' * 64 + '\nAI_INFERENCE_SHARED_SECRET=' + 'b' * 64 + '\n'
        self.write(original)
        self.assertNotEqual(self.initialize().returncode, 0)
        self.assertEqual(self.runtime.read_text(), original)

    def test_concurrent_existing_runtime_upgrades_share_one_secret(self):
        original = 'SESSION_SECRET=preserved\nOTHER=preserved\n'
        self.write(original)
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
            results = list(workers.map(lambda _: self.initialize(), range(8)))
        self.assertTrue(all(result.returncode == 0 for result in results))
        self.assertTrue(self.runtime.read_text().startswith(original))
        self.assertEqual(len(self.secret()), 1)

    def test_compose_routes_private_inference_without_core_readiness_dependency(self):
        values = {
            'BARGHSA_APP_IMAGE': 'barghsa-app:vps-synthetic',
            'BARGHSA_WEB_IMAGE': 'barghsa-web:vps-synthetic',
            'BARGHSA_POSTGRES_IMAGE': 'barghsa-postgres:vps-synthetic',
            'BARGHSA_CLAMAV_IMAGE': 'barghsa-clamav:vps-synthetic',
            'POSTGRES_DB': 'synthetic', 'POSTGRES_USER': 'synthetic',
            'POSTGRES_PASSWORD': 'synthetic-only', 'S3_ACCESS_KEY_ID': 'synthetic-only',
            'S3_SECRET_ACCESS_KEY': 'synthetic-only', 'S3_BUCKET': 'synthetic',
        }
        self.write(''.join(f'{key}={value}\n' for key, value in values.items()))
        # Replace only the external private file path with this fixture's owned file.
        source = (ROOT / 'deploy/staging/compose.yml').read_text()
        self.assertEqual(source.count('env_file: /etc/barghsa/staging/runtime.env'), 3)
        compose = Path(self.temp.name) / 'compose.yml'
        compose.write_text(source.replace('/etc/barghsa/staging/runtime.env', str(self.runtime)))
        result = subprocess.run(
            ['docker', 'compose', '--env-file', str(self.runtime), '-f',
             str(compose), 'config', '--format', 'json'],
            capture_output=True, text=True, timeout=15, env={**os.environ, **values},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        services = json.loads(result.stdout)['services']
        ai = services['ai-inference']
        self.assertEqual(ai['image'], services['api']['image'])
        self.assertEqual(ai['command'], ['node', 'worker/dist/ai-inference/main.js'])
        self.assertEqual(ai['healthcheck']['test'], ['CMD', 'node', 'worker/healthcheck.js'])
        self.assertEqual(ai['environment']['WORKER_PORT'], '9091')
        self.assertEqual(ai['environment']['DB_POOL_MAX'], '5')
        self.assertFalse(ai.get('ports'))
        self.assertTrue(ai['read_only'])
        self.assertEqual(ai['cap_drop'], ['ALL'])
        self.assertIn('no-new-privileges:true', ai['security_opt'])
        self.assertEqual(services['api']['environment']['AI_INFERENCE_URL'], 'http://ai-inference:9091')
        self.assertNotIn('ai-inference', services['api']['depends_on'])


if __name__ == '__main__':
    unittest.main()
