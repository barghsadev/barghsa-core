import { beforeAll, beforeEach, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMigratedTestDb } from '../../../../packages/db/src/test/migrated-db.js';
import { AiModelSecrets } from '@barghsa/shared/ai-models';
import { runAiModelTest } from './test-runner.js';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const secrets = new AiModelSecrets('test-only-ai-queue-key');
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.pool.query('DELETE FROM ai_model_test_jobs; DELETE FROM ai_models');
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin) VALUES ('ai-worker-admin','ai-worker@example.test','test-only',true,true) ON CONFLICT(user_id) DO UPDATE SET is_admin=true,disabled_at=NULL,activation_token=NULL"
  );
});
async function enqueue() {
  const model = (
    await fixture.pool.query(
      "INSERT INTO ai_models(title,provider_type,base_url,model_name,api_token,created_by) VALUES ('Test','openai_compatible','https://model.example.test/v1','test-model',$1,'ai-worker-admin') RETURNING id,xmin::text AS revision",
      [secrets.encryptToken('local-queue-token')]
    )
  ).rows[0];
  const id = randomUUID();
  await fixture.pool.query(
    "INSERT INTO ai_model_test_jobs(id,model_id,model_revision,actor_user_id,deadline_at) VALUES ($1,$2,$3,'ai-worker-admin',NOW()+INTERVAL '2 minutes')",
    [id, model.id, model.revision]
  );
  return { id, model: model.id as string };
}
const tester = () => ({
  test: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1, responsePreview: 'pong' }),
});
it('claims once across competing workers and stores only a safe result', async () => {
  const { id } = await enqueue(),
    client = tester();
  expect(
    (
      await Promise.all([
        runAiModelTest(fixture.pool, client, secrets),
        runAiModelTest(fixture.pool, client, secrets),
      ])
    ).sort()
  ).toEqual(['completed', 'idle']);
  expect(client.test).toHaveBeenCalledOnce();
  expect(client.test).toHaveBeenCalledWith(
    expect.objectContaining({ apiToken: 'local-queue-token' }),
    expect.any(Number)
  );
  const row = (await fixture.pool.query('SELECT * FROM ai_model_test_jobs WHERE id=$1', [id]))
    .rows[0];
  expect(row).toMatchObject({
    status: 'completed',
    attempts: 1,
    lease_token: null,
    result: { ok: true, responsePreview: 'pong' },
  });
  expect(JSON.stringify(row)).not.toContain('local-queue-token');
});
it.each(['permission', 'model', 'deleted', 'expired', 'token'] as const)(
  'skips invalid work before contacting a provider: %s',
  async (kind) => {
    const { id, model } = await enqueue(),
      client = tester();
    if (kind === 'permission')
      await fixture.pool.query("UPDATE users SET is_admin=false WHERE user_id='ai-worker-admin'");
    if (kind === 'model')
      await fixture.pool.query("UPDATE ai_models SET model_name='changed' WHERE id=$1", [model]);
    if (kind === 'deleted') await fixture.pool.query('DELETE FROM ai_models WHERE id=$1', [model]);
    if (kind === 'expired')
      await fixture.pool.query(
        "UPDATE ai_model_test_jobs SET created_at=NOW()-INTERVAL '2 minutes',deadline_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
        [id]
      );
    if (kind === 'token') {
      await fixture.pool.query("UPDATE ai_models SET api_token='v1:bad:bad:bad' WHERE id=$1", [
        model,
      ]);
      await fixture.pool.query(
        'UPDATE ai_model_test_jobs SET model_revision=(SELECT xmin::text FROM ai_models WHERE id=$2) WHERE id=$1',
        [id, model]
      );
    }
    await runAiModelTest(fixture.pool, client, secrets);
    expect(client.test).not.toHaveBeenCalled();
    const row = (
      await fixture.pool.query(
        'SELECT status,error_code,result FROM ai_model_test_jobs WHERE id=$1',
        [id]
      )
    ).rows[0];
    expect(row.status).toBe(kind === 'token' ? 'completed' : 'failed');
    if (kind === 'token') expect(row.result).toMatchObject({ ok: false });
    else
      expect(row.error_code).toBe(
        {
          permission: 'AUTHZ:FORBIDDEN',
          model: 'AI_MODEL_CHANGED',
          deleted: 'AI_MODEL_NOT_FOUND',
          expired: 'AI_MODEL_TEST_EXPIRED',
        }[kind]
      );
  }
);
it('recovers an expired lease but fences its former worker result', async () => {
  const { id } = await enqueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = {
    test: vi.fn(async () => {
      await gate;
      return { ok: false, error: 'old worker', latencyMs: 2 };
    }),
  };
  const first = runAiModelTest(fixture.pool, slow, secrets);
  try {
    await expect.poll(() => slow.test.mock.calls.length).toBe(1);
    expect(
      (
        await fixture.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'"
        )
      ).rows
    ).toHaveLength(0);
    await fixture.pool.query(
      "UPDATE ai_model_test_jobs SET lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",
      [id]
    );
    expect(await runAiModelTest(fixture.pool, tester(), secrets)).toBe('completed');
    release();
    expect(await first).toBe('stale');
    expect(
      (await fixture.pool.query('SELECT attempts,result FROM ai_model_test_jobs WHERE id=$1', [id]))
        .rows[0]
    ).toMatchObject({ attempts: 2, result: { ok: true } });
  } finally {
    release();
    await first;
  }
});
it('stops after the second expired lease', async () => {
  const { id } = await enqueue(),
    client = tester();
  await fixture.pool.query(
    "UPDATE ai_model_test_jobs SET status='leased',attempts=2,lease_token=$2,lease_until=NOW()-INTERVAL '1 second' WHERE id=$1",
    [id, randomUUID()]
  );
  expect(await runAiModelTest(fixture.pool, client, secrets)).toBe('idle');
  expect(client.test).not.toHaveBeenCalled();
  expect(
    (await fixture.pool.query('SELECT status FROM ai_model_test_jobs WHERE id=$1', [id])).rows[0]
      .status
  ).toBe('failed');
});
it('enforces queue constraints and removes terminal previews after retention', async () => {
  const { id } = await enqueue();
  await expect(
    fixture.pool.query('UPDATE ai_model_test_jobs SET lease_token=$2 WHERE id=$1', [
      id,
      randomUUID(),
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await runAiModelTest(fixture.pool, tester(), secrets);
  await fixture.pool.query(
    "UPDATE ai_model_test_jobs SET updated_at=NOW()-INTERVAL '2 days' WHERE id=$1",
    [id]
  );
  await runAiModelTest(fixture.pool, tester(), secrets);
  expect(
    (await fixture.pool.query('SELECT id FROM ai_model_test_jobs WHERE id=$1', [id])).rows
  ).toHaveLength(0);
});

it('discards a provider result after the request is cancelled', async () => {
  const { id } = await enqueue();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const slow = {
    test: vi.fn(async () => {
      await gate;
      return { ok: true, latencyMs: 1 };
    }),
  };
  const running = runAiModelTest(fixture.pool, slow, secrets);
  try {
    await expect.poll(() => slow.test.mock.calls.length).toBe(1);
    await fixture.pool.query(
      "UPDATE ai_model_test_jobs SET status='cancelled',lease_token=NULL,lease_until=NULL,updated_at=NOW() WHERE id=$1",
      [id]
    );
    release();
    expect(await running).toBe('stale');
    expect(
      (await fixture.pool.query('SELECT status,result FROM ai_model_test_jobs WHERE id=$1', [id]))
        .rows[0]
    ).toEqual({ status: 'cancelled', result: null });
  } finally {
    release();
    await running;
  }
});
