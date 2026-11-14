import json
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import unittest

RELEASE = Path(__file__).with_name("release.sh")
DEPLOY = RELEASE.with_name("deploy.sh")
STAGING_COMPOSE = RELEASE.with_name("compose.yml")
INSTALL_NGINX = RELEASE.with_name("install-nginx.sh")
DEFAULT_VOLUME = "barghsa-staging_pgdata"
RESTORED_VOLUME = "barghsa-staging_pgdata-restore-1"


class ReleaseRollbackTests(unittest.TestCase):
    app_id = f"sha256:{'a' * 64}"
    web_id = f"sha256:{'b' * 64}"

    def test_nginx_install_restores_all_files_on_validation_or_reload_failure(self):
        for failure in ('none', 'validate', 'reload', 'recovery'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                stage = root / 'barghsa-staging-nginx.Abc123xy'
                stage.mkdir()
                nginx = root / 'nginx'
                (nginx / 'snippets').mkdir(parents=True)
                (nginx / 'conf.d').mkdir()
                previous_site = nginx / 'conf.d/barghsa-staging.conf'
                previous_site.write_text('previous site')
                previous_site.chmod(0o640)
                previous_api = nginx / 'snippets/barghsa-api-proxy.conf'
                previous_api.symlink_to('previous-api.conf')
                previous_api.resolve().write_text('previous API')
                previous_s3 = nginx / 'snippets/barghsa-s3-proxy.conf'
                for source in ('nginx.conf', 'nginx-api-proxy.conf', 'nginx-s3-proxy.conf'):
                    (stage / source).write_text('candidate ' + source)

                # Use fixture-owned paths and substitute the Ubuntu rename and lock commands.
                installer = INSTALL_NGINX.read_text().replace('^/tmp/', f'^{root}/').replace(
                    '/etc/nginx/', f'{nginx}/',
                ).replace('/run/lock/', f'{root}/')
                script = '''
flock() { [[ $* == '-n 9' ]]; }
mv() { [[ $1 == -fT && $2 == -- ]] && command mv -f -- "$3" "$4"; }
nginx() {
  local state=previous
  [[ $1 == -t ]]
  if grep -q '^candidate' "$SITE"; then state=candidate; fi
  echo "validate $state"
  [[ $FAILURE != validate || $state != candidate ]]
}
systemctl() {
  local state=previous
  [[ $* == 'reload nginx' ]]
  if grep -q '^candidate' "$SITE"; then state=candidate; fi
  echo "reload $state"
  [[ $FAILURE != recovery && ( $FAILURE != reload || $state != candidate ) ]]
}
'''
                # Keep Bash's production option handling and traps in the exercised script.
                installer = installer.replace('umask 077\n', 'umask 077\n' + script, 1)
                result = subprocess.run(
                    ['bash', '-s', '--', str(stage)], input=installer,
                    env={**os.environ, 'FAILURE': failure, 'SITE': str(previous_site)},
                    capture_output=True, text=True, timeout=10, check=False,
                )
                self.assertEqual(result.returncode, int(failure != 'none'), result.stderr)
                self.assertEqual(result.stdout.splitlines(), {
                    'none': ['validate candidate', 'reload candidate'],
                    'validate': ['validate candidate'],
                    'reload': ['validate candidate', 'reload candidate', 'validate previous', 'reload previous'],
                    'recovery': ['validate candidate', 'reload candidate', 'validate previous', 'reload previous'],
                }[failure])
                if failure == 'none':
                    self.assertEqual(previous_api.read_text(), 'candidate nginx-api-proxy.conf')
                    self.assertFalse(previous_api.is_symlink())
                    self.assertEqual(previous_s3.read_text(), 'candidate nginx-s3-proxy.conf')
                    self.assertEqual(previous_site.read_text(), 'candidate nginx.conf')
                    self.assertEqual(previous_site.stat().st_mode & 0o777, 0o644)
                else:
                    self.assertEqual(previous_api.readlink(), Path('previous-api.conf'))
                    self.assertFalse(previous_s3.exists())
                    self.assertEqual(previous_site.read_text(), 'previous site')
                    self.assertEqual(previous_site.stat().st_mode & 0o777, 0o640)
                if failure == 'recovery':
                    self.assertIn(f'Previous files retained in {stage}/original', result.stderr)
                    self.assertEqual((stage / 'original/barghsa-staging.conf').read_text(), 'previous site')
                else:
                    self.assertFalse(stage.exists())

    def test_official_milestone_refuses_disposable_or_non_archiving_runtime(self):
        text = RELEASE.read_text()
        check = text[text.index('check_backup_config() {'):text.index('\nif [[ "${1:-}" !=')]
        script = f'''set -euo pipefail
backup_env=/dev/null
backup_key=/dev/null
wal_archive_env=/dev/null
{check}
check_backup_config "$1"
echo backup-settings-admitted
'''
        for flag, disposable, wal, expected_error in (
            ('--require-protected-backup', 'true', 'true', 'encrypted WAL archiving'),
            ('--require-protected-backup', 'true', 'false', 'encrypted WAL archiving'),
            ('--require-protected-backup', 'false', 'false', 'encrypted WAL archiving'),
            ('--require-protected-backup', 'false', '', 'encrypted WAL archiving'),
            ('', 'true', 'false', ''),
        ):
            with self.subTest(flag=flag, disposable=disposable, wal=wal):
                result = subprocess.run(
                    ['bash', '-c', script, 'backup-fixture', flag],
                    env={**os.environ, 'BARGHSA_DISPOSABLE': disposable, 'BARGHSA_STAGING_WAL_ARCHIVE': wal},
                    capture_output=True, text=True, check=False,
                )
                self.assertEqual(result.returncode, 1 if expected_error else 0)
                self.assertEqual(result.stdout.strip(), '' if expected_error else 'backup-settings-admitted')
                if expected_error:
                    self.assertIn(expected_error, result.stderr)

    def test_read_only_preflight_requires_all_protected_backup_files(self):
        with tempfile.TemporaryDirectory(prefix='barghsa-backup-preflight-') as directory:
            root = Path(directory)
            config = root / 'config'
            config.mkdir()
            marker = root / 'lock'
            script = RELEASE.read_text().replace('/etc/barghsa/staging', str(config))
            script = script.replace('$(id -u)', '0').replace('/run/lock/barghsa-staging-release.lock', str(marker))
            runtime = config / 'runtime.env'
            runtime.write_text('BARGHSA_DISPOSABLE=false\nBARGHSA_STAGING_WAL_ARCHIVE=true\n')
            names = ('backup.env', 'backup-key', 'wal-archive.env')
            for missing in (*names, None):
                with self.subTest(missing=missing):
                    for name in names:
                        (config / name).write_text('' if name == missing else 'fixture')
                    result = subprocess.run(
                        ['bash', '-s', '--', '--check-protected-backup'],
                        input=script, capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(result.returncode, int(missing is not None), result.stderr)
                    self.assertEqual(result.stdout, '')
                    self.assertFalse(marker.exists())
                    if missing == 'wal-archive.env':
                        self.assertIn('protected archiver configuration', result.stderr)
                    elif missing:
                        self.assertIn('protected off-server backup configuration and key', result.stderr)

    def test_release_requires_protected_backup_from_candidate_version(self):
        with tempfile.TemporaryDirectory(prefix='barghsa-version-backup-') as directory:
            root = Path(directory)
            runtime = root / 'runtime.env'
            candidate = root / 'candidate.env'
            commit = 'a' * 40
            script = RELEASE.read_text().replace('/etc/barghsa/staging', str(root))
            script = script.replace('$(id -u)', '0').replace('/run/lock/barghsa-staging-release.lock', str(root / 'lock'))
            script = script.replace('umask 077\n', 'umask 077\nflock() { [[ $* == "-n 9" ]]; }\n'
                                    'docker() { echo unexpected-docker >&2; return 99; }\n', 1)
            protected = 'requires non-disposable storage and encrypted WAL archiving'
            missing_db = 'Missing runtime value: POSTGRES_DB'
            for version, revision, flag, archive, runtime_metadata, diagnostic in (
                ('0.6.0', commit, '', False, '', protected),
                ('0.9.0', commit, '', False, '', protected),
                ('1.0.0', commit, '', False, '', protected),
                ('0.6.0', commit, '', True, '', missing_db),
                ('0.5.1', commit, '--require-protected-backup', False, '', protected),
                ('0.5.1', commit, '', False, '', missing_db),
                ('0.06.0', commit, '', False, '', 'Invalid release version'),
                ('', commit, '', False, 'BARGHSA_STAGING_RELEASE_VERSION=0.5.1\n', 'Invalid release version'),
                ('0.6.0', '', '', False, f'BARGHSA_STAGING_RELEASE_COMMIT={commit}\n', 'Invalid release commit'),
            ):
                with self.subTest(version=version, revision=revision, flag=flag, archive=archive):
                    disposable = 'false' if archive else 'true'
                    wal = 'true' if archive else 'false'
                    runtime.write_text(f'BARGHSA_DISPOSABLE={disposable}\nBARGHSA_STAGING_WAL_ARCHIVE={wal}\n'
                                       + runtime_metadata)
                    for name in ('backup.env', 'backup-key', 'wal-archive.env'):
                        (root / name).write_text('fixture' if archive else '')
                    candidate.write_text(
                        (f'BARGHSA_STAGING_RELEASE_VERSION={version}\n' if version else '')
                        + (f'BARGHSA_STAGING_RELEASE_COMMIT={revision}\n' if revision else '')
                    )
                    arguments = ['bash', '-s', '--', str(candidate)]
                    if flag:
                        arguments.append(flag)
                    env = {key: value for key, value in os.environ.items() if key != 'POSTGRES_DB'}
                    result = subprocess.run(arguments, input=script, env=env, capture_output=True,
                                            text=True, timeout=10, check=False)
                    self.assertEqual(result.returncode, 1, result.stderr)
                    self.assertIn(diagnostic, result.stderr)
                    self.assertNotIn('unexpected-docker', result.stderr)

    def run_rollback(self, simulate_failure=False, schema_ready=True, postgres_ready=True,
                     identities=True, available=True, running_mismatch="", signal=None,
                     migration_in_progress=False):
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
            traps = text[text.index('\ntrap rollback ERR'):text.index('\n# These images are pinned')]
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
                'dc=(docker compose --env-file "$runtime" --env-file "$active" "${compose_files[@]}")\n'
                f'migration_in_progress={str(migration_in_progress).lower()}\n'
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
                f'{traps}\n'
                + (f'kill -{signal} "$$"\n' if signal else "bash -c 'exit 17'\n")
                + 'echo unreachable\n'
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

    def test_interrupt_restores_verified_previous_images_or_stops_on_schema_mismatch(self):
        for signal, status in (('TERM', 143), ('HUP', 129), ('INT', 130)):
            with self.subTest(signal=signal):
                result = self.run_rollback(signal=signal)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertEqual(json.loads(result.stdout)['services']['api']['image'], self.app_id)
                self.assertIn('verify web', result.stderr)
        result = self.run_rollback(signal='TERM', schema_ready=False)
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertIn('apps-stopped', result.stderr)
        self.assertNotIn('apps-started', result.stderr)
        result = self.run_rollback(signal='TERM', migration_in_progress=True)
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertIn('verify that the migrator has stopped', result.stderr)
        self.assertIn('apps-stopped', result.stderr)
        self.assertNotIn('schema-check', result.stderr)
        self.assertNotIn('apps-started', result.stderr)
        result = self.run_rollback(migration_in_progress=True)
        self.assertEqual(result.returncode, 17, result.stderr)
        self.assertIn('verify that the migrator has stopped', result.stderr)
        self.assertIn('apps-stopped', result.stderr)
        self.assertNotIn('schema-check', result.stderr)

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

    def staging_compose_config(self, fixture, *, volume='', archive=False):
        # Some Compose versions load env_file even with --no-env-resolution.
        # Use test-owned files and keep the live templates and host untouched.
        env = {**os.environ, **dict.fromkeys((
            'BARGHSA_APP_IMAGE', 'BARGHSA_WEB_IMAGE', 'BARGHSA_POSTGRES_IMAGE', 'BARGHSA_CLAMAV_IMAGE',
            'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
            'S3_BUCKET',
        ), 'fixture'), 'BARGHSA_POSTGRES_VOLUME': volume}
        runtime_env = fixture / 'runtime.env'
        runtime_env.touch()
        base = fixture / STAGING_COMPOSE.name
        base.write_text(STAGING_COMPOSE.read_text().replace('/etc/barghsa/staging/runtime.env', str(runtime_env)))
        command = ['docker', 'compose', '--env-file', '/dev/null', '--project-directory',
                   str(STAGING_COMPOSE.parent), '-f', str(base)]
        if archive:
            overlay = STAGING_COMPOSE.with_name('compose.wal-archive.yml')
            backup_env = fixture / 'wal-archive.env'
            backup_env.write_text('BACKUP_CLUSTER_ID=fixture\n')
            local_overlay = fixture / overlay.name
            local_overlay.write_text(overlay.read_text().replace('/etc/barghsa/staging/wal-archive.env', str(backup_env)))
            command.extend(['-f', str(local_overlay)])
        result = subprocess.run([*command, 'config', '--no-env-resolution', '--format', 'json'],
                                capture_output=True, text=True, check=False, env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_compose_mounts_the_default_or_recorded_volume(self):
        for selected in ('', RESTORED_VOLUME):
            with self.subTest(selected=selected), tempfile.TemporaryDirectory(prefix='barghsa-compose-') as directory:
                config = self.staging_compose_config(Path(directory), volume=selected)
                self.assertEqual(config['volumes']['pgdata']['name'], selected or DEFAULT_VOLUME)
                self.assertIn({'type': 'volume', 'source': 'pgdata', 'target': '/var/lib/postgresql/data', 'volume': {}},
                              config['services']['postgres']['volumes'])

    def test_wal_overlay_only_changes_postgres_and_mounts_the_existing_private_key(self):
        with tempfile.TemporaryDirectory(prefix='barghsa-compose-') as directory:
            baseline = self.staging_compose_config(Path(directory))
            enabled = self.staging_compose_config(Path(directory), archive=True)
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

    def test_wal_and_migration_backup_must_use_the_same_recovery_configuration(self):
        text = RELEASE.read_text()
        start = text.index('if [[ "${BARGHSA_DISPOSABLE:-false}" != true ]]; then\n  backup_options=(')
        end = text.index('\n# Host NGINX', start)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archiver_key = root / 'archiver-key'
            backup_key = root / 'backup-key'
            archiver_key.write_text('fixture-archiver-key\n')
            backup_key.write_text('fixture-other-key\n')
            script = '''set -euo pipefail
mode=$1
BARGHSA_STAGING_WAL_ARCHIVE=true
BARGHSA_DISPOSABLE=false
dc=(compose)
POSTGRES_USER=fixture
POSTGRES_DB=fixture
backup_env=/fixture/secrets/backup.env
backup_key=/fixture/secrets/backup-key
postgres_id=sha256:fixture
export BACKUP_S3_ENDPOINT=https://backup.fixture.invalid
export BACKUP_CLUSTER_ID=staging
export BACKUP_S3_ACCESS_KEY=fixture-archiver-credential
unset BACKUP_S3_BUCKET BACKUP_S3_REGION
compose() {
  [[ $1 == exec && $2 == -T && $3 == --user && $4 == postgres && $5 == postgres ]] || return 22
  if [[ $6 == psql ]]; then
    printf 'on\\n/opt/backup/archive-wal.sh %%f %%p\\n'
    return
  fi
  [[ $6 == python3 && $7 == -c ]] || return 23
  BACKUP_GPG_PASSPHRASE_FILE="$ARCHIVER_KEY" "${@:6}"
}
docker() {
  [[ "$*" == 'run --rm --user postgres --network none --env-file /fixture/secrets/backup.env '* &&
     "$*" == *'dst=/run/secrets/backup-key,readonly --entrypoint python3 sha256:fixture -c '* ]] || return 24
  export BACKUP_S3_ACCESS_KEY=fixture-distinct-backup-credential
  export BACKUP_S3_BUCKET=barghsa-backups BACKUP_S3_REGION=us-east-1
  export BACKUP_GPG_PASSPHRASE_FILE="$ARCHIVER_KEY"
  case "$mode" in
    endpoint) export BACKUP_S3_ENDPOINT=https://other.fixture.invalid ;;
    http) export BACKUP_S3_ENDPOINT=http://backup.fixture.invalid ;;
    bucket) export BACKUP_S3_BUCKET=other-bucket ;;
    region) export BACKUP_S3_REGION=other-region ;;
    cluster) export BACKUP_CLUSTER_ID=other-staging ;;
    key) export BACKUP_GPG_PASSPHRASE_FILE="$BACKUP_KEY" ;;
    missing) unset BACKUP_CLUSTER_ID ;;
    unreadable) export BACKUP_GPG_PASSPHRASE_FILE="$BACKUP_KEY.missing" ;;
  esac
  python3 "${@: -2}"
}
trap 'echo rollback; exit 40' ERR
''' + text[start:end] + '\necho writes-still-available\n'
            for mode in ('matching', 'endpoint', 'http', 'bucket', 'region', 'cluster', 'key', 'missing', 'unreadable'):
                with self.subTest(mode=mode):
                    result = subprocess.run(
                        ['bash', '-c', script, 'wal-fixture', mode], timeout=10,
                        env={**os.environ, 'ARCHIVER_KEY': str(archiver_key), 'BACKUP_KEY': str(backup_key)},
                        capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(result.returncode, int(mode != 'matching'), result.stderr)
                    self.assertEqual(result.stdout, 'writes-still-available\n' if mode == 'matching' else '')
                    if mode != 'matching':
                        self.assertIn('WAL and migration backup recovery configuration differs or cannot be read', result.stderr)
                    self.assertNotIn('fixture-', result.stdout + result.stderr)

    def test_migrations_wait_for_a_successful_writer_stop(self):
        text = RELEASE.read_text()
        start = text.index('# Quiesce the previous API and worker')
        end = text.index('\n"${dc[@]}" up -d --no-deps --wait --wait-timeout 240 ai-inference', start)
        options_start = text.index('if [[ "${BARGHSA_DISPOSABLE:-false}" != true ]]; then\n  backup_options=(')
        backup_options = text[options_start:text.index('\nif [[ "${BARGHSA_STAGING_WAL_ARCHIVE', options_start)]
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
{backup_options}
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
  local blob="blobs/{'d' * 32}.tar.gpg"
  if [[ "$mode" == invalid-backup-object ]]; then blob=invalid; fi
  local manifest_result=',"manifest_readback_verified":true'
  if [[ "$mode" == missing-manifest-readback ]]; then manifest_result=''; fi
  local started='2026-11-13T23:00:00+00:00' completed='2026-11-13T23:00:30+00:00'
  local wal='[{{"Timeline":1,"Start-LSN":"0/5000028","End-LSN":"0/5000100"}}]' tablespaces='[]'
  if [[ "$mode" == reversed-timing ]]; then started='2026-11-13T23:01:00+00:00'; fi
  if [[ "$mode" == missing-wal ]]; then wal='[]'; fi
  if [[ "$mode" == invalid-tablespaces ]]; then tablespaces='{{}}'; fi
  printf '{{"version":1,"label":"%s","system_id":"%s","blob":"%s","sha256":"{'c' * 64}","size":42000,"upload_verified":true%s,"started_at":"%s","completed_at":"%s","wal_ranges":%s,"tablespaces":%s}}\\n' "${{@: -1}}" "$system" "$blob" "$manifest_result" "$started" "$completed" "$wal" "$tablespaces"
}}
trap 'status=$?; echo rollback; exit "$status"' ERR
{text[start:end]}
'''
        for mode, expected, code in (
            ('disposable', ['stop worker api ai-inference', 'disposable backup', 'run --rm --no-deps api node run-packaged-migrations.cjs'], 0),
            ('stop-failed', ['stop worker api ai-inference', 'rollback'], 19),
            ('backup-failed', ['stop worker api ai-inference', 'rollback'], 23),
            ('wrong-database', ['stop worker api ai-inference', 'rollback'], 1),
            ('prior-backup-image', ['stop worker api ai-inference', 'rollback'], 1),
            ('invalid-backup-object', ['stop worker api ai-inference', 'rollback'], 1),
            ('missing-manifest-readback', ['stop worker api ai-inference', 'rollback'], 1),
            ('reversed-timing', ['stop worker api ai-inference', 'rollback'], 1),
            ('missing-wal', ['stop worker api ai-inference', 'rollback'], 1),
            ('invalid-tablespaces', ['stop worker api ai-inference', 'rollback'], 1),
            ('protected', ['stop worker api ai-inference', 'verified backup', 'run --rm --no-deps api node run-packaged-migrations.cjs'], 0),
        ):
            with self.subTest(mode=mode):
                result = subprocess.run(['bash', '-c', script, 'migration-fixture', mode],
                                        capture_output=True, text=True, check=False)
                self.assertEqual(result.returncode, code, result.stderr)
                observed = result.stdout.splitlines()
                if mode in ('disposable', 'protected'):
                    marker, receipt = observed[1].split(' ', 1)
                    self.assertEqual(marker, 'BARGHSA_STAGING_MIGRATION_BACKUP_V1')
                if mode == 'disposable':
                    self.assertEqual(json.loads(receipt), {'disposable': True})
                    observed[1] = 'disposable backup'
                if mode == 'protected':
                    self.assertEqual(json.loads(receipt)['system_id'], '123456')
                    self.assertIs(json.loads(receipt)['upload_verified'], True)
                    self.assertIs(json.loads(receipt)['manifest_readback_verified'], True)
                    observed[1] = 'verified backup'
                self.assertEqual(observed, expected)

    def test_active_manifest_switch_preserves_the_previous_bytes_on_install_failure(self):
        text = RELEASE.read_text()
        start = text.rindex('\nverify_running_image clamav "$clamav_id"\n')
        switch = text[text.index('\n', start + 1):text.index("\nprintf 'Staging release healthy:", start)]
        rollback = text[text.index('rollback() {'):text.index('\n# Check an existing container')]
        traps = text[text.index('\ntrap rollback ERR'):text.index('\n# These images are pinned')]
        script = r'''set -euo pipefail
active=$1
candidate=$2
install() {
  if [[ "$MANIFEST_FAILURE" == install ]]; then
    printf 'PARTIAL' > "${@: -1}"
    return 1
  fi
  command install "$@"
  if [[ "$MANIFEST_FAILURE" == before-rename ]]; then kill -TERM "$$"; fi
}
mv() {
  [[ $1 == -fT && $2 == -- ]]
  [[ "$MANIFEST_FAILURE" != rename ]] || return 1
  command mv -f -- "$3" "$4"
  if [[ "$MANIFEST_FAILURE" == after-rename ]]; then kill -TERM "$$"; fi
}
docker() { echo 'restore previous' >&2; return 1; }
stat() {
  [[ $1 == -c && $2 == '%i' && $3 == -- ]]
  if [[ $(uname -s) == Darwin ]]; then command stat -f '%i' "$4"
  else command stat "$@"; fi
}
dc=(docker)
runtime=fixture
compose_files=(-f fixture)
postgres_id=fixture
verify_running_image() { return 1; }
''' + rollback + traps + switch + '\necho accepted\n'
        for failure in ('none', 'install', 'rename', 'before-rename', 'after-rename'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                active = root / 'active.env'
                candidate = root / 'candidate.env'
                active.write_text('PREVIOUS=verified\n')
                active.chmod(0o600)
                candidate.write_text('CANDIDATE=verified\n')
                result = subprocess.run(
                    ['bash', '-c', script, 'fixture', str(active), str(candidate)],
                    env={**os.environ, 'MANIFEST_FAILURE': failure},
                    capture_output=True, text=True, timeout=10,
                )
                late = failure == 'after-rename'
                self.assertEqual(result.returncode, 143 if failure.endswith('-rename') else int(failure != 'none'), result.stderr)
                promoted = failure == 'none' or late
                expected = 'CANDIDATE=verified\n' if promoted else 'PREVIOUS=verified\n'
                self.assertEqual(active.read_text(), expected)
                self.assertEqual(active.stat().st_mode & 0o777, 0o600)
                self.assertEqual(sorted(p.name for p in root.iterdir()),
                                 ['active.env', 'candidate.env'])
                self.assertEqual(result.stdout, 'accepted\n' if failure == 'none' else '')
                self.assertEqual('restore previous' in result.stderr, not promoted)
                self.assertEqual('interrupted after the active manifest was published' in result.stderr, late)

    def test_public_smoke_checks_candidate_revision_before_promotion(self):
        text = RELEASE.read_text()
        smoke = text[text.index('verify_public_json() {'):
                     text.index('\n[[ $(curl --silent', text.index('verify_public_json() {'))]
        script = f'''set -euo pipefail
APP_PUBLIC_URL=https://staging.example.test
commit=$1
version=0.6.0
curl() {{
  case "$*" in
    *"--dump-header -"*"$APP_PUBLIC_URL/api/health/ready") printf '%s' "$API_HEADERS" ;;
    *"--dump-header -"*"$APP_PUBLIC_URL/") printf '%s' "$WEB_HEADERS" ;;
    *"$APP_PUBLIC_URL/api/health/live") printf '%s%s' "$LIVE_JSON_HEADERS" "$LIVE" ;;
    *"$APP_PUBLIC_URL/api/health/ready") printf '%s%s' "$READY_JSON_HEADERS" "$READY" ;;
    *"$APP_PUBLIC_URL/release.json?commit=$commit") printf '%s%s' "$WEB_JSON_HEADERS" "$WEB" ;;
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
        metadata = {'commit': commit, 'version': '0.6.0'}
        content_type_header = 'X-Content-Type-Options: nosniff\r\n'
        permissions_header = 'Permissions-Policy: camera=(), microphone=(), geolocation=()\r\n'
        headers = ('HTTP/1.1 200 OK\r\n' + content_type_header
                   + 'Referrer-Policy: strict-origin-when-cross-origin\r\n'
                   + 'X-Frame-Options: DENY\r\n' + permissions_header + '\r\n')
        json_headers = 'HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\n\r\n'
        for name, api, web, expected in (
            ('matching', ready, metadata, None),
            ('exact-json-limit', ready, metadata, None),
            ('oversized-json', ready, metadata, 'Invalid staging ready'),
            ('redirect-live-json', ready, metadata, 'Invalid staging live'),
            ('partial-ready-json', ready, metadata, 'Invalid staging ready'),
            ('redirect-web-json', ready, metadata, 'Staging web release does not match'),
            ('wrong-web-content-type', ready, metadata, 'Staging web release does not match'),
            ('degraded', {**ready, 'status': 'degraded',
                          'checks': {**checks, 'objectStorage': {'status': 'degraded'}}},
             metadata, 'Invalid staging ready'),
            ('redis-fallback', {**ready, 'warnings': ['redis-unavailable']},
             metadata, 'Invalid staging ready'),
            ('absent-storage', {**ready, 'checks': {key: value for key, value in checks.items()
                                                    if key != 'objectStorage'}},
             metadata, 'Invalid staging ready'),
            ('previous-api', {**ready, 'commit': 'b' * 40}, metadata, 'Invalid staging ready'),
            ('missing-api-revision', {**ready, 'commit': None}, metadata, 'Invalid staging ready'),
            ('invalid-schema', {**ready, 'checks': {'postgresql': {'status': 'down'}}},
             metadata, 'Invalid staging ready'),
            ('previous-web', ready, {**metadata, 'commit': 'b' * 40}, 'Staging web release does not match'),
            ('previous-version', ready, {**metadata, 'version': '0.5.1'}, 'Staging web release does not match'),
            ('missing-version', ready, {'commit': commit}, 'Staging web release does not match'),
            ('invalid-web', ready, [], 'Staging web release does not match'),
            ('duplicate-web-header', ready, metadata, 'Invalid staging edge header X-Content-Type-Options on /'),
            ('missing-api-header', ready, metadata, 'Invalid staging edge header Permissions-Policy on /api/health/ready'),
            ('incorrect-api-header', ready, metadata, 'Invalid staging edge header X-Frame-Options on /api/health/ready'),
            ('unexpected-web-status', ready, metadata, 'Invalid staging edge response on /'),
        ):
            with self.subTest(name=name):
                web_headers = headers
                api_headers = headers
                live_json_headers = ready_json_headers = web_json_headers = json_headers
                ready_json = json.dumps(api)
                if name == 'exact-json-limit':
                    ready_json = ready_json.ljust(65536)
                if name == 'oversized-json':
                    ready_json = ready_json.ljust(65537)
                if name == 'redirect-live-json':
                    live_json_headers = json_headers.replace('200 OK', '302 Found')
                if name == 'partial-ready-json':
                    ready_json_headers = json_headers.replace('200 OK', '206 Partial Content')
                if name == 'redirect-web-json':
                    web_json_headers = json_headers.replace('200 OK', '307 Temporary Redirect')
                if name == 'wrong-web-content-type':
                    web_json_headers = json_headers.replace('application/json', 'text/html')
                if name == 'duplicate-web-header':
                    web_headers = headers.replace(content_type_header, content_type_header * 2)
                if name == 'missing-api-header':
                    api_headers = headers.replace(permissions_header, '')
                if name == 'incorrect-api-header':
                    api_headers = headers.replace('DENY', 'SAMEORIGIN')
                if name == 'unexpected-web-status':
                    web_headers = headers.replace('200 OK', '302 Found')
                result = subprocess.run(['bash', '-c', script, 'public-smoke', commit],
                                        capture_output=True, text=True, env={**os.environ,
                                            'LIVE': '{"status":"ok"}', 'READY': ready_json, 'WEB': json.dumps(web),
                                            'WEB_HEADERS': web_headers, 'API_HEADERS': api_headers,
                                            'LIVE_JSON_HEADERS': live_json_headers,
                                            'READY_JSON_HEADERS': ready_json_headers,
                                            'WEB_JSON_HEADERS': web_json_headers})
                self.assertEqual(result.returncode, bool(expected), result.stderr)
                lines = result.stdout.splitlines()
                if expected:
                    self.assertEqual(lines[-1], 'rollback')
                    self.assertNotIn('promote', lines)
                    self.assertIn(expected, result.stderr)
                else:
                    self.assertEqual(lines, [
                        'Staging edge security headers verified on /',
                        'Staging edge security headers verified on /api/health/ready',
                        'promote',
                    ])

    def test_public_json_network_read_refuses_redirect_and_bounds_body(self):
        text = RELEASE.read_text()
        public_json = text[text.index('verify_public_json() {'):
                           text.index('\nfor health in live ready; do')]
        requests = []

        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def do_GET(self):
                requests.append((self.path, self.headers.get('Cache-Control')))
                path = self.path
                status = 302 if path == '/redirect' else 200
                body = b'{"status":"ok"}'
                if path in ('/limit', '/oversized'):
                    body = body.ljust(65536 if path == '/limit' else 65537)
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Connection', 'close')
                if status == 302:
                    self.send_header('Location', '/redirect-target')
                self.end_headers()
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *_):
                pass

        with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server, \
                tempfile.TemporaryDirectory() as home:
            # A release operator's curl defaults cannot enable redirect following.
            Path(home, '.curlrc').write_text('location\n')
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .05})
            thread.start()
            try:
                script = f'''set -euo pipefail
APP_PUBLIC_URL=http://127.0.0.1:{server.server_port}
commit=
version=
{public_json}
verify_public_json "$1" live || false
'''
                for path, code in (('/limit', 0), ('/oversized', 1), ('/redirect', 1)):
                    with self.subTest(path=path):
                        result = subprocess.run(['bash', '-c', script, 'public-json', path],
                                                capture_output=True, text=True, timeout=10,
                                                env={**os.environ, 'CURL_HOME': home})
                        self.assertEqual(result.returncode, code, result.stderr)
            finally:
                server.shutdown()
                thread.join()
        self.assertEqual(requests, [(path, 'no-cache') for path in ('/limit', '/oversized', '/redirect')])

    def test_image_identity_is_checked_before_start_and_after_rollout(self):
        text = RELEASE.read_text()
        loaded = text[text.index('commit=${BARGHSA_STAGING_RELEASE_COMMIT:-}'):
                      text.index('\nbackup_requirement=')]
        loaded += text[text.index('\nfor key in BARGHSA_APP_IMAGE BARGHSA_WEB_IMAGE'):
                       text.index('\nif [[ -e "$active" ]]')]
        verify = text[text.index("verify_postgres_mount() {"):text.index("\nrollback() {")]
        before_start = text[text.index('# Check an existing container'):text.index('\ntrap rollback ERR')]
        stateful = text[text.index('\nverify_running_image postgres "$postgres_id"\n'):
                        text.index("\n# Host NGINX enters")]
        running = text[text.index("\nfor service in api worker ai-inference web"):
                       text.index("\nfor health in live ready")]
        final_stateful = text[text.rindex('\nverify_running_image postgres "$postgres_id"\n'):
                              text.index('\npending_active=')]
        receipt = text[text.rindex('if [[ -n "$commit" ]]; then'):]
        script = f'''set -euo pipefail
BARGHSA_STAGING_RELEASE_COMMIT={'a' * 40}
BARGHSA_STAGING_RELEASE_VERSION=0.6.0
BARGHSA_APP_IMAGE=barghsa-app:vps-fixture
BARGHSA_WEB_IMAGE=barghsa-web:vps-fixture
BARGHSA_POSTGRES_IMAGE=barghsa-postgres:vps-fixture
BARGHSA_POSTGRES_VOLUME={RESTORED_VOLUME}
BARGHSA_CLAMAV_IMAGE=barghsa-clamav:vps-fixture
BARGHSA_STAGING_WAL_ARCHIVE=false
BARGHSA_DISPOSABLE=true
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
  if [[ $1 == exec && $3 == clamav ]]; then printf '%s\\n' "$SCANNER_REPLY"; return; fi
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
if [[ "$mode" == invalid-version ]]; then BARGHSA_STAGING_RELEASE_VERSION=0.06.0; fi
if [[ "$mode" == missing-version ]]; then unset BARGHSA_STAGING_RELEASE_VERSION; fi
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
            ('invalid-version', 'Invalid release version in the candidate manifest'),
            ('missing-version', 'Invalid release version in the candidate manifest'),
            ('wrong-bootstrap-image', 'Loaded image ID differs from the candidate manifest: BARGHSA_POSTGRES_IMAGE'),
            ('image:barghsa-app:vps-fixture', 'Loaded image ID differs'),
            ('revision', 'Loaded image revision differs from the candidate commit: BARGHSA_WEB_IMAGE'),
            ('malformed', 'Invalid loaded image ID: BARGHSA_CLAMAV_IMAGE'),
            ('container:postgres', 'Running image ID differs from the candidate manifest: postgres'),
            ('container:postgres-running', 'Running image ID differs from the candidate manifest: postgres'),
            ('container:clamav', 'Running image ID differs from the candidate manifest: clamav'),
            ('stale-scanner', 'The staging ClamAV signature build time is invalid or stale'),
            ('invalid-scanner', 'The staging ClamAV signature build time is invalid or stale'),
            ('future-scanner', 'The staging ClamAV signature build time is invalid or stale'),
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
                    now = datetime.now(timezone.utc)
                    built = now + timedelta(hours={'stale-scanner': -49, 'future-scanner': 1}.get(mode, -1))
                    reply = 'ClamAV 1.5.4' if mode == 'invalid-scanner' else f'ClamAV 1.5.4/28182/{built.ctime()}'
                    result = subprocess.run(['bash', '-c', script, 'image-fixture', mode],
                                            capture_output=True, text=True, check=False,
                                            env={**os.environ, 'MOUNT_FIXTURE': str(mount), 'SCANNER_REPLY': reply})
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
