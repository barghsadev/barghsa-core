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
    app_id = f"sha256:{'a' * 64}"
    web_id = f"sha256:{'b' * 64}"

    def run_rollback(self, simulate_failure=False, schema_ready=True, postgres_ready=True,
                     identities=True, available=True, running_mismatch=""):
        with tempfile.TemporaryDirectory(prefix="barghsa-rollback-") as directory:
            root = Path(directory)
            runtime = root / "runtime.env"
            runtime.touch()
            active = root / "active.env"
            active.write_text(
                "BARGHSA_APP_IMAGE=barghsa-app:previous\n"
                "BARGHSA_WEB_IMAGE=barghsa-web:previous\n"
                + (f"BARGHSA_APP_IMAGE_ID={self.app_id}\nBARGHSA_WEB_IMAGE_ID={self.web_id}\n"
                   if identities else "")
            )
            compose = root / "compose.yml"
            compose.write_text(
                'services:\n  api:\n    image: "${BARGHSA_APP_IMAGE:?Set app image}"\n'
                '  web:\n    image: "${BARGHSA_WEB_IMAGE:?Set web image}"\n'
            )
            fake_docker = root / "docker"
            fake_docker.write_text(
                """#!/usr/bin/env bash
set -eu
if [[ $1 == image ]]; then
  [[ $2 == inspect && $3 == --format && $4 == '{{.Id}}' ]]
  [[ $5 == "$PREVIOUS_APP_ID" || $5 == "$PREVIOUS_WEB_ID" ]]
  [[ "$AVAILABLE" == 1 || $5 != "$PREVIOUS_WEB_ID" ]] || exit 1
  printf '%s\\n' "$5"
  exit
fi
args=()
while [[ $# -gt 0 && $1 != up && $1 != run && $1 != stop && $1 != ps ]]; do
  args+=("$1")
  shift
done
if [[ $1 == ps ]]; then
  [[ $2 == -q && $BARGHSA_APP_IMAGE == "$PREVIOUS_APP_ID" && $BARGHSA_WEB_IMAGE == "$PREVIOUS_WEB_ID" ]]
  printf '%s-running\\n' "$3"
  exit
fi
if [[ $1 == run ]]; then
  [[ $2 == --rm && $3 == --no-deps && $4 == api && $5 == node && $6 == -e ]]
  [[ $7 == *'dbHealth({ verifySchema: true })'* ]]
  [[ $BARGHSA_APP_IMAGE == "$PREVIOUS_APP_ID" && $BARGHSA_WEB_IMAGE == "$PREVIOUS_WEB_ID" ]]
  echo schema-check >&2
  [[ "$SCHEMA_READY" == 1 ]]
  exit
fi
if [[ $1 == stop ]]; then
  [[ $* == 'stop worker web api ai-inference' ]]
  echo apps-stopped >&2
  exit
fi
[[ $* == 'up -d --no-deps --wait --wait-timeout 240 api web worker ai-inference' ]]
echo apps-started >&2
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
                "BARGHSA_WEB_IMAGE": "barghsa-web:failed-candidate",
                "PREVIOUS_APP_ID": self.app_id,
                "PREVIOUS_WEB_ID": self.web_id,
                "AVAILABLE": "1" if available else "0",
                "RUNNING_MISMATCH": running_mismatch,
                "SCHEMA_READY": "1" if schema_ready else "0",
                "POSTGRES_READY": "1" if postgres_ready else "0",
                "SIMULATE_FAILURE": "1" if simulate_failure else "0",
            }
            script = (
                'set -euo pipefail\n'
                'runtime=$1\nactive=$2\ncompose=$3\ncompose_files=(-f "$compose")\n'
                '''postgres_id=fixture
verify_running_image() {
  if [[ $1 == postgres ]]; then
    [[ $2 == fixture && "$POSTGRES_READY" == 1 ]]
    return
  fi
  [[ $3 == "$1-running" ]] || return 2
  if [[ $1 == web ]]; then [[ $2 == "$PREVIOUS_WEB_ID" ]] || return 2
  else [[ $2 == "$PREVIOUS_APP_ID" ]] || return 2; fi
  printf 'verify %s\\n' "$1" >&2
  [[ $1 != "$RUNNING_MISMATCH" ]]
}
'''
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
        services = json.loads(result.stdout)["services"]
        self.assertEqual(services["api"]["image"], self.app_id)
        self.assertEqual(services["web"]["image"], self.web_id)
        self.assertEqual(
            [line for line in result.stderr.splitlines() if line.startswith("verify ")],
            ["verify api", "verify worker", "verify ai-inference", "verify web"],
        )
        self.assertNotIn("Restoring the previous staging app images failed", result.stderr)

    def test_unhealthy_rollback_reports_failure_and_preserves_original_status(self):
        result = self.run_rollback(simulate_failure=True)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertIn("Restoring the previous staging app images failed", result.stderr)
        self.assertIn("apps-stopped", result.stderr)

    def test_missing_or_unavailable_image_id_stops_before_schema_check(self):
        for options in ({"identities": False}, {"available": False}):
            with self.subTest(options=options):
                result = self.run_rollback(**options)
                self.assertEqual(result.returncode, 17, result.stderr)
                self.assertIn("Previous staging app or web image ID is missing or unavailable", result.stderr)
                self.assertIn("apps-stopped", result.stderr)
                self.assertNotIn("schema-check", result.stderr)
                self.assertNotIn("apps-started", result.stderr)

    def test_running_image_mismatch_stops_restored_services(self):
        result = self.run_rollback(running_mismatch="ai-inference")
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertIn("verify ai-inference\napps-stopped", result.stderr)
        self.assertIn("Restoring the previous staging app images failed", result.stderr)

    def test_schema_mismatch_stops_application_instead_of_starting_previous_images(self):
        result = self.run_rollback(schema_ready=False)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertIn("apps-stopped", result.stderr)
        self.assertNotIn("apps-started", result.stderr)
        self.assertIn("Previous app could not verify the current database schema", result.stderr)
        self.assertIn("Recover the matching app and database pair, or roll forward", result.stderr)

    def test_postgres_mismatch_stops_application_before_rollback_schema_check(self):
        result = self.run_rollback(postgres_ready=False)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertIn("apps-stopped", result.stderr)
        self.assertNotIn("schema-check", result.stderr)
        self.assertNotIn("apps-started", result.stderr)
        self.assertIn("PostgreSQL image or volume could not be verified for rollback", result.stderr)
        self.assertNotIn("Previous app could not verify", result.stderr)

    def test_manifest_carries_forward_the_remote_volume_and_refuses_failed_read(self):
        text = DEPLOY.read_text()
        selection = text[text.index('postgres_volume='):text.index('  if [[ -n "$bundle_dir" ]]')]
        script = f'''set -euo pipefail
ssh_args=(-o BatchMode=yes)
remote=fixture
retained_scans=
retained_sha=
ssh() {{
  [[ $1 == -o && $2 == BatchMode=yes && $3 == fixture ]] || return 3
  case $4 in
    *POSTGRES_VOLUME*)
      if [[ $READ_STATUS != 0 ]]; then return "$READ_STATUS"; fi
      printf '%s' "$STATEFUL"
      ;;
    'docker image inspect '*)
      printf 'sha256:%064d\\nsha256:%064d\\n' 1 2
      ;;
    *) return 3 ;;
  esac
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

    def test_wal_overlay_only_changes_postgres_and_mounts_the_existing_private_key(self):
        overlay = STAGING_COMPOSE.with_name("compose.wal-archive.yml")
        env = {**os.environ, **dict.fromkeys((
            'BARGHSA_APP_IMAGE', 'BARGHSA_WEB_IMAGE', 'BARGHSA_POSTGRES_IMAGE', 'BARGHSA_CLAMAV_IMAGE',
            'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
            'S3_BUCKET',
        ), 'fixture')}
        command = ['docker', 'compose', '--env-file', '/dev/null', '-f', str(STAGING_COMPOSE)]
        options = ['config', '--no-env-resolution', '--format', 'json']
        baseline = json.loads(subprocess.check_output([*command, *options], env=env))
        with tempfile.TemporaryDirectory() as directory:
            backup_env = Path(directory) / 'wal-archive.env'
            backup_env.write_text('BACKUP_CLUSTER_ID=fixture\n')
            local_overlay = Path(directory) / overlay.name
            local_overlay.write_text(overlay.read_text().replace(
                '/etc/barghsa/staging/wal-archive.env', str(backup_env),
            ))
            enabled = json.loads(subprocess.check_output([*command, '-f', str(local_overlay), *options], env=env))
        postgres = enabled['services'].pop('postgres')
        default_postgres = baseline['services'].pop('postgres')
        self.assertEqual(enabled, baseline)
        self.assertEqual(postgres['command'], [*default_postgres['command'], '-c', 'archive_mode=on'])
        self.assertEqual(postgres['environment']['BACKUP_ALLOW_HTTP'], 'false')
        self.assertEqual(postgres['environment']['BACKUP_GPG_PASSPHRASE_FILE'], '/run/secrets/backup-key')
        self.assertEqual(postgres['environment']['BACKUP_CLUSTER_ID'], 'fixture')
        self.assertEqual(postgres['volumes'][:-1], default_postgres['volumes'])
        key_mount = postgres['volumes'][-1]
        self.assertIs(key_mount.pop('bind').get('create_host_path', False), False)
        self.assertEqual(key_mount, {
            'type': 'bind', 'source': '/etc/barghsa/staging/backup-key',
            'target': '/run/secrets/backup-key', 'read_only': True,
        })

    def test_migrations_wait_for_a_successful_writer_stop(self):
        text = RELEASE.read_text()
        start = text.index('# Quiesce the previous API and worker')
        end = text.index('\n"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 ai-inference', start)
        script = f'''set -euo pipefail
mode=$1
dc=(compose)
commit={'a' * 40}
POSTGRES_USER=fixture
POSTGRES_DB=fixture
backup_env=/fixture/secrets/backup.env
backup_key=/fixture/secrets/backup-key
postgres_id=sha256:{'b' * 64}
BARGHSA_DISPOSABLE=false
if [[ "$mode" == disposable || "$mode" == stop-failed ]]; then BARGHSA_DISPOSABLE=true; fi
compose() {{
  if [[ $1 == exec ]]; then printf '%s\\n' '123456'; return; fi
  printf '%s\\n' "$*"
  if [[ $1 == stop && "$mode" == stop-failed ]]; then return 19; fi
}}
docker() {{
  [[ "$*" == *'--env-file /fixture/secrets/backup.env --env BACKUP_ALLOW_HTTP=false'* &&
     "$*" == *'dst=/run/secrets/backup-key,readonly'* &&
     "$*" == *'--entrypoint /opt/backup/backup-pg.sh sha256:{'b' * 64} --label release-'* ]] || return 21
  if [[ "$mode" == backup-failed ]]; then return 23; fi
  local system=123456
  if [[ "$mode" == wrong-database ]]; then system=456789; fi
  if [[ "$mode" == prior-backup-image ]]; then
    printf '{{"version":1,"label":"%s","system_id":"%s","sha256":"{'c' * 64}"}}\\n' "${{@: -1}}" "$system"
    return
  fi
  printf '{{"version":1,"label":"%s","system_id":"%s","sha256":"{'c' * 64}","upload_verified":true}}\\n' "${{@: -1}}" "$system"
}}
trap 'status=$?; echo rollback; exit "$status"' ERR
{text[start:end]}
'''
        for mode, expected, code in (
            ('disposable', ['stop worker api ai-inference', 'run --rm --no-deps api node run-packaged-migrations.cjs'], 0),
            ('stop-failed', ['stop worker api ai-inference', 'rollback'], 19),
            ('backup-failed', ['stop worker api ai-inference', 'rollback'], 23),
            ('wrong-database', ['stop worker api ai-inference', 'rollback'], 1),
            ('prior-backup-image', ['stop worker api ai-inference', 'rollback'], 1),
            ('protected', ['stop worker api ai-inference', 'verified backup', 'run --rm --no-deps api node run-packaged-migrations.cjs'], 0),
        ):
            with self.subTest(mode=mode):
                result = subprocess.run(['bash', '-c', script, 'migration-fixture', mode],
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, code, result.stderr)
                observed = result.stdout.splitlines()
                if mode == 'protected':
                    marker, receipt = observed[1].split(' ', 1)
                    self.assertEqual(marker, 'BARGHSA_STAGING_MIGRATION_BACKUP_V1')
                    self.assertEqual(json.loads(receipt)['system_id'], '123456')
                    self.assertIs(json.loads(receipt)['upload_verified'], True)
                    observed[1] = 'verified backup'
                self.assertEqual(observed, expected)

    def test_public_smoke_checks_candidate_revision_before_promotion(self):
        text = RELEASE.read_text()
        smoke = text[text.index('for health in live ready; do'):
                     text.index('\n[[ $(curl --silent', text.index('for health in live ready; do'))]
        script = f'''set -euo pipefail
APP_PUBLIC_URL=https://staging.example.test
commit=$1
curl() {{
  case "$*" in
    *"$APP_PUBLIC_URL/api/health/live") printf '%s' "$LIVE" ;;
    *"$APP_PUBLIC_URL/api/health/ready") printf '%s' "$READY" ;;
    *"$APP_PUBLIC_URL/release.json?commit=$commit") printf '%s' "$WEB" ;;
    *"$APP_PUBLIC_URL/") printf 'login' ;;
    *) return 98 ;;
  esac
}}
trap 'echo rollback' ERR
{smoke}
echo promote
'''
        commit = 'a' * 40
        checks = {name: {'status': 'ok'} for name in ('postgresql', 'redis', 'objectStorage')}
        ready = {'status': 'ok', 'checks': checks, 'commit': commit}
        for name, api, web, expected in (
            ('matching', ready, {'commit': commit}, None),
            ('degraded', {**ready, 'status': 'degraded',
                          'checks': {**checks, 'objectStorage': {'status': 'degraded'}}},
             {'commit': commit}, 'Invalid staging ready'),
            ('redis-fallback', {**ready, 'warnings': ['redis-unavailable']},
             {'commit': commit}, 'Invalid staging ready'),
            ('absent-storage', {**ready, 'checks': {key: value for key, value in checks.items()
                                                    if key != 'objectStorage'}},
             {'commit': commit}, 'Invalid staging ready'),
            ('previous-api', {**ready, 'commit': 'b' * 40}, {'commit': commit}, 'Invalid staging ready'),
            ('missing-api-revision', {**ready, 'commit': None}, {'commit': commit}, 'Invalid staging ready'),
            ('invalid-schema', {**ready, 'checks': {'postgresql': {'status': 'down'}}},
             {'commit': commit}, 'Invalid staging ready'),
            ('previous-web', ready, {'commit': 'b' * 40}, 'Staging web release does not match'),
            ('invalid-web', ready, [], 'Staging web release does not match'),
        ):
            with self.subTest(name=name):
                result = subprocess.run(['bash', '-c', script, 'public-smoke', commit],
                                        capture_output=True, text=True, env={**os.environ,
                                            'LIVE': '{"status":"ok"}', 'READY': json.dumps(api), 'WEB': json.dumps(web)})
                self.assertEqual(result.returncode, bool(expected), result.stderr)
                self.assertEqual(result.stdout.strip(), 'rollback' if expected else 'promote')
                if expected:
                    self.assertIn(expected, result.stderr)

    def test_image_identity_is_checked_before_start_and_after_rollout(self):
        text = RELEASE.read_text()
        loaded = text[text.index('commit=${BARGHSA_STAGING_RELEASE_COMMIT:-}'):
                      text.index('\nif [[ -e "$active" ]]')]
        verify = text[text.index("verify_postgres_mount() {"):text.index("\nrollback() {")]
        before_start = text[text.index('# Check an existing container'):text.index('\ntrap rollback ERR')]
        stateful = text[text.index('\nverify_running_image postgres "$postgres_id"\n'):
                        text.index("\n# Host NGINX enters")]
        running = text[text.index("\nfor service in api worker ai-inference web"):
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
BARGHSA_STAGING_WAL_ARCHIVE=false
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
