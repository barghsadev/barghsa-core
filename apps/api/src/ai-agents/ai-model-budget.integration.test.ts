import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ChatCompletionInput } from '@barghsa/shared/ai-models';
import { closeDbPools, createDbPool } from '@barghsa/db';
import { startHttpFixture } from '../test/http-fixture.js';
import { completeWithinModelBudget } from './ai-model-budget.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let modelId: string;
const input: ChatCompletionInput = {
  providerType: 'openai_compatible',
  baseUrl: 'https://example.test/v1',
  modelName: 'budget-test',
  apiToken: null,
  messages: [{ role: 'user', content: 'What does the guide say?' }],
  temperature: 0,
  maxTokens: 10,
};
const reserve = Buffer.byteLength(JSON.stringify(input.messages), 'utf8') + input.maxTokens;

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  const database = (await http.pool.query<{ name: string }>('SELECT current_database() AS name'))
    .rows[0]!.name;
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  createDbPool({ databaseUrl: url.toString(), poolMax: 4 });
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES ('budget-admin','budget-admin@example.test','test',true)"
  );
  await http.pool.query(
    "INSERT INTO staff_roles(role_id,name,description,permissions) VALUES ('budget-role','AI budgets','Test','[\"admin:ai:models\"]')"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES ('budget-admin','budget-role')"
  );
  modelId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO ai_models(title,provider_type,base_url,model_name,created_by)
       VALUES ('Budget model','openai_compatible','https://example.test/v1','budget-test','budget-admin')
       RETURNING id`
    )
  ).rows[0]!.id;
}, 30_000);
afterAll(async () => {
  await closeDbPools();
  await http?.close();
});

it('rejects before provider use when the token allowance is exhausted, then resets in a new month', async () => {
  await http.pool.query(
    `INSERT INTO ai_model_budgets(model_id,monthly_token_limit)
     VALUES ($1,$2)`,
    [modelId, reserve + 9]
  );
  let calls = 0;
  const invoke = async () => {
    calls += 1;
    return { reply: 'A sourced answer', tokenUsage: { input: 7, output: 3 } };
  };
  expect((await completeWithinModelBudget(modelId, input, invoke)).reply).toBe('A sourced answer');
  await expect(completeWithinModelBudget(modelId, input, invoke)).rejects.toMatchObject({
    status: 429,
  });
  expect(calls).toBe(1);
  expect(
    (
      await http.pool.query(
        'SELECT used_input_tokens,used_output_tokens FROM ai_model_budgets WHERE model_id=$1',
        [modelId]
      )
    ).rows[0]
  ).toMatchObject({ used_input_tokens: '7', used_output_tokens: '3' });
  await http.pool.query(
    "UPDATE ai_model_budgets SET period_start=date_trunc('month',now())-interval '1 month' WHERE model_id=$1",
    [modelId]
  );
  await completeWithinModelBudget(modelId, input, invoke);
  expect(calls).toBe(2);
  expect(
    (
      await http.pool.query(
        'SELECT used_input_tokens,used_output_tokens FROM ai_model_budgets WHERE model_id=$1',
        [modelId]
      )
    ).rows[0]
  ).toMatchObject({ used_input_tokens: '7', used_output_tokens: '3' });
}, 30_000);

it('charges actual cost, alerts model operators once at 80%, and serializes competing calls', async () => {
  await http.pool.query(
    `UPDATE ai_model_budgets SET monthly_token_limit=NULL,monthly_cost_limit_micros=$2,
       input_price_per_million_micros=1000000,output_price_per_million_micros=1000000,
       used_input_tokens=0,used_output_tokens=0,used_cost_micros=0,alerted_at=NULL
     WHERE model_id=$1`,
    [modelId, reserve + 1]
  );
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = completeWithinModelBudget(modelId, input, async () => {
    entered();
    await firstGate;
    return { reply: 'first', tokenUsage: { input: reserve - 10, output: 10 } };
  });
  await started;
  let secondCalls = 0;
  const second = completeWithinModelBudget(modelId, input, async () => {
    secondCalls += 1;
    return { reply: 'second', tokenUsage: { input: reserve - 10, output: 10 } };
  });
  releaseFirst();
  expect((await first).reply).toBe('first');
  await expect(second).rejects.toMatchObject({ status: 429 });
  expect(secondCalls).toBe(0);
  expect(
    (
      await http.pool.query(
        'SELECT used_cost_micros,alerted_at FROM ai_model_budgets WHERE model_id=$1',
        [modelId]
      )
    ).rows[0]
  ).toMatchObject({ used_cost_micros: String(reserve), alerted_at: expect.any(Date) });
  expect(
    (
      await http.pool.query(
        "SELECT id FROM notifications WHERE user_id='budget-admin' AND (title LIKE '%80%' OR title LIKE '%۸۰٪%')"
      )
    ).rows
  ).toHaveLength(1);
  await expect(
    completeWithinModelBudget(modelId, input, async () => {
      secondCalls += 1;
      return { reply: 'third', tokenUsage: null };
    })
  ).rejects.toMatchObject({ status: 429 });
  expect(secondCalls).toBe(0);
}, 30_000);
