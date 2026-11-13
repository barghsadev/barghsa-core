#!/usr/bin/env python3
"""Deploy a verified release to an idle pilot slot, then switch its TLS proxy."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import time


PRODUCTION = Path(__file__).resolve().parents[1] / 'production'
SLOTS = {'blue': {'web': 3000, 'api': 4000}, 'green': {'web': 13000, 'api': 14000}}
SERVICES = ('clamav', 'ai-inference', 'api', 'web', 'worker')
IMAGE_ROLES = {'clamav': 'scanner', 'ai-inference': 'app', 'api': 'app', 'web': 'web', 'worker': 'app'}
SCHEMA_MOUNT = '/run/barghsa-pilot-schema'
SCHEMA_JOURNAL = '''
const path = require('node:path');
const db = require.resolve('@barghsa/db');
const directory = path.dirname(db);
const { readMigrationFiles } = require(require.resolve('drizzle-orm/migrator', { paths: [directory] }));
const heads = readMigrationFiles({ migrationsFolder: path.resolve(directory, '../drizzle/production') })
  .map(row => ({ hash: row.hash, created_at: String(row.folderMillis) }));
process.stdout.write(JSON.stringify({ heads, transition: require(db).PILOT_SCHEMA_TRANSITION_VERSION ?? 0 }));
'''


class RolloutError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise RolloutError(message)


def run(args, label, *, env=None, timeout=30):
    try:
        with subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              start_new_session=True) as process:
            try:
                output, _ = process.communicate(timeout=timeout)
            except (subprocess.TimeoutExpired, KeyboardInterrupt):
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                process.wait()
                raise
    except (OSError, subprocess.SubprocessError):
        raise RolloutError(f'{label} failed') from None
    require(process.returncode == 0, f'{label} failed')
    return output


def image_valid(image):
    return re.fullmatch(r'[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}', image['ref']) and re.fullmatch(
        r'sha256:[a-f0-9]{64}', image['id']
    )


def validate(plan):
    previous, candidate = plan['previous'], plan['candidate']
    require(previous['slot'] in SLOTS and candidate['slot'] in SLOTS and
            previous['slot'] != candidate['slot'], 'Select distinct pilot slots')
    require(previous['commit'] != candidate['commit'], 'Select a different release')
    for release in (previous, candidate):
        require(re.fullmatch(r'[a-f0-9]{40}', release['commit']), 'Invalid release commit')
        require(all(image_valid(release['images'][role]) for role in ('app', 'web', 'scanner')),
                'Image references and scan identities must be immutable')
    require(previous['images']['scanner'] == candidate['images']['scanner'],
            'Application rollout requires the same verified scanner image')
    require(re.fullmatch(r'[a-z0-9-]+(?:\.[a-z0-9-]+)+', plan['hostname']), 'Invalid pilot TLS hostname')
    require(type(plan['drain_seconds']) is int and 5 <= plan['drain_seconds'] <= 600,
            'Invalid proxy drain deadline')
    for field in ('proxy_config', 'proxy_pid', 'compose_env', 'runtime', 'migration', 'transition_dir'):
        require(Path(plan[field]).is_absolute(), f'{field} must be an absolute path')


def compose(plan, release, *args, timeout=60):
    ports = SLOTS[release['slot']]
    env = {**os.environ, 'COMPOSE_PROJECT_NAME': f"barghsa-pilot-{release['slot']}",
           'BARGHSA_API_HOST_PORT': str(ports['api']), 'BARGHSA_WEB_HOST_PORT': str(ports['web']),
           'BARGHSA_PILOT_TRANSITION_DIR': str(Path(plan['transition_dir']).resolve())}
    for role, variable in (('app', 'APP'), ('web', 'WEB'), ('scanner', 'CLAMAV')):
        repository, digest = release['images'][role]['ref'].split('@sha256:')
        env[f'BARGHSA_{variable}_REPOSITORY'] = repository
        env[f'BARGHSA_{variable}_DIGEST'] = digest
    return run([sys.executable, str(PRODUCTION / 'compose-with-credentials.py'),
                '--env-file', plan['compose_env'], '--runtime', plan['runtime'],
                '--migration', plan['migration'], '--pilot', *args],
               f"Compose {args[0]} in {release['slot']}", env=env, timeout=timeout)


def containers(release, service=None):
    filters = ['--filter', f"label=com.docker.compose.project=barghsa-pilot-{release['slot']}"]
    if service:
        filters += ['--filter', f'label=com.docker.compose.service={service}']
    return run(['docker', 'ps', '--quiet', *filters], 'Pilot container lookup').decode().split()


def check_images(release, pull=False):
    for role in ('app', 'web', 'scanner'):
        image = release['images'][role]
        if pull:
            run(['docker', 'pull', image['ref']], f'Pull {role} image', timeout=300)
        fields = run(['docker', 'image', 'inspect', '--format',
                      '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}',
                      image['ref']], f'Inspect {role} image').decode().split()
        require(fields and fields[0] == image['id'], f'{role} image differs from its scan receipt')
        if role != 'scanner':
            require(fields[1:] == [release['commit']], f'{role} image source revision differs')


def check_containers(release):
    for service in SERVICES:
        ids = containers(release, service)
        require(len(ids) == 1, f'{service} must have one running container in {release["slot"]}')
        status = run(['docker', 'inspect', '--format', '{{.Image}} {{.State.Health.Status}}',
                      ids[0]], f'Inspect {service} container').decode().split()
        require(status == [release['images'][IMAGE_ROLES[service]]['id'], 'healthy'],
                f'{service} image or health differs in {release["slot"]}')


def fetch_json(base, path, tls_host=None):
    args = ['curl', '--silent', '--show-error', '--fail', '--noproxy', '*', '--max-time', '8',
            '--max-filesize', '65536', '--header', 'Cache-Control: no-cache']
    if tls_host:
        args += ['--resolve', f'{tls_host}:443:127.0.0.1']
    body = json.loads(run([*args, base + path], 'Pilot HTTP readback', timeout=10))
    require(isinstance(body, dict), 'Pilot HTTP readback returned unexpected data')
    return body


def smoke(plan, release, *, through_proxy=False):
    ports = SLOTS[release['slot']]
    host = plan['hostname'] if through_proxy else None
    web = f'https://{host}' if host else f"http://127.0.0.1:{ports['web']}"
    api = f'https://{host}' if host else f"http://127.0.0.1:{ports['api']}"
    metadata = fetch_json(web, '/release.json', host)
    health = fetch_json(api, '/api/health/ready', host)
    require(metadata.get('commit') == release['commit'], 'Pilot HTTP source revision differs')
    require(health.get('commit') == release['commit'], 'Pilot API source revision differs')
    require(health.get('status') == 'ok', 'Pilot API dependencies are not ready')


def routed_config(config, previous, candidate):
    for service in ('web', 'api'):
        old_port, new_port = SLOTS[previous][service], SLOTS[candidate][service]
        pattern = rf'(\bupstream barghsa_{service}\s*\{{\s*server 127\.0\.0\.1:){old_port}(\s+[^;]+;\s*\}})'
        config, count = re.subn(pattern, rf'\g<1>{new_port}\2', config)
        require(count == 1, f'Active proxy does not identify the expected {service} upstream')
    return config


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def install_config(path, config, mode):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, mode='w') as output:
        staged = Path(output.name)
        output.write(config)
        output.flush()
        os.fsync(output.fileno())
    try:
        run(['nginx', '-t', '-c', str(staged)], 'NGINX validation')
        staged.chmod(mode)
        os.replace(staged, path)
        sync_directory(path.parent)
    finally:
        staged.unlink(missing_ok=True)
    run(['nginx', '-s', 'reload', '-c', str(path)], 'NGINX reload')


def preserve_file(backup, content):
    flags = os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(backup, flags, 0o600)
    with os.fdopen(fd, 'r+') as saved:
        metadata = os.fstat(saved.fileno())
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.geteuid() and
                not stat.S_IMODE(metadata.st_mode) & 0o077, 'Invalid protected pilot rollback copy')
        if metadata.st_size:
            require(saved.read() == content, 'Existing pilot rollback copy differs')
        else:
            saved.write(content)
            saved.flush()
            os.fsync(saved.fileno())


def image_schema(release):
    raw = run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
               '--entrypoint', 'node', release['images']['app']['ref'], '-e', SCHEMA_JOURNAL],
              'Read packaged pilot migration history')
    metadata = json.loads(raw)
    heads = metadata['heads']
    require(isinstance(heads, list) and heads and all(
        re.fullmatch(r'[a-f0-9]{64}', head['hash']) and re.fullmatch(r'\d+', head['created_at'])
        for head in heads
    ), 'Invalid packaged pilot migration history')
    return metadata


def prepare_transition(plan, previous, candidate):
    directory = Path(plan['transition_dir'])
    metadata = directory.lstat()
    require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == os.geteuid() and
            not stat.S_IMODE(metadata.st_mode) & 0o022, 'Pilot transition directory must be protected')
    active = directory / 'active.json'
    require(not active.is_symlink(), 'Pilot transition must be a regular file')
    old, new = image_schema(previous), image_schema(candidate)
    require(new['heads'][:len(old['heads'])] == old['heads'], 'Candidate migration history must extend the previous image')
    if new['heads'] == old['heads']:
        require(not active.exists(), 'Resolve the active pilot schema transition before another rollout')
        return None

    require(plan.get('schema_transition_verified') is True,
            'Schema changes require verified cross-version compatibility evidence')
    require(old['transition'] == new['transition'] == 1,
            'Both pilot images must support exact schema transitions')
    ids = containers(previous, 'api')
    require(len(ids) == 1, 'Previous API instance could not be verified')
    format_string = (f'{{{{range .Mounts}}}}{{{{if eq .Destination "{SCHEMA_MOUNT}"}}}}'
                     '{{.Source}} {{.RW}}{{end}}{{end}}\n'
                     '{{range .Config.Env}}{{if eq . '
                     f'"BARGHSA_PILOT_SCHEMA_TRANSITION_FILE={SCHEMA_MOUNT}/active.json"'
                     '}}verified{{end}}{{end}}\n'
                     '{{range .Config.Env}}{{if eq . '
                     f'"BARGHSA_RELEASE_SHA={previous["commit"]}"'
                     '}}verified{{end}}{{end}}')
    mount = run(['docker', 'inspect', '--format', format_string, ids[0]],
                'Verify the active API pilot schema mount').decode().strip()
    require(mount == f'{directory.resolve()} false\nverified\nverified',
            'Previous API must have the exact revision and read-only schema transition mount')
    document = json.dumps({'version': 1, 'previous_commit': previous['commit'],
                           'previous': old['heads'][-1], 'candidate': new['heads'][-1]}) + '\n'
    if active.exists():
        metadata = active.lstat()
        require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.geteuid() and
                not stat.S_IMODE(metadata.st_mode) & 0o022 and active.read_text() == document,
                'Resolve the differing active pilot schema transition before retrying')
    else:
        preserve_file(directory / f".barghsa-pilot-{candidate['commit']}.schema.json", document)
        with tempfile.NamedTemporaryFile(dir=directory, delete=False, mode='w') as output:
            staged = Path(output.name)
            output.write(document)
            output.flush()
            os.fsync(output.fileno())
        try:
            staged.chmod(0o644)
            os.replace(staged, active)
            sync_directory(directory)
        finally:
            staged.unlink(missing_ok=True)
    return active


def workers(pid_path):
    master = int(Path(pid_path).read_text().strip())
    require(master > 1, 'Invalid NGINX master process')
    output = run(['ps', '-e', '-o', 'pid=,ppid=,command='], 'NGINX process lookup')
    workers_now = {}
    for line in output.decode().splitlines():
        pid, parent, command = line.split(None, 2)
        if int(parent) == master and command.startswith('nginx: worker process'):
            workers_now[int(pid)] = command
    require(workers_now, 'No NGINX workers found for the expected master')
    return workers_now


def wait_for_route(plan, release):
    deadline = time.monotonic() + 20
    while True:
        try:
            smoke(plan, release, through_proxy=True)
            return
        except (RolloutError, ValueError) as error:
            if time.monotonic() >= deadline:
                raise RolloutError('Proxy routing readback failed') from error
            time.sleep(1)


def drain(plan, old_workers, serving):
    deadline = time.monotonic() + plan['drain_seconds']
    while True:
        current = workers(plan['proxy_pid'])
        if not old_workers.keys() & current.keys() and not any('shutting down' in cmd for cmd in current.values()):
            return
        require(time.monotonic() < deadline, 'NGINX workers did not drain before the deadline')
        smoke(plan, serving)
        time.sleep(2)


def restore_previous_route(plan, path, previous_config, mode, *, switch_attempted):
    previous = plan['previous']
    if switch_attempted and path.read_text() != previous_config:
        candidate_workers = workers(plan['proxy_pid'])
        install_config(path, previous_config, mode)
        wait_for_route(plan, previous)
        drain(plan, candidate_workers, previous)
    smoke(plan, previous, through_proxy=True)
    compose(plan, plan['candidate'], 'stop', '--timeout', '40', *SERVICES, timeout=240)


def rollout(plan):
    previous, candidate = plan['previous'], plan['candidate']
    path = Path(plan['proxy_config'])
    metadata = path.lstat()
    mode = stat.S_IMODE(metadata.st_mode)
    require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == os.geteuid() and not mode & 0o022,
            'Active NGINX configuration must be a protected operator-owned regular file')
    previous_config = path.read_text()
    require(re.findall(r'^\s*pid\s+([^;\s]+)\s*;', previous_config, re.MULTILINE) == [plan['proxy_pid']],
            'Active NGINX configuration must declare the expected PID file')
    candidate_config = routed_config(previous_config, previous['slot'], candidate['slot'])
    check_images(previous)
    check_containers(previous)
    smoke(plan, previous)
    smoke(plan, previous, through_proxy=True)
    require(not containers(candidate), 'Candidate slot already has running containers')
    check_images(candidate, pull=True)
    transition = prepare_transition(plan, previous, candidate)
    compose(plan, candidate, 'run', '--rm', '--no-deps', 'migrate', timeout=600)
    smoke(plan, previous, through_proxy=True)

    switch_attempted = False
    try:
        compose(plan, candidate, 'up', '--detach', '--no-deps', '--wait', '--wait-timeout',
                '300', *SERVICES, timeout=340)
        check_containers(candidate)
        smoke(plan, candidate)
        previous_workers = workers(plan['proxy_pid'])
        preserve_file(path.with_name(f".barghsa-pilot-{candidate['commit']}.previous"), previous_config)
        switch_attempted = True
        install_config(path, candidate_config, mode)
        wait_for_route(plan, candidate)
        drain(plan, previous_workers, candidate)
        check_containers(candidate)
        smoke(plan, candidate, through_proxy=True)
    except (RolloutError, ValueError, OSError, KeyboardInterrupt) as error:
        try:
            restore_previous_route(plan, path, previous_config, mode, switch_attempted=switch_attempted)
        except (RolloutError, ValueError, OSError, KeyboardInterrupt):
            raise RolloutError('Pilot rollback or cleanup could not be verified; inspect both slots') from error
        raise RolloutError(f'{error}; verified previous pilot route') from error

    try:
        compose(plan, previous, 'stop', '--timeout', '40', *SERVICES, timeout=240)
        require(not containers(previous), 'Previous slot still has running containers')
    except RolloutError as error:
        raise RolloutError(f'Candidate is serving; previous-slot shutdown needs inspection: {error}') from error
    try:
        smoke(plan, candidate, through_proxy=True)
    except (RolloutError, ValueError, OSError, KeyboardInterrupt) as error:
        try:
            check_images(previous)
            compose(plan, previous, 'up', '--detach', '--no-deps', '--wait', '--wait-timeout',
                    '300', *SERVICES, timeout=340)
            check_containers(previous)
            smoke(plan, previous)
            restore_previous_route(plan, path, previous_config, mode, switch_attempted=True)
        except (RolloutError, ValueError, OSError, KeyboardInterrupt):
            raise RolloutError('Post-retirement rollback could not be verified; inspect both slots') from error
        raise RolloutError('Post-retirement smoke failed; verified previous pilot route') from error
    if transition:
        transition.unlink()
        sync_directory(transition.parent)
    print(json.dumps({'event': 'pilot_switched', 'slot': candidate['slot'], 'commit': candidate['commit']}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan', required=True, type=Path)
    options = parser.parse_args()
    try:
        plan = json.loads(options.plan.read_text())
        validate(plan)
        lock = Path(plan['proxy_config']).with_name('.barghsa-pilot-rollout.lock')
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'r+') as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            rollout(plan)
    except (RolloutError, BlockingIOError) as error:
        parser.exit(1, f'Pilot deployment halted: {error}\n')
    except (OSError, TypeError, KeyError, ValueError, AttributeError, KeyboardInterrupt) as error:
        parser.exit(1, f'Pilot deployment halted ({type(error).__name__})\n')


def interrupted(_signum, _frame):
    raise KeyboardInterrupt


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    main()
