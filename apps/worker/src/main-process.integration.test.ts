import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';

const intervals = [
  'SERVICE_BREACH_SCAN_MS',
  'SERVICE_ESCALATION_SCAN_MS',
  'INVOICE_OVERDUE_SCAN_MS',
  'INVOICE_REMINDER_SCHEDULE_MS',
  'INVOICE_REMINDER_SEND_MS',
  'WALLET_RECONCILIATION_SCAN_MS',
  'ONLINE_TOPUP_EXPIRY_SCAN_MS',
  'INVITATION_EXPIRY_SCAN_MS',
];

/** Own a fresh migrated database and the actual compiled worker process. */
async function startWorker(overrides: Record<string, string> = {}) {
  const database = `test_worker_${randomUUID().replaceAll('-', '')}`;
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const fixtureClientEnds: Promise<void>[] = [];
  let created = false,
    child: ChildProcess | undefined,
    pool: Pool | undefined,
    output = '';
  let exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
  async function stop(signal: NodeJS.Signals = 'SIGTERM') {
    if (!child || !exited) throw new Error('Worker did not start');
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    const timer = setTimeout(() => child?.kill('SIGKILL'), 5000);
    try {
      return await exited;
    } finally {
      clearTimeout(timer);
    }
  }
  async function databaseAvailable(available: boolean) {
    await management.query(
      `ALTER DATABASE "${database}" ALLOW_CONNECTIONS ${available ? 'true' : 'false'}`
    );
    if (!available)
      await management.query(
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND application_name<>'worker-process-fixture'",
        [database]
      );
  }
  async function close() {
    try {
      if (child) await stop();
      await pool?.end();
      // pg-pool resolves end after removing clients from its list, before their
      // sockets necessarily close. Wait before DROP ... FORCE can kill them.
      await Promise.all(fixtureClientEnds);
    } finally {
      try {
        if (created) await management.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      } finally {
        await management.end();
      }
    }
  }
  try {
    await management.query(`CREATE DATABASE "${database}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = `/${database}`;
    const env = {
      ...process.env,
      DATABASE_URL: url.toString(),
      PGDIRECT_URL: url.toString(),
      NODE_ENV: 'test',
      WORKER_PORT: '0',
      WORKER_SYSTEM_ACTOR_USER_ID: 'worker-process-actor',
      SHUTDOWN_GRACE_PERIOD_MS: '3000',
      OUTBOX_POLL_MS: '1000',
      AUTH_DELIVERY_ENCRYPTION_KEY: 'worker-process-test-key',
      PROVIDER_CONFIG_ENCRYPTION_KEY: 'worker-process-test-key',
      STORAGE_CONFIG_ENCRYPTION_KEY: 'worker-process-test-key',
      AI_MODEL_ENCRYPTION_KEY: 'worker-process-test-key',
      REDIS_URL: '',
      REDIS_HOST: '',
      S3_BUCKET: '',
      S3_REGION: '',
      S3_ENDPOINT: '',
      S3_PRIVATE_ENDPOINT: '',
      S3_PUBLIC_ENDPOINT: '',
      ...Object.fromEntries(intervals.map((key) => [key, '1000'])),
      ...overrides,
    };
    execFileSync(process.execPath, [resolve(__dirname, '../../../packages/db/dist/migrate.js')], {
      env,
      stdio: 'pipe',
    });
    pool = new Pool({
      connectionString: url.toString(),
      application_name: 'worker-process-fixture',
    });
    pool.on('connect', (client) => {
      fixtureClientEnds.push(new Promise<void>((done) => client.once('end', done)));
    });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('worker-process-actor','worker@example.test','fixture-only',true)"
    );
    child = spawn(process.execPath, [resolve(__dirname, '../dist/main.js')], {
      env: {
        ...env,
        ...(process.env.BARGHSA_WORKER_COVERAGE_DIR
          ? { NODE_V8_COVERAGE: process.env.BARGHSA_WORKER_COVERAGE_DIR }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    exited = new Promise((done, reject) => {
      child!.once('exit', (code, signal) => done({ code, signal }));
      child!.once('error', reject);
    });
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (data) => {
        output = (output + String(data)).slice(-20000);
      });
    await expect
      .poll(
        () => {
          if (child!.exitCode !== null || child!.signalCode !== null)
            throw new Error(`Worker startup failed: ${output}`);
          return /Worker health server listening on port ([1-9][0-9]*)/.exec(output)?.[1];
        },
        { timeout: 10000 }
      )
      .toBeTruthy();
    const port = /Worker health server listening on port ([1-9][0-9]*)/.exec(output)![1];
    return {
      base: `http://127.0.0.1:${port}`,
      pool,
      stop,
      close,
      databaseAvailable,
      child,
      logs: () => output,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

it('compiled worker serves health/metrics, executes scheduled jobs and drains on SIGTERM', async () => {
  const worker = await startWorker();
  try {
    for (const path of ['/', '/health', '/health/ready?probe=1', '/health/live']) {
      const response = await fetch(worker.base + path);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: 'ok', service: 'worker' });
    }
    const metrics = await fetch(worker.base + '/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.headers.get('content-type')).toContain('text/plain');
    expect(await metrics.text()).toContain('# HELP');
    expect((await fetch(worker.base + '/missing')).status).toBe(404);
    const jobs = [
      'ai_model_test',
      'service_breach_scan',
      'service_escalation_scan',
      'invoice_overdue_scan',
      'invoice_reminder_scheduler',
      'invoice_reminder_sender',
      'wallet_reconciliation_scan',
      'online_topup_expiry_scan',
      'invitation_expiry_scan',
    ];
    await worker.pool.query(
      `INSERT INTO background_jobs(job_type,error) SELECT unnest($1::text[]),'fixture failure'`,
      [jobs]
    );
    await expect
      .poll(
        async () =>
          (
            await worker.pool.query(
              "SELECT job_type,status,error FROM background_jobs WHERE status<>'resolved' ORDER BY job_type"
            )
          ).rows,
        { timeout: 5000 }
      )
      .toEqual([]);
    expect(await worker.stop()).toEqual({ code: 0, signal: null });
    expect(worker.logs()).toContain('Graceful shutdown complete');
    expect(worker.logs()).not.toMatch(/Fatal worker|Uncaught exception|failed to record/);
  } finally {
    await worker.close();
  }
}, 20000);

it('compiled worker falls back from invalid intervals and drains on SIGINT', async () => {
  const worker = await startWorker({
    ...Object.fromEntries(intervals.map((key) => [key, 'invalid'])),
    OUTBOX_POLL_MS: 'NaN',
    SHUTDOWN_GRACE_PERIOD_MS: 'invalid',
  });
  try {
    for (const key of intervals) expect(worker.logs()).toContain(`Invalid ${key}`);
    expect(await worker.stop('SIGINT')).toEqual({ code: 0, signal: null });
    expect(worker.logs()).toContain('30s deadline');
  } finally {
    await worker.close();
  }
}, 20000);

it('compiled worker keeps liveness but rejects readiness and metrics during database outage', async () => {
  const worker = await startWorker();
  try {
    await worker.databaseAvailable(false);
    expect((await fetch(worker.base + '/health/live')).status).toBe(200);
    expect((await fetch(worker.base + '/health/ready')).status).toBe(503);
    expect((await fetch(worker.base + '/metrics')).status).toBe(500);
    await worker.databaseAvailable(true);
    await expect
      .poll(async () => (await fetch(worker.base + '/health/ready')).status, { timeout: 5000 })
      .toBe(200);
  } finally {
    await worker.close();
  }
}, 20000);

for (const deadline of [false, true]) {
  it(`compiled worker ${deadline ? 'reports a forced deadline' : 'waits for an in-flight job'} during shutdown`, async () => {
    const worker = await startWorker({ SHUTDOWN_GRACE_PERIOD_MS: deadline ? '200' : '3000' });
    const blocker = await worker.pool.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE ai_model_test_jobs IN ACCESS EXCLUSIVE MODE');
      await expect
        .poll(
          async () =>
            Number(
              (
                await worker.pool.query(
                  "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'"
                )
              ).rows[0].count
            ),
          { timeout: 4000 }
        )
        .toBeGreaterThan(0);
      const stopping = worker.stop();
      if (deadline) {
        expect(await stopping).toEqual({ code: 1, signal: null });
        expect(worker.logs()).toContain('deadline exceeded');
      } else {
        await expect.poll(() => worker.logs()).toContain('starting graceful shutdown');
        expect(worker.child.exitCode).toBeNull();
        await blocker.query('COMMIT');
        expect(await stopping).toEqual({ code: 0, signal: null });
        expect(worker.logs()).toContain('Graceful shutdown complete');
      }
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      await worker.close();
    }
  }, 20000);
}

it('compiled worker reports a missing system actor and resolves failures after recovery', async () => {
  const worker = await startWorker();
  try {
    await worker.pool.query("DELETE FROM users WHERE user_id='worker-process-actor'");
    await expect
      .poll(
        async () =>
          Number(
            (
              await worker.pool.query(
                "SELECT count(*) FROM background_jobs WHERE job_type IN ('invoice_overdue_scan','online_topup_expiry_scan') AND status<>'resolved'"
              )
            ).rows[0].count
          ),
        { timeout: 5000 }
      )
      .toBe(2);
    await worker.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES ('worker-process-actor','worker@example.test','fixture-only',true)"
    );
    await expect
      .poll(
        async () =>
          Number(
            (
              await worker.pool.query(
                "SELECT count(*) FROM background_jobs WHERE job_type IN ('invoice_overdue_scan','online_topup_expiry_scan') AND status='resolved'"
              )
            ).rows[0].count
          ),
        { timeout: 5000 }
      )
      .toBe(2);
  } finally {
    await worker.close();
  }
}, 20000);
