import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { expect, it, vi } from 'vitest';
import { receiveOperationsAlerts } from '../../worker/src/operations/alerts.js';
import { startHttpFixture } from '../src/test/http-fixture.js';

function createActors(samples: number) {
  return Array.from({ length: samples }, (_, index) => ({
    userId: randomUUID(),
    profileId: randomUUID(),
    invoiceId: randomUUID(),
    sessionId: randomUUID(),
    csrf: randomUUID(),
    orderKey: randomUUID(),
    paymentKey: randomUUID(),
    ...(index % 2
      ? { locale: 'en', street: 'Performance Avenue', search: 'Performance', fileName: 'proof.pdf' }
      : { locale: 'fa', street: 'خیابان آزمایشی', search: 'آزمایشی', fileName: 'مدرک.pdf' }),
  }));
}

async function seed(pool: Pool, actors: ReturnType<typeof createActors>, background: number) {
  const input = [JSON.stringify(actors)];
  await pool.query(
    `INSERT INTO users(user_id,username,password_hash)
     SELECT "userId", "userId" || '@performance.test','test-only'
     FROM jsonb_to_recordset($1) AS a("userId" text)`,
    input
  );
  await pool.query(
    `INSERT INTO profiles(id,user_id,profile_type,status,is_default)
     SELECT "profileId","userId",'LEGAL','ACTIVE',true
     FROM jsonb_to_recordset($1) AS a("profileId" uuid,"userId" text)`,
    input
  );
  await pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
     SELECT "sessionId","userId",csrf,"sessionId",NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes',NOW()
     FROM jsonb_to_recordset($1) AS a("sessionId" uuid,"userId" text,csrf uuid)`,
    input
  );
  await pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
     SELECT "profileId",150000,0 FROM jsonb_to_recordset($1) AS a("profileId" uuid)`,
    input
  );
  await pool.query(
    `INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,issued_at,payable_from)
     SELECT "invoiceId","profileId",'Unpaid',100000,0,NOW(),NOW()-INTERVAL '1 day'
     FROM jsonb_to_recordset($1) AS a("invoiceId" uuid,"profileId" uuid)`,
    input
  );
  await pool.query(
    `INSERT INTO invoices(profile_id,state,total_amount,paid_amount,issued_at,payable_from)
     SELECT "profileId",'Paid',20000,20000,NOW()-(n*INTERVAL '1 month'),NOW()-(n*INTERVAL '1 month')
     FROM jsonb_to_recordset($1) AS a("profileId" uuid) CROSS JOIN generate_series(1,12) AS n`,
    input
  );
  await pool.query(
    `WITH inserted AS (
       INSERT INTO users(user_id,username,password_hash)
       SELECT 'background-' || n,'background-' || n || '@performance.test','test-only'
       FROM generate_series(1,$1::integer) AS n RETURNING user_id
     ) INSERT INTO profiles(user_id,profile_type,status,first_name,last_name)
       SELECT user_id,'INDIVIDUAL','ACTIVE','Performance','آزمایشی' FROM inserted`,
    [background]
  );
  const admins = await pool.query<{ user_id: string }>(
    `INSERT INTO users(user_id,username,password_hash,is_staff,is_admin)
     SELECT 'perf-staff-' || n,'perf-staff-' || n || '@performance.test','test-only',true,true
     FROM generate_series(1,3) AS n RETURNING user_id`
  );
  const staffSession = randomUUID();
  await pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
     VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes')`,
    [staffSession, admins.rows[0]!.user_id, randomUUID()]
  );
  await pool.query(
    `INSERT INTO products(type,system_key,title,status,price)
     VALUES ('electricity','thermal','{"fa":"حرارتی","en":"Thermal"}','active',100000),
            ('electricity','green','{"fa":"سبز","en":"Green"}','active',200000)
     ON CONFLICT (system_key) DO UPDATE SET status='active',price=EXCLUDED.price`
  );
  const { id: provinceId } = (
    await pool.query<{ id: number }>(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان آزمایشی','Performance Province') RETURNING id"
    )
  ).rows[0]!;
  const { id: cityId } = (
    await pool.query<{ id: number }>(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر آزمایشی','Performance City') RETURNING id",
      [provinceId]
    )
  ).rows[0]!;
  await pool.query('ANALYZE');
  return { staffSession, address: { provinceId, cityId, postalCode: '1234567890' } };
}

it('measures the seven production entry points with isolated PostgreSQL fixtures', async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error('The disposable PostgreSQL fixture is required');
  const source = process.env.BARGHSA_PERFORMANCE_SHA;
  if (!source || !/^[a-f0-9]{40}$/.test(source)) throw new Error('A full source SHA is required');
  const smoke = process.env.BARGHSA_PERFORMANCE_SMOKE === '1';
  const samples = smoke ? 4 : 1000;
  const concurrency = smoke ? 2 : 8;
  const background = smoke ? 12 : 5000;
  const directory = await mkdtemp(join(tmpdir(), 'barghsa-performance-'));
  const reportPath = process.env.BARGHSA_PERFORMANCE_REPORT ?? join(directory, 'report.json');
  const inputPath = join(directory, 'fixtures.json');
  const alertSecret = randomUUID() + randomUUID();
  vi.stubEnv('OPS_ALERT_WEBHOOK_SECRET', alertSecret);
  vi.stubEnv('OPS_ALERT_ENVIRONMENT', 'isolated-load');
  vi.stubEnv('OPS_ALERT_DATABASE', 'fixture');
  vi.stubEnv('BARGHSA_BROWSER_FIXTURE_LOOPBACK', '1');
  let http: Awaited<ReturnType<typeof startHttpFixture>> | undefined;
  const server = createServer((req, res) => {
    if (http && req.url === '/operations/alerts') void receiveOperationsAlerts(req, res, http.pool);
    else res.writeHead(404).end();
  });
  try {
    // The presign operation needs an origin and synthetic credentials but performs no object PUT.
    http = await startHttpFixture(process.env.TEST_DATABASE_URL, 'http://127.0.0.1:9');
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing operations fixture port');
    const actors = createActors(samples);
    const common = await seed(http.pool, actors, background);
    await writeFile(
      inputPath,
      JSON.stringify({
        ...common,
        api: http.base,
        operations: `http://127.0.0.1:${address.port}`,
        alertSecret,
        startsAt: new Date().toISOString(),
        source,
        concurrency,
        samples,
        background,
        actors,
      }),
      { mode: 0o600 }
    );
    const script = fileURLToPath(new URL('./weekly.k6.mjs', import.meta.url));
    const child = spawn(process.env.BARGHSA_K6_BIN ?? 'k6', ['run', '--quiet', script], {
      env: {
        PATH: process.env.PATH,
        K6_NO_USAGE_REPORT: 'true',
        K6_NO_COLOR: 'true',
        BARGHSA_PERFORMANCE_INPUT: inputPath,
        BARGHSA_PERFORMANCE_REPORT: reportPath,
      },
      signal: AbortSignal.timeout(650_000),
      stdio: 'inherit',
    });
    const [exitCode] = await once(child, 'exit');
    expect(exitCode).toBe(0);
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
      failedChecks: number;
      operations: Array<{
        completed: number;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number | null;
        regression: boolean;
      }>;
    };
    expect(report.failedChecks).toBe(0);
    expect(report.operations).toHaveLength(7);
    for (const operation of report.operations) {
      expect(operation).toMatchObject({ completed: samples, regression: false });
      expect(operation.p50Ms).toBeGreaterThan(0);
      expect(operation.p95Ms).toBeGreaterThanOrEqual(operation.p50Ms);
      if (smoke) expect(operation.p99Ms).toBeNull();
      else expect(operation.p99Ms).toBeGreaterThanOrEqual(operation.p95Ms);
    }

    const { rows } = await http.pool.query(
      `SELECT (SELECT count(*)::int FROM electricity_orders) AS orders,
              (SELECT count(*)::int FROM invoices WHERE id=ANY($1::uuid[]) AND state='Paid' AND paid_amount=100000) AS paid,
              (SELECT count(*)::int FROM wallet_transactions WHERE type='payment' AND ref_id=ANY($2::text[])) AS debits,
              (SELECT count(*)::int FROM storage_records WHERE storage_key LIKE 'uploads/document/%') AS reservations,
              (SELECT count(*)::int FROM operations_alert_receipts) AS alerts,
              (SELECT count(*)::int FROM notification_outbox WHERE event_key='admin.operations_alert') AS alerts_enqueued`,
      [actors.map((actor) => actor.invoiceId), actors.map((actor) => actor.invoiceId)]
    );
    expect(rows).toEqual([
      {
        orders: samples,
        paid: samples,
        debits: samples,
        reservations: samples,
        alerts: samples,
        alerts_enqueued: 3 * samples,
      },
    ]);
  } finally {
    try {
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
      await http?.close();
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  }
}, 720_000);
