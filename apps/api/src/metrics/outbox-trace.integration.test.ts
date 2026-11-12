import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import * as argon2 from 'argon2';
import { expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import { fetchWithPreauth } from '../test/public-auth.js';

it('carries the API request trace through PostgreSQL to the worker handling the same notice', async () => {
  const spans: { service: string | undefined; span: Record<string, unknown> }[] = [];
  const collector = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const { resourceSpans } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      resourceSpans: {
        resource: { attributes: { key: string; value: { stringValue: string } }[] };
        scopeSpans: { spans: Record<string, unknown>[] }[];
      }[];
    };
    for (const resource of resourceSpans) {
      const service = resource.resource.attributes.find(({ key }) => key === 'service.name')?.value
        .stringValue;
      for (const scope of resource.scopeSpans)
        for (const span of scope.spans) spans.push({ service, span });
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((done) => collector.listen(0, '127.0.0.1', done));
  let fixture: Awaited<ReturnType<typeof startHttpFixture>> | undefined;
  try {
    const address = collector.address();
    if (!address || typeof address === 'string') throw new Error('Missing collector address');
    const endpoint = `http://127.0.0.1:${address.port}/v1/traces`;
    fixture = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '', false, {
      endpoint: '',
      intervalMs: 1000,
      timeoutMs: 1000,
      traces: { endpoint, sampleRate: 1 },
    });
    const token = randomUUID();
    const password = 'Fixture-new-password-234!';
    const email = 'private-fixture-recipient@example.test';
    await fixture.pool.query(
      `INSERT INTO users(user_id,username,password_hash,must_change_password,password_change_token,
                        password_change_token_expires_at,notification_preferences)
       VALUES ('trace-fixture-user',$1,$2,true,$3,NOW()+INTERVAL '5 minutes','IN_APP,EMAIL')`,
      [email, await argon2.hash('Fixture-old-password-123!'), token]
    );
    const traceId = 'f8181818181818181818181818181818';
    const inboundParent = 'f929292929292929';
    const response = await fetchWithPreauth(`${fixture.base}/api/auth/force-change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        traceparent: `00-${traceId}-${inboundParent}-00`,
      },
      body: JSON.stringify({ passwordChangeToken: token, newPassword: password }),
      signal: AbortSignal.timeout(10000),
    });
    expect(response.status).toBe(200);
    const notice = (
      await fixture.pool.query(
        `SELECT id, trace_parent, status, payload FROM notification_outbox
         WHERE user_id='trace-fixture-user' AND event_key='auth.password_changed'`
      )
    ).rows;
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({ status: 'queued' });
    expect(notice[0].payload).not.toHaveProperty('traceparent');
    const api = () =>
      spans.find(
        ({ service, span }) =>
          service === 'barghsa-api' && span.name === 'POST /api/auth/force-change-password'
      )?.span;
    await expect.poll(api, { timeout: 7000 }).toMatchObject({
      traceId,
      parentSpanId: inboundParent,
    });
    expect(notice[0].trace_parent).toBe(`00-${traceId}-${api()?.spanId}-01`);
    const database = fixture.pool.options.connectionString;
    if (!database) throw new Error('Missing isolated database connection');
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '-e',
        `const { createDbPool } = require('@barghsa/db');
       const { createTraceProvider } = require('@barghsa/shared/telemetry');
       const { runOutboxPoll } = require('./dist/notifications/outbox-runner.js');
       const pool = createDbPool({ databaseUrl: process.env.DATABASE_URL });
       const provider = createTraceProvider('barghsa-worker');
       runOutboxPoll({
         pool,
         tracer: provider.getTracer('barghsa.worker.notifications'),
         transports: { email: { channel: 'email', send: async () => ({
           providerRef: 'local-fixture-receipt', status: 'delivered',
         }) } },
       }).finally(async () => {
         await provider.shutdown();
         await pool.end();
       }).catch(error => { console.error(error); process.exitCode = 1; });`,
      ],
      {
        cwd: resolve(__dirname, '../../../worker'),
        env: {
          ...process.env,
          DATABASE_URL: database,
          PGBOUNCER_URL: '',
          NODE_ENV: 'test',
          BARGHSA_DEPLOYMENT_ENV: 'staging',
          OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: endpoint,
          OTEL_EXPORTER_OTLP_TRACES_HEADERS: '',
          OTEL_EXPORTER_OTLP_TRACES_TIMEOUT: '2000',
          OTEL_TRACE_SUCCESS_SAMPLE_RATE: '1',
          OTEL_EXPORTER_OTLP_HEADERS: '',
        },
        timeout: 10000,
      }
    );
    const worker = spans.find(
      ({ service, span }) =>
        service === 'barghsa-worker' && span.name === 'notification.outbox.process'
    )?.span;
    expect(worker).toMatchObject({ traceId, parentSpanId: api()?.spanId, kind: 5 });
    expect(worker?.spanId).not.toBe(api()?.spanId);
    const delivery = stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
      .find((record) => record.event === 'notification.attempt');
    expect(delivery).toMatchObject({
      outboxId: notice[0].id,
      traceId,
      spanId: worker?.spanId,
      status: 'delivered',
    });
    expect(
      (
        await fixture.pool.query(
          "SELECT status,provider_ref FROM notification_job WHERE outbox_id=$1 AND channel='email'",
          [notice[0].id]
        )
      ).rows
    ).toEqual([{ status: 'done', provider_ref: 'local-fixture-receipt' }]);
    const exported = JSON.stringify(spans);
    for (const privateValue of [token, password, email, 'local-fixture-receipt', notice[0].id])
      expect(exported).not.toContain(privateValue);
  } finally {
    try {
      await fixture?.close();
    } finally {
      await new Promise<void>((done) => collector.close(() => done()));
    }
  }
}, 75_000);
