import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

RELEASE = Path(__file__).with_name("release.sh")
DEPLOY = RELEASE.with_name("deploy.sh")
STAGING_COMPOSE = RELEASE.with_name("compose.yml")
DEFAULT_VOLUME = "barghsa-staging_pgdata"
RESTORED_VOLUME = "barghsa-staging_pgdata-restore-1"


class ReleaseRollbackTests(unittest.TestCase):
    def run_rollback(self, simulate_failure=False, schema_ready=True, postgres_ready=True):
        with tempfile.TemporaryDirectory(prefix="barghsa-rollback-") as directory:
            root = Path(directory)
            runtime = root / "runtime.env"
            runtime.touch()
            active = root / "active.env"
            active.write_text("BARGHSA_APP_IMAGE=barghsa-app:previous\n")
            compose = root / "compose.yml"
            compose.write_text(
                'services:\n  api:\n    image: "${BARGHSA_APP_IMAGE:?Set app image}"\n'
            )
            fake_docker = root / "docker"
            fake_docker.write_text(
                """#!/usr/bin/env bash
set -eu
args=()
while [[ $# -gt 0 && $1 != up && $1 != run && $1 != stop ]]; do
  args+=("$1")
  shift
done
if [[ $1 == run ]]; then
  [[ $2 == --rm && $3 == --no-deps && $4 == api && $5 == node && $6 == -e ]]
  [[ $7 == *'dbHealth({ verifySchema: true })'* ]]
  [[ -z ${BARGHSA_APP_IMAGE+x} ]]
  [[ "$SCHEMA_READY" == 1 ]]
  exit
fi
if [[ $1 == stop ]]; then
  [[ $* == 'stop worker web api ai-inference' ]]
  echo apps-stopped
  exit
fi
[[ $* == 'up -d --no-deps --wait --wait-timeout 240 api web worker ai-inference' ]]
"$REAL_DOCKER" "${args[@]}" config --format json
[[ "$SIMULATE_FAILURE" == 0 ]]
"""
            )
            fake_docker.chmod(0o755)
            text = RELEASE.read_text()
            function = text[text.index("rollback() {"):text.index("\n# Check an existing container")]
            env = {
                **os.environ,
                "PATH": f"{root}:{os.environ['PATH']}",
                "REAL_DOCKER": shutil.which("docker") or "docker",
                "BARGHSA_APP_IMAGE": "barghsa-app:failed-candidate",
                "SCHEMA_READY": "1" if schema_ready else "0",
                "POSTGRES_READY": "1" if postgres_ready else "0",
                "SIMULATE_FAILURE": "1" if simulate_failure else "0",
            }
            script = (
                'set -euo pipefail\n'
                'runtime=$1\nactive=$2\ncompose=$3\n'
                'postgres_id=fixture\nverify_running_image() { [[ $* == "postgres fixture" && "$POSTGRES_READY" == 1 ]]; }\n'
                f'{function}\n'
                "trap rollback ERR\nbash -c 'exit 17'\necho unreachable\n"
            )
            return subprocess.run(
                ["bash", "-c", script, "rollback-fixture", str(runtime), str(active), str(compose)],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )

    def test_rollback_reads_previous_image_instead_of_exported_candidate(self):
        result = self.run_rollback()
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual(json.loads(result.stdout)["services"]["api"]["image"], "barghsa-app:previous")
        self.assertNotIn("Restoring the previous staging app images failed", result.stderr)

    def test_unhealthy_rollback_reports_failure_and_preserves_original_status(self):
        result = self.run_rollback(simulate_failure=True)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertIn("Restoring the previous staging app images failed", result.stderr)

    def test_schema_mismatch_stops_application_instead_of_starting_previous_images(self):
        result = self.run_rollback(schema_ready=False)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual(result.stdout.strip(), "apps-stopped")
        self.assertIn("Previous app could not verify the current database schema", result.stderr)
        self.assertIn("Recover the matching app and database pair, or roll forward", result.stderr)

    def test_postgres_mismatch_stops_application_before_rollback_schema_check(self):
        result = self.run_rollback(postgres_ready=False)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertEqual(result.stdout.strip(), "apps-stopped")
        self.assertIn("PostgreSQL image or volume could not be verified for rollback", result.stderr)
        self.assertNotIn("Previous app could not verify", result.stderr)

    def test_manifest_carries_forward_the_remote_volume_and_refuses_failed_read(self):
        text = DEPLOY.read_text()
        selection = text[text.index('postgres_volume='):text.index('  if [[ -n "$bundle_dir" ]]')]
        script = f'''set -euo pipefail
ssh_args=(-o BatchMode=yes)
remote=fixture
ssh() {{
  [[ $1 == -o && $2 == BatchMode=yes && $3 == fixture && $4 == *POSTGRES_VOLUME* ]] || return 3
  if [[ $READ_STATUS != 0 ]]; then return "$READ_STATUS"; fi
  printf '%s' "$STATEFUL"
}}
{selection}
  echo bootstrap
fi
printf '%s\\n' "$postgres_volume"
'''
        images = "BARGHSA_POSTGRES_IMAGE=barghsa-postgres:vps-fixture\nBARGHSA_CLAMAV_IMAGE=barghsa-clamav:vps-fixture\n"
        for config, read_status, expected, code in (
            (images, 0, DEFAULT_VOLUME, 0),
            (images + f"BARGHSA_POSTGRES_VOLUME={RESTORED_VOLUME}\n", 0, RESTORED_VOLUME, 0),
            (images + "BARGHSA_POSTGRES_VOLUME=\n", 0, "", 1),
            (images + "BARGHSA_POSTGRES_VOLUME=wrong-volume\n", 0, "", 1),
            ("", 1, "", 1),
            ("", 255, "", 255),
            ("", 0, f"bootstrap\n{DEFAULT_VOLUME}", 0),
        ):
            with self.subTest(config=config, read_status=read_status):
                result = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                                        env={**os.environ, 'STATEFUL': config, 'READ_STATUS': str(read_status)})
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual(result.stdout.strip(), expected)

    def test_release_rejects_a_changed_or_missing_active_volume_before_compose(self):
        text = RELEASE.read_text()
        guard = text[text.index('[[ "$BARGHSA_POSTGRES_VOLUME" =~'):text.index('\ndc=(docker compose')]
        script = f'''set -euo pipefail
active=$1
docker() {{
  [[ $* == "volume inspect $BARGHSA_POSTGRES_VOLUME" && "$2 $3" != "inspect $MISSING_VOLUME" ]]
}}
{guard}
echo compose-admitted
'''
        images = "BARGHSA_POSTGRES_IMAGE=barghsa-postgres:vps-fixture\nBARGHSA_CLAMAV_IMAGE=barghsa-clamav:vps-fixture\n"
        with tempfile.TemporaryDirectory(prefix='barghsa-volume-') as directory:
            active = Path(directory) / 'active.env'
            for manifest, volume, missing, diagnostic in (
                (images, DEFAULT_VOLUME, '', ''),
                (images, RESTORED_VOLUME, '', 'PostgreSQL volume changed'),
                (images + f'BARGHSA_POSTGRES_VOLUME={RESTORED_VOLUME}\n', RESTORED_VOLUME, '', ''),
                (images + f'BARGHSA_POSTGRES_VOLUME={RESTORED_VOLUME}\n', DEFAULT_VOLUME, '', 'PostgreSQL volume changed'),
                (images, DEFAULT_VOLUME, DEFAULT_VOLUME, 'active PostgreSQL volume is missing'),
                (None, RESTORED_VOLUME, '', 'requires the default PostgreSQL volume'),
            ):
                with self.subTest(volume=volume, missing=missing, diagnostic=diagnostic):
                    if manifest is None:
                        active.unlink(missing_ok=True)
                    else:
                        active.write_text(manifest)
                    result = subprocess.run(['bash', '-c', script, 'fixture', str(active)],
                                            capture_output=True, text=True,
                                            env={**os.environ, 'BARGHSA_POSTGRES_VOLUME': volume,
                                                 'BARGHSA_POSTGRES_IMAGE': 'barghsa-postgres:vps-fixture',
                                                 'BARGHSA_CLAMAV_IMAGE': 'barghsa-clamav:vps-fixture',
                                                 'MISSING_VOLUME': missing})
                    self.assertEqual(result.returncode, bool(diagnostic), result.stderr)
                    self.assertEqual('compose-admitted' in result.stdout, not diagnostic)
                    if diagnostic:
                        self.assertIn(diagnostic, result.stderr)

    def test_compose_mounts_the_default_or_recorded_volume(self):
        compose_env = {**os.environ, 'BARGHSA_APP_IMAGE': 'fixture', 'BARGHSA_WEB_IMAGE': 'fixture',
                       'BARGHSA_POSTGRES_IMAGE': 'fixture', 'BARGHSA_CLAMAV_IMAGE': 'fixture',
                       'POSTGRES_DB': 'fixture', 'POSTGRES_USER': 'fixture', 'POSTGRES_PASSWORD': 'fixture',
                       'S3_ACCESS_KEY_ID': 'fixture', 'S3_SECRET_ACCESS_KEY': 'fixture', 'S3_BUCKET': 'fixture'}
        for selected in ('', RESTORED_VOLUME):
            with self.subTest(selected=selected):
                result = subprocess.run(['docker', 'compose', '--env-file', '/dev/null', '-f', str(STAGING_COMPOSE),
                                         'config', '--no-env-resolution', '--format', 'json'],
                                        capture_output=True, text=True, check=True,
                                        env={**compose_env, 'BARGHSA_POSTGRES_VOLUME': selected})
                config = json.loads(result.stdout)
                self.assertEqual(config['volumes']['pgdata']['name'], selected or DEFAULT_VOLUME)
                self.assertIn({'type': 'volume', 'source': 'pgdata', 'target': '/var/lib/postgresql/data', 'volume': {}},
                              config['services']['postgres']['volumes'])

    def test_migrations_wait_for_a_successful_writer_stop(self):
        text = RELEASE.read_text()
        start = text.index('\n', text.index("echo 'Disposable staging: no offsite backup is configured'"))
        end = text.index('\n"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 ai-inference', start)
        script = f'''set -euo pipefail
mode=$1
dc=(compose)
compose() {{
  printf '%s\\n' "$*"
  if [[ $1 == stop && "$mode" == stop-failed ]]; then return 19; fi
}}
trap 'status=$?; echo rollback; exit "$status"' ERR
{text[start:end]}
'''
        for mode, expected, code in (
            ('stopped', ['stop worker api ai-inference', 'run --rm --no-deps api node run-packaged-migrations.cjs'], 0),
            ('stop-failed', ['stop worker api ai-inference', 'rollback'], 19),
        ):
            with self.subTest(mode=mode):
                result = subprocess.run(['bash', '-c', script, 'migration-fixture', mode],
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual(result.stdout.splitlines(), expected)

    def test_image_identity_is_checked_before_start_and_after_rollout(self):
        text = RELEASE.read_text()
        loaded = text[text.index('commit=${BARGHSA_STAGING_RELEASE_COMMIT:-}'):
                      text.index('\nif [[ -e "$active" ]]')]
        verify = text[text.index("verify_postgres_mount() {"):text.index("\nrollback() {")]
        before_start = text[text.index('# Check an existing container'):text.index('\ntrap rollback ERR')]
        stateful = text[text.index('\nverify_running_image postgres "$postgres_id"\n'):
                        text.index("\n# Host NGINX enters")]
        running = text[text.index("for service in api worker ai-inference web"):
                       text.index("\nfor health in live ready")]
        final_stateful = text[text.rindex('\nverify_running_image postgres "$postgres_id"\n'):
                              text.index('\ninstall -m 0600 "$candidate" "$active"')]
        receipt = text[text.rindex('if [[ -n "$commit" ]]; then'):]
        script = f'''set -euo pipefail
BARGHSA_STAGING_RELEASE_COMMIT={'a' * 40}
BARGHSA_APP_IMAGE=barghsa-app:vps-fixture
BARGHSA_WEB_IMAGE=barghsa-web:vps-fixture
BARGHSA_POSTGRES_IMAGE=barghsa-postgres:vps-fixture
BARGHSA_POSTGRES_VOLUME={RESTORED_VOLUME}
BARGHSA_CLAMAV_IMAGE=barghsa-clamav:vps-fixture
BARGHSA_APP_IMAGE_ID=sha256:{'a' * 64}
BARGHSA_WEB_IMAGE_ID=sha256:{'b' * 64}
if [[ "$1" == bootstrap || "$1" == wrong-bootstrap-image ]]; then
  BARGHSA_POSTGRES_IMAGE_ID=$(printf 'sha256:%064d' 3)
  BARGHSA_CLAMAV_IMAGE_ID=$(printf 'sha256:%064d' 4)
  if [[ "$1" == wrong-bootstrap-image ]]; then
    BARGHSA_POSTGRES_IMAGE_ID=$(printf 'sha256:%064d' 5)
  fi
fi
dc=(compose)
compose() {{
  if [[ $* == 'ps -q postgres' ]]; then printf '%s\\n' postgres-running; return; fi
  printf '%s\\n' "${{@: -1}}"
}}
docker() {{
  if [[ "$4" == *'.Mounts'* ]]; then
    case "$mode" in
      wrong-volume) printf '%s\\n' 'volume:{DEFAULT_VOLUME}:true' ;;
      read-only-volume) printf '%s\\n' 'volume:{RESTORED_VOLUME}:false' ;;
      changed-after-start|changed-before-acceptance) printf '%s\\n' "$(cat "$MOUNT_FIXTURE")" ;;
      *) printf '%s\\n' 'volume:{RESTORED_VOLUME}:true' ;;
    esac
  elif [[ "$4" == *org.opencontainers.image.revision* ]]; then
    if [[ "$mode" == revision && "$5" == "$BARGHSA_WEB_IMAGE_ID" ]]; then
      printf '%s\\n' {'b' * 40}
    else
      printf '%s\\n' "$BARGHSA_STAGING_RELEASE_COMMIT"
    fi
  elif [[ "$1:$5" == "$mode" ]]; then
    printf 'sha256:%064d\\n' 0
  elif [[ "$1:$5" == "image:barghsa-clamav:vps-fixture" && "$mode" == malformed ]]; then
    printf '%s\\n' not-an-image
  elif [[ "$5" == "$BARGHSA_WEB_IMAGE" || "$5" == web ]]; then
    printf '%s\\n' "$BARGHSA_WEB_IMAGE_ID"
  elif [[ "$5" == "$BARGHSA_POSTGRES_IMAGE" || "$5" == postgres || "$5" == postgres-running ]]; then
    printf 'sha256:%064d\\n' 3
  elif [[ "$5" == "$BARGHSA_CLAMAV_IMAGE" || "$5" == clamav ]]; then
    printf 'sha256:%064d\\n' 4
  else
    printf '%s\\n' "$BARGHSA_APP_IMAGE_ID"
  fi
}}
mode=$1
{loaded}
{verify}
{before_start}
echo stateful-start-admitted
trap 'echo rollback' ERR
if [[ "$mode" == changed-after-start ]]; then printf '%s\\n' 'volume:{DEFAULT_VOLUME}:true' > "$MOUNT_FIXTURE"; fi
{stateful}
echo migrations-admitted
{running}
if [[ "$mode" == changed-before-acceptance ]]; then printf '%s\\n' 'volume:{DEFAULT_VOLUME}:true' > "$MOUNT_FIXTURE"; fi
{final_stateful}
{receipt}
echo accepted
'''
        for mode, expected in (
            ('match', 'accepted'),
            ('bootstrap', 'accepted'),
            ('wrong-bootstrap-image', 'Loaded image ID differs from the candidate manifest: BARGHSA_POSTGRES_IMAGE'),
            ('image:barghsa-app:vps-fixture', 'Loaded image ID differs'),
            ('revision', 'Loaded image revision differs from the candidate commit: BARGHSA_WEB_IMAGE'),
            ('malformed', 'Invalid loaded image ID: BARGHSA_CLAMAV_IMAGE'),
            ('container:postgres', 'Running image ID differs from the candidate manifest: postgres'),
            ('container:postgres-running', 'Running image ID differs from the candidate manifest: postgres'),
            ('container:clamav', 'Running image ID differs from the candidate manifest: clamav'),
            ('container:ai-inference', 'Running image ID differs'),
            ('wrong-volume', 'PostgreSQL data mount differs from the active volume'),
            ('read-only-volume', 'PostgreSQL data mount differs from the active volume'),
            ('changed-after-start', 'PostgreSQL data mount differs from the active volume'),
            ('changed-before-acceptance', 'PostgreSQL data mount differs from the active volume'),
        ):
            with self.subTest(mode=mode):
                with tempfile.TemporaryDirectory(prefix='barghsa-mount-') as directory:
                    mount = Path(directory) / 'mount'
                    mount.write_text(f'volume:{RESTORED_VOLUME}:true\n')
                    result = subprocess.run(['bash', '-c', script, 'image-fixture', mode],
                                            capture_output=True, text=True, check=False,
                                            env={**os.environ, 'MOUNT_FIXTURE': str(mount)})
                self.assertIn(expected, result.stdout + result.stderr)
                self.assertEqual(result.returncode, 0 if mode in ('match', 'bootstrap') else 1)
                self.assertEqual('rollback' in result.stdout, mode in
                                 ('container:postgres-running', 'container:clamav', 'container:ai-inference',
                                  'changed-after-start', 'changed-before-acceptance'))
                if mode in ('container:postgres', 'wrong-volume', 'read-only-volume'):
                    self.assertNotIn('stateful-start-admitted', result.stdout)
                self.assertEqual('migrations-admitted' in result.stdout,
                                 mode in ('match', 'bootstrap', 'container:ai-inference', 'changed-before-acceptance'))
                self.assertEqual('BARGHSA_STAGING_RUNTIME_IMAGES_V1 ' + 'a' * 40 in result.stdout,
                                 mode in ('match', 'bootstrap'))


if __name__ == "__main__":
    unittest.main()
