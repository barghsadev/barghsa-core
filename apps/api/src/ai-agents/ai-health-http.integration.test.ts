import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);

afterAll(async () => {
  await http?.close();
});

it('keeps AI circuit details private when the staff session expires during the database read', async () => {
  const viewer = 'ai-model-health-viewer';
  const session = randomUUID();
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
       VALUES ('test-ai-health-viewer','AI health viewer','Fixture role','["admin:ai:models"]')`
  );
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_staff)
       VALUES ($1,$1,'test-only',true)`,
    [viewer]
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ($1,'test-ai-health-viewer')",
    [viewer]
  );
  const { id } = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by)
         VALUES ('Fixture model','openai_compatible','https://model.example.test/v1','fixture',$1)
         RETURNING id`,
      [viewer]
    )
  ).rows[0]!;
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,operating_context,expires_at,idle_deadline)
       VALUES ($1,$2,$3,$4,'staff',clock_timestamp()+INTERVAL '1 hour',
               clock_timestamp()+INTERVAL '30 minutes')`,
    [session, viewer, randomUUID(), randomUUID()]
  );
  const read = () =>
    fetch(`${http.base}/api/ai/health`, {
      headers: { Cookie: `barghsa_session=${session}` },
    });
  const current = await read();
  expect(current.status, http.logs()).toBe(200);
  expect(await current.json()).toMatchObject({ models: [{ id, status: 'disabled' }] });

  const blocker = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE ai_model_circuit_states IN ACCESS EXCLUSIVE MODE');
    const { pid } = (await blocker.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
      .rows[0]!;
    const { expires_at: expiresAt } = (
      await http.pool.query<{ expires_at: Date }>(
        `UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '4 seconds'
           WHERE session_id=$1 RETURNING expires_at`,
        [session]
      )
    ).rows[0]!;
    pending = read();
    await expect
      .poll(async () => {
        const waiting = await http.pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM pg_stat_activity
             WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))
               AND query LIKE '%FROM ai_models m LEFT JOIN ai_model_circuit_states%'`,
          [pid]
        );
        return waiting.rows[0]!.count;
      })
      .toBe(1);
    await expect
      .poll(
        async () => {
          const observed = await http.pool.query<{ expired: boolean }>(
            'SELECT clock_timestamp()>=$1::timestamptz AS expired',
            [expiresAt]
          );
          return observed.rows[0]!.expired;
        },
        { timeout: 6000 }
      )
      .toBe(true);
    await blocker.query('COMMIT');
    const denied = await pending;
    expect(denied.status, http.logs()).toBe(401);
    const body = await denied.text();
    expect(body).not.toContain(id);
    expect(body).not.toContain('"models"');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
}, 12000);
