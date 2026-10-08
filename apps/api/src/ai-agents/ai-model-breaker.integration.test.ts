import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { closeDbPools, createDbPool } from '@barghsa/db';
import { aiModelTestPrompt, type ChatCompletionInput } from '@barghsa/shared/ai-models';
import { startHttpFixture } from '../test/http-fixture.js';
import { completeChatWithBreaker } from './ai-model-breaker.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let modelId: string;
const servers: Server[] = [];
const input: ChatCompletionInput = {
  providerType: 'openai_compatible',
  baseUrl: 'https://provider.example.test/v1',
  modelName: 'recovery-test',
  apiToken: 'provider-secret',
  messages: [{ role: 'user', content: 'Private customer question' }],
  maxTokens: 10,
  temperature: 0.7,
};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  const database = (await http.pool.query('SELECT current_database() AS name')).rows[0].name;
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  createDbPool({ databaseUrl: url.toString(), poolMax: 4 });
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('recovery-admin','recovery-admin@example.test','test',true)"
  );
  modelId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by,is_enabled,last_test_status)
       VALUES ('Recovery model','openai_compatible',$1,$2,'recovery-admin',true,'passed') RETURNING id`,
      [input.baseUrl, input.modelName]
    )
  ).rows[0]!.id;
}, 30_000);
beforeEach(async () => {
  await http.pool.query('DELETE FROM ai_model_budgets WHERE model_id=$1', [modelId]);
  await http.pool.query(
    `UPDATE ai_model_circuit_states SET degraded=true,
       cooldown_until=now()-interval '1 second',consecutive_failures=5,
       window_failures=5,recent_failure_times=ARRAY[now()],opened_at=now()
     WHERE id=$1`,
    [modelId]
  );
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});
afterAll(async () => {
  await closeDbPools();
  await http?.close();
});

async function worker(respond: (index: number) => Promise<{ status: number; payload: unknown }>) {
  const bodies: Array<{ request: { messages: unknown; maxTokens: number; temperature: number } }> =
    [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    expect(req.headers['x-ai-inference-token']).toBe('internal-secret');
    expect(body).not.toContain('provider-secret');
    bodies.push(JSON.parse(body));
    const { status, payload } = await respond(bodies.length);
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing worker port');
  vi.stubEnv('AI_INFERENCE_URL', `http://127.0.0.1:${address.port}`);
  vi.stubEnv('AI_INFERENCE_SHARED_SECRET', 'internal-secret');
  return bodies;
}
const success = async (index: number) => ({
  status: 200,
  payload: {
    reply: index === 1 ? 'OK. Model=recovery-test' : 'Customer answer',
    tokenUsage: { input: index * 7, output: index * 3 },
  },
});
async function state() {
  return (
    await http.pool.query(
      'SELECT degraded,consecutive_failures,cooldown_until FROM ai_model_circuit_states WHERE id=$1',
      [modelId]
    )
  ).rows[0];
}

it('probes with the connection-test prompt, charges both calls and returns only the customer answer', async () => {
  await http.pool.query(
    'INSERT INTO ai_model_budgets(model_id,monthly_token_limit) VALUES ($1,10000)',
    [modelId]
  );
  const bodies = await worker(success);
  expect((await completeChatWithBreaker(modelId, input)).reply).toBe('Customer answer');
  expect(bodies).toHaveLength(2);
  expect(bodies[0]!.request).toEqual({
    messages: [{ role: 'user', content: aiModelTestPrompt(input.modelName) }],
    maxTokens: 32,
    temperature: 0,
  });
  expect(bodies[1]!.request).toEqual({ messages: input.messages, maxTokens: 10, temperature: 0.7 });
  expect(await state()).toMatchObject({ degraded: false, consecutive_failures: 0 });
  expect(
    (
      await http.pool.query(
        'SELECT used_input_tokens,used_output_tokens FROM ai_model_budgets WHERE model_id=$1',
        [modelId]
      )
    ).rows[0]
  ).toMatchObject({ used_input_tokens: '21', used_output_tokens: '9' });
});

it('allows one recovery probe across concurrent callers and refuses open circuits without provider I/O', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const bodies = await worker(async (index) => {
    if (index === 1) {
      entered();
      await gate;
    }
    return success(index);
  });
  const first = completeChatWithBreaker(modelId, input);
  try {
    await started;
    await expect(completeChatWithBreaker(modelId, input)).rejects.toMatchObject({
      response: { error: 'AI_MODEL_CIRCUIT_OPEN' },
      status: 503,
    });
    expect(bodies).toHaveLength(1);
  } finally {
    release();
  }
  expect((await first).reply).toBe('Customer answer');
  expect(bodies).toHaveLength(2);
});

it('keeps the circuit open on a failed probe and never sends customer messages', async () => {
  const bodies = await worker(async () => ({
    status: 502,
    payload: { error: 'provider failure' },
  }));
  await expect(completeChatWithBreaker(modelId, input)).rejects.toMatchObject({
    response: { error: 'AI_MODEL_CIRCUIT_OPEN' },
    status: 503,
  });
  expect(bodies).toHaveLength(1);
  expect(bodies[0]!.request.messages).toEqual([
    { role: 'user', content: aiModelTestPrompt(input.modelName) },
  ]);
  expect(await state()).toMatchObject({ degraded: true, consecutive_failures: 6 });
});

it('preserves infrastructure failures without incrementing provider failures', async () => {
  const bodies = await worker(async () => ({
    status: 503,
    payload: { error: 'AI_INFERENCE_BUSY' },
  }));
  await expect(completeChatWithBreaker(modelId, input)).rejects.toMatchObject({
    response: { error: 'AI_INFERENCE_BUSY' },
    status: 503,
  });
  expect(bodies).toHaveLength(1);
  expect(await state()).toMatchObject({ degraded: true, consecutive_failures: 5 });
});

it('reserves the probe budget before I/O and retains its charge when customer work exceeds the remaining allowance', async () => {
  const messages = [{ role: 'user', content: aiModelTestPrompt(input.modelName) }];
  const reserve = Buffer.byteLength(JSON.stringify(messages), 'utf8') + 32;
  await http.pool.query(
    'INSERT INTO ai_model_budgets(model_id,monthly_token_limit) VALUES ($1,$2)',
    [modelId, reserve - 1]
  );
  const bodies = await worker(async () => ({
    status: 200,
    payload: { reply: 'OK', tokenUsage: { input: reserve - 35, output: 32 } },
  }));
  await expect(completeChatWithBreaker(modelId, input)).rejects.toMatchObject({ status: 429 });
  expect(bodies).toHaveLength(0);
  await http.pool.query('UPDATE ai_model_budgets SET monthly_token_limit=$2 WHERE model_id=$1', [
    modelId,
    reserve,
  ]);
  await http.pool.query(
    "UPDATE ai_model_circuit_states SET cooldown_until=now()-interval '1 second' WHERE id=$1",
    [modelId]
  );
  await expect(completeChatWithBreaker(modelId, input)).rejects.toMatchObject({ status: 429 });
  expect(bodies).toHaveLength(1);
  expect(
    (
      await http.pool.query(
        'SELECT used_input_tokens,used_output_tokens FROM ai_model_budgets WHERE model_id=$1',
        [modelId]
      )
    ).rows[0]
  ).toMatchObject({ used_input_tokens: String(reserve - 35), used_output_tokens: '32' });
  expect(await state()).toMatchObject({ degraded: false });
});

it('does not admit customer work when the successful probe has lost its lease', async () => {
  const bodies = await worker(async (index) => {
    await http.pool.query(
      "UPDATE ai_model_circuit_states SET cooldown_until=now()+interval '2 minutes' WHERE id=$1",
      [modelId]
    );
    return success(index);
  });
  await expect(completeChatWithBreaker(modelId, input)).rejects.toMatchObject({
    response: { error: 'AI_MODEL_CIRCUIT_OPEN' },
    status: 503,
  });
  expect(bodies).toHaveLength(1);
  expect(await state()).toMatchObject({ degraded: true });
});

it('sends only the original completion when the circuit is closed', async () => {
  await http.pool.query(
    'UPDATE ai_model_circuit_states SET degraded=false,cooldown_until=NULL WHERE id=$1',
    [modelId]
  );
  const bodies = await worker(success);
  await completeChatWithBreaker(modelId, input);
  expect(bodies).toHaveLength(1);
  expect(bodies[0]!.request.messages).toEqual(input.messages);
});

it('rechecks circuit admission after waiting for a competing budget transaction', async () => {
  await http.pool.query(
    'UPDATE ai_model_circuit_states SET degraded=false,cooldown_until=NULL WHERE id=$1',
    [modelId]
  );
  await http.pool.query(
    'INSERT INTO ai_model_budgets(model_id,monthly_token_limit) VALUES ($1,10000)',
    [modelId]
  );
  const bodies = await worker(success);
  const blocker = await http.pool.connect();
  let pending: Promise<unknown> | undefined;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT model_id FROM ai_model_budgets WHERE model_id=$1 FOR UPDATE', [
      modelId,
    ]);
    pending = completeChatWithBreaker(modelId, input).catch((error: unknown) => error);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
         AND wait_event_type='Lock' AND query LIKE '%FROM ai_model_budgets WHERE model_id=$1 FOR UPDATE%'`
            )
          ).rowCount,
        { timeout: 5_000 }
      )
      .toBe(1);
    await http.pool.query(
      "UPDATE ai_model_circuit_states SET degraded=true,cooldown_until=now()+interval '1 minute' WHERE id=$1",
      [modelId]
    );
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  expect(await pending).toMatchObject({
    response: { error: 'AI_MODEL_CIRCUIT_OPEN' },
    status: 503,
  });
  expect(bodies).toHaveLength(0);
});
