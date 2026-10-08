import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { Pool } from 'pg';
import { AiModelSecrets, type ChatCompletionInput } from '@barghsa/shared/ai-models';
import { createAiInferenceServer } from './server.js';

const secret = 'test-internal-secret-0123456789abcdef';
const modelId = '11001100-1100-7100-8100-110011001100';
const secrets = new AiModelSecrets(Buffer.from('0123456789abcdef0123456789abcdef'));
const model = {
  provider_type: 'openai_compatible',
  base_url: 'https://provider.example.test/v1',
  model_name: 'model-a',
  api_token: secrets.encryptToken('provider-secret'),
  is_enabled: true,
  last_test_status: 'passed',
};
const body = {
  modelId,
  expected: {
    providerType: model.provider_type,
    baseUrl: model.base_url,
    modelName: model.model_name,
  },
  request: {
    messages: [{ role: 'user', content: 'hello' }],
    temperature: 0,
    maxTokens: 12,
  },
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function fixture(
  overrides: {
    completion?: (
      input: ChatCompletionInput
    ) => Promise<{ reply: string; tokenUsage: { input: number; output: number } }>;
    maxConcurrency?: number;
    modelState?: Partial<typeof model>;
  } = {}
) {
  const query = vi.fn(async (sql: string) =>
    sql.includes('FROM ai_models')
      ? { rows: [{ ...model, ...overrides.modelState }] }
      : { rows: [{ '?column?': 1 }] }
  );
  const completion = vi.fn(
    overrides.completion ?? (async () => ({ reply: 'done', tokenUsage: { input: 1, output: 2 } }))
  );
  const server = createAiInferenceServer({
    pool: { query } as unknown as Pick<Pool, 'query'>,
    secret,
    secrets,
    completion,
    ...(overrides.maxConcurrency === undefined ? {} : { maxConcurrency: overrides.maxConcurrency }),
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (request: unknown = body, token = secret) =>
    fetch(`${base}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ai-inference-token': token },
      body: JSON.stringify(request),
    });
  return { base, post, query, completion };
}

it('authenticates internal calls and loads the model token without accepting it in the body', async () => {
  const { post, query, completion } = await fixture();
  expect((await post(body, 'invalid')).status).toBe(401);
  expect(query).not.toHaveBeenCalled();
  expect((await post({ ...body, request: { ...body.request, apiToken: 'injected' } })).status).toBe(
    400
  );
  expect((await post({ ...body, apiToken: 'injected' })).status).toBe(400);
  expect(
    (await post({ ...body, expected: { ...body.expected, apiToken: 'injected' } })).status
  ).toBe(400);
  const response = await post();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ reply: 'done', tokenUsage: { input: 1, output: 2 } });
  expect(completion).toHaveBeenCalledWith(expect.objectContaining({ apiToken: 'provider-secret' }));
});

it('rejects stale model configuration before provider use', async () => {
  const { post, completion } = await fixture();
  const response = await post({ ...body, expected: { ...body.expected, modelName: 'old' } });
  expect(response.status).toBe(409);
  expect(completion).not.toHaveBeenCalled();
});

it.each([
  { is_enabled: false, last_test_status: 'passed' },
  { is_enabled: true, last_test_status: 'pending' },
  { is_enabled: true, last_test_status: 'failed' },
])('refuses a model that is no longer ready before provider I/O: %j', async (modelState) => {
  const { post, completion } = await fixture({ modelState });
  const response = await post();
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'AI_MODEL_CHANGED' });
  expect(completion).not.toHaveBeenCalled();
});

it('treats model database failure as worker unavailability rather than provider failure', async () => {
  const { post, query, completion } = await fixture();
  query.mockRejectedValueOnce(new Error('database unavailable'));
  const response = await post();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'AI_INFERENCE_UNAVAILABLE' });
  expect(completion).not.toHaveBeenCalled();
});

it('bounds provider work and reports saturation independently from liveness', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const { base, post } = await fixture({
    maxConcurrency: 1,
    completion: async () => {
      entered();
      await gate;
      return { reply: 'done', tokenUsage: { input: 1, output: 1 } };
    },
  });
  const first = post();
  await started;
  expect((await post()).status).toBe(503);
  expect(await (await fetch(`${base}/health/ready`)).json()).toMatchObject({
    status: 'ok',
    active: 1,
    saturated: true,
  });
  expect((await fetch(`${base}/health/live`)).status).toBe(200);
  release();
  expect((await first).status).toBe(200);
});

it('returns only a generic error if the provider fails', async () => {
  const { post } = await fixture({
    completion: async () => {
      throw new Error('provider-secret in error');
    },
  });
  const response = await post();
  expect(response.status).toBe(502);
  expect(await response.text()).toBe('{"error":"AI_INFERENCE_PROVIDER_FAILED"}');
});
