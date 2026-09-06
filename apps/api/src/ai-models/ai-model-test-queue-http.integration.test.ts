import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 30000);
afterAll(async () => {
  await http?.close();
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
  const response = await fetch(`${http.base}/api/admin/ai-models/${id}/test`, {
    method: 'POST',
    headers: { cookie: `barghsa_session=${session}`, 'x-csrf-token': csrf },
  });
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({ error: { code: 'AI_MODEL_TEST_EXPIRED' } });
  expect(
    (
      await http.pool.query(
        'SELECT status,attempts,result FROM ai_model_test_jobs WHERE model_id=$1',
        [id]
      )
    ).rows
  ).toEqual([{ status: 'cancelled', attempts: 0, result: null }]);
  expect(
    (await http.pool.query('SELECT last_test_status FROM ai_models WHERE id=$1', [id])).rows
  ).toEqual([{ last_test_status: 'pending' }]);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='ai_model_tested'")).rows
  ).toHaveLength(0);
});
