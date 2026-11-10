import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const privateError = 'fixture-only private connection details';

it.each([
  {
    entry: 'main',
    before: 'require("node:net").Server.prototype.listen = () => { throw failure; };',
    after: '',
    diagnostic: 'Fatal worker error',
    exitCode: 1,
  },
  {
    entry: 'main',
    before: '',
    after: 'queueMicrotask(() => { throw failure; });',
    diagnostic: 'Uncaught exception',
    exitCode: 1,
  },
  {
    entry: 'main',
    before: '',
    after: `
      process.once('unhandledRejection', () => process.emit('SIGTERM'));
      void Promise.reject(failure);
    `,
    diagnostic: 'Unhandled rejection',
    exitCode: 0,
  },
  {
    entry: 'main',
    before: '',
    after: `
      require('@barghsa/db').getDbPool().end = async () => { throw failure; };
      process.emit('SIGTERM');
    `,
    diagnostic: 'Shutdown error',
    exitCode: 1,
  },
  {
    entry: 'ai-inference/main',
    before: 'require("node:net").Server.prototype.listen = () => { throw failure; };',
    after: '',
    diagnostic: 'AI inference process failed',
    exitCode: 1,
  },
])('logs $diagnostic safely and exits with status $exitCode', (scenario) => {
  const entry = resolve(__dirname, '../dist', `${scenario.entry}.js`);
  const child = spawnSync(
    process.execPath,
    [
      '-e',
      `const failure = new Error(${JSON.stringify(privateError)});
      ${scenario.before}
      require(${JSON.stringify(entry)});
      ${scenario.after}`,
    ],
    {
      cwd: resolve(__dirname, '..'),
      env: {
        ...process.env,
        PGBOUNCER_URL: 'postgresql://127.0.0.1:1/runtime-log-fixture',
        DATABASE_SSL_ENABLED: 'false',
        WORKER_PORT: '0',
        AI_INFERENCE_PORT: '9091',
        AI_INFERENCE_SHARED_SECRET: 'runtime-log-fixture-secret-of-at-least-32-characters',
        AI_INFERENCE_MAX_CONCURRENCY: '1',
        SHUTDOWN_GRACE_PERIOD_MS: '1000',
      },
      encoding: 'utf8',
      timeout: 3000,
    }
  );
  expect(child.error).toBeUndefined();
  expect(child.stderr).toContain(scenario.diagnostic);
  expect(child.status).toBe(scenario.exitCode);
  expect(child.stdout + child.stderr).not.toContain(privateError);
});
