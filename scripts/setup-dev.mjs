import { spawnSync } from 'node:child_process';
import { chmodSync, constants, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const loopback = new Set(['localhost', '127.0.0.1', '[::1]']);
const inheritedEnv = { ...process.env };

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.error?.code ?? result.signal ?? result.status})`);
  }
  return result.stdout;
}

function localDatabase(value, setting) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Set ${setting} to a local PostgreSQL URL.`);
  }
  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !loopback.has(url.hostname) ||
    !url.username ||
    !url.pathname ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Use a loopback PostgreSQL URL without connection options for ${setting}.`);
  }
  return url;
}

function loadEnvironment() {
  if (!process.loadEnvFile) throw new Error('Use Node.js 20.12 or later to load the local .env.');
  if (process.env.NODE_ENV !== undefined && process.env.NODE_ENV !== 'development') {
    throw new Error('This command requires NODE_ENV=development.');
  }
  const defaultFile = resolve(root, '.env');
  const file = resolve(root, process.env.BARGHSA_ENV_FILE || '.env');
  if (file === defaultFile && !existsSync(file)) {
    try {
      copyFileSync(resolve(root, '.env.example'), file, constants.COPYFILE_EXCL);
      chmodSync(file, 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  process.loadEnvFile(file);
  if (process.env.NODE_ENV !== 'development') {
    throw new Error('This command requires NODE_ENV=development.');
  }
  return file;
}

function setup(file) {
  const settings = ['DATABASE_URL'];
  if (process.env.PGDIRECT_URL !== undefined) settings.push('PGDIRECT_URL');
  for (const setting of settings) {
    const url = localDatabase(process.env[setting], setting);
    if (url.pathname !== '/barghsa' || (url.port && url.port !== '5432')) {
      throw new Error(`Point ${setting} at the local Compose database barghsa on port 5432.`);
    }
  }

  const localSocket = /^(unix|npipe):\/\//;
  const socket =
    (!process.env.DOCKER_CONTEXT && process.env.DOCKER_HOST) ||
    run('docker', ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], {
      stdio: ['ignore', 'pipe', 'inherit'],
      encoding: 'utf8',
    }).trim();
  if (!localSocket.test(socket)) throw new Error('Select a local Docker context for setup:dev.');

  const compose = ['compose', '--env-file', file, '-f', 'docker-compose.yml'];
  run('docker', [
    ...compose,
    'up',
    '--wait',
    '--wait-timeout',
    '120',
    'postgres',
    'redis',
    'minio',
  ]);
  run('docker', [...compose, 'run', '--rm', '--no-deps', 'minio-init']);
  run('pnpm', ['install', '--frozen-lockfile'], { env: inheritedEnv });
  run('pnpm', ['dev:prepare']);
  console.log('Local database and storage are ready. Run pnpm dev to start the app.');
  console.log(`Web http://localhost:${process.env.WEB_PORT || '3000'}`);
  console.log(`API http://localhost:${process.env.PORT || '4000'}/api`);
}

try {
  if (process.argv.length !== 2) throw new Error('Run pnpm setup:dev without arguments.');
  setup(loadEnvironment());
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
