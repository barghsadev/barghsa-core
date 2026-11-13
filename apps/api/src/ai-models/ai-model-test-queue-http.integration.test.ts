import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const collector = createServer((request, response) => {
  request.resume();
  request.once('end', () => response.end('{}'));
});
beforeAll(async () => {
  await new Promise<void>((done) => collector.listen(0, '127.0.0.1', done));
  const address = collector.address();
  if (!address || typeof address === 'string') throw new Error('Missing collector address');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, undefined, '', 10, '', false, {
    endpoint: '',
    intervalMs: 1000,
    timeoutMs: 1000,
    traces: { endpoint: `http://127.0.0.1:${address.port}/v1/traces`, sampleRate: 1 },
  });
}, 30000);
afterAll(async () => {
  try {
    await http?.close();
  } finally {
    await new Promise<void>((done) => collector.close(() => done()));
  }
});
it('times out without a worker, cancels queued work and leaves reachability unchanged', async () => {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES ('queue-admin','queue-admin@example.test','test-only',true,true)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'queue-admin',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '1 hour',NOW())",
    [session, csrf, randomUUID()]
  );
  const { id } = (
    await http.pool.query(
      "INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by) VALUES ('Queued','openai_compatible','http://127.0.0.1:1/v1','local-test','queue-admin') RETURNING id"
    )
  ).rows[0];
  const traceId = '89'.repeat(16);
  const response = await fetch(`${http.base}/api/admin/ai-models/${id}/test`, {
    method: 'POST',
    headers: {
      cookie: `barghsa_session=${session}`,
      'x-csrf-token': csrf,
      traceparent: `00-${traceId}-${'8a'.repeat(8)}-01`,
    },
  });
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ error: { code: 'AI_MODEL_TEST_EXPIRED' } });
  expect(
    (
      await http.pool.query(
        'SELECT status,attempts,result,correlation_id,trace_parent FROM ai_model_test_jobs WHERE model_id=$1',
        [id]
      )
    ).rows
  ).toEqual([
    {
      status: 'cancelled',
      attempts: 0,
      result: null,
      correlation_id: response.headers.get('x-correlation-id'),
      trace_parent: expect.stringMatching(new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`)),
    },
  ]);
  expect(
    (await http.pool.query('SELECT last_test_status FROM ai_models WHERE id=$1', [id])).rows
  ).toEqual([{ last_test_status: 'pending' }]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_model_tested'")).rows
  ).toHaveLength(0);
});
