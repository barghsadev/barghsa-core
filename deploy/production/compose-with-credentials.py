#!/usr/bin/env python3
"""Resolve encrypted deployment credentials for the production Compose manifest."""

import argparse
import base64
import binascii
from contextlib import ExitStack
import fcntl
import os
from pathlib import Path
import stat
import subprocess
import sys


COMPOSE_FILE = Path(__file__).resolve().with_name('compose.yml')
PILOT_OVERLAY = COMPOSE_FILE.parents[1] / 'pilot' / 'compose.yml'
# CRED_AES256_GCM_BY_HOST in systemd's creds-util.h. Reject keyless envelopes.
HOST_KEY_FORMAT = bytes.fromhex('5a1c6a86df9d4096b1d5a65e0862f19a')


def open_credential(stack, path, role):
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    try:
        source = os.open(path, flags)
        stack.callback(os.close, source)
        metadata = os.fstat(source)
        if (
            not stat.S_ISREG(metadata.st_mode)
            or metadata.st_uid != os.geteuid()
            or stat.S_IMODE(metadata.st_mode) & 0o077
            or metadata.st_size == 0
        ):
            raise OSError
    except OSError:
        raise ValueError(f'{role} credential must be a private, nonempty regular file owned by the operator') from None
    return source, (metadata.st_dev, metadata.st_ino)


def resolve_credential(stack, source, role):
    name = f'barghsa-{role}'
    try:
        prefix = base64.b64decode(os.pread(source, 24, 0), validate=True)
        if not prefix.startswith(HOST_KEY_FORMAT):
            raise ValueError(f'{role} credential must be encrypted with the deployment host key')
        descriptor = os.memfd_create(name, os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING)
        stack.callback(os.close, descriptor)
        os.fchmod(descriptor, 0o600)
        subprocess.run(
            ['systemd-creds', 'decrypt', f'--name={name}', '-', '-'],
            stdin=source, stdout=descriptor, stderr=subprocess.DEVNULL, check=True, timeout=10,
        )
        if os.fstat(descriptor).st_size == 0:
            raise OSError
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SEAL
        fcntl.fcntl(descriptor, fcntl.F_ADD_SEALS, seals)
    except binascii.Error:
        raise ValueError(f'{role} credential must be encrypted with the deployment host key') from None
    except (OSError, subprocess.SubprocessError):
        raise ValueError(f'{role} credential could not be decrypted into protected memory') from None
    return f'/proc/{os.getpid()}/fd/{descriptor}'


def run_compose(options, command):
    if not hasattr(os, 'memfd_create'):
        raise ValueError('encrypted deployment credentials require Linux')
    if not command or command[0].startswith('-'):
        raise ValueError('provide a Docker Compose command')
    if command[0] == 'config' and command != ['config', '--quiet']:
        raise ValueError('use config --quiet to validate without exposing credentials')

    with ExitStack() as stack:
        runtime, runtime_identity = open_credential(stack, options.runtime, 'runtime')
        migration, migration_identity = open_credential(stack, options.migration, 'migration')
        if runtime_identity == migration_identity:
            raise ValueError('runtime and migration require separate credential files')

        environment = os.environ.copy()
        environment['BARGHSA_RUNTIME_ENV_FILE'] = resolve_credential(stack, runtime, 'runtime')
        environment['BARGHSA_MIGRATION_ENV_FILE'] = resolve_credential(stack, migration, 'migration')
        compose = ['docker', 'compose', '--env-file', options.env_file, '-f', str(COMPOSE_FILE)]
        if getattr(options, 'pilot', False):
            compose += ['-f', str(PILOT_OVERLAY)]
        try:
            subprocess.run(
                [*compose, 'config', '--quiet'], env=environment,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
            )
            if command == ['config', '--quiet']:
                return 0
            return subprocess.run([*compose, *command], env=environment).returncode
        except (OSError, subprocess.CalledProcessError):
            raise ValueError('Docker Compose could not validate the deployment configuration') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', required=True, help='Compose image and deployment settings')
    parser.add_argument('--runtime', required=True, help='encrypted barghsa-runtime credential')
    parser.add_argument('--migration', required=True, help='encrypted barghsa-migration credential')
    parser.add_argument('--pilot', action='store_true', help='mount the pilot schema transition directory')
    parser.add_argument('command', nargs=argparse.REMAINDER)
    options = parser.parse_args()
    try:
        return run_compose(options, options.command)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
