import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { ChatCompletionInput } from '@barghsa/shared/ai-models';
import {
  completeViaAiWorker,
  isAiInfrastructureError,
  readAiWorkerHealth,
} from './ai-inference-client.js';

const input: ChatCompletionInput = {
  providerType: 'openai_compatible',
  baseUrl: 'https://provider.example.test/v1',
  modelName: 'model-a',
  apiToken: 'provider-secret',
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0,
  maxTokens: 10,
};
const modelId = '11001100-1100-7100-8100-110011001100';
const servers: Server[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

async function worker(status: number, payload: unknown, location?: string) {
  const bodies: string[] = [];
  const headers: Array<string | undefined> = [];
  const server = createServer(async (req, res) => {
    headers.push(req.headers['x-ai-inference-token'] as string | undefined);
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    bodies.push(body);
    res.writeHead(status, {
      'content-type': 'application/json',
      ...(location ? { location } : {}),
    });
    res.end(JSON.stringify(payload));
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const url = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('AI_INFERENCE_URL', url);
  vi.stubEnv('AI_INFERENCE_SHARED_SECRET', 'internal-secret');
  return { bodies, headers, url };
}

it('proxies the prompt without sending the provider token', async () => {
  const { bodies, headers } = await worker(200, {
    reply: 'answer',
    tokenUsage: { input: 3, output: 2 },
  });
  expect(await completeViaAiWorker(modelId, input)).toEqual({
    reply: 'answer',
    tokenUsage: { input: 3, output: 2 },
  });
  expect(headers).toEqual(['internal-secret']);
  expect(bodies[0]).toContain('hello');
  expect(bodies[0]).not.toContain('provider-secret');
});

it('preserves worker saturation without marking a provider failure', async () => {
  await worker(503, { error: 'AI_INFERENCE_BUSY' });
  try {
    await completeViaAiWorker(modelId, input);
    expect.fail('busy worker should reject');
  } catch (error) {
    expect(isAiInfrastructureError(error)).toBe(true);
    expect(error).toMatchObject({ status: 503 });
  }
});

it('fails closed on an unavailable worker or malformed reply', async () => {
  await worker(200, { reply: '', tokenUsage: null });
  await expect(completeViaAiWorker(modelId, input)).rejects.toMatchObject({ status: 503 });
  vi.stubEnv('AI_INFERENCE_SHARED_SECRET', '');
  await expect(completeViaAiWorker(modelId, input)).rejects.toMatchObject({ status: 503 });
});

it('reads bounded worker health without affecting core readiness', async () => {
  await worker(200, { status: 'ok', active: 2, maxConcurrency: 10, saturated: false });
  expect(await readAiWorkerHealth()).toEqual({
    status: 'ok',
    active: 2,
    maxConcurrency: 10,
    saturated: false,
  });
});

it('refuses cross-origin redirects for completion and health without contacting the target', async () => {
  const destination = await worker(200, { reply: 'redirected', tokenUsage: null });
  const source = await worker(307, {}, destination.url);

  await expect(completeViaAiWorker(modelId, input)).rejects.toMatchObject({ status: 503 });
  expect(await readAiWorkerHealth()).toMatchObject({ status: 'unavailable' });
  expect(source.headers).toEqual(['internal-secret', undefined]);
  expect(source.bodies[0]).toContain('hello');
  expect(destination.headers).toEqual([]);
  expect(destination.bodies).toEqual([]);
});

it.each([
  [200, { reply: 'answer', tokenUsage: null, padding: 'a'.repeat(256 * 1024) }],
  [503, { error: 'AI_INFERENCE_BUSY', padding: 'a'.repeat(4 * 1024) }],
])('rejects an oversized completion response with HTTP %s', async (status, payload) => {
  await worker(status, payload);
  await expect(completeViaAiWorker(modelId, input)).rejects.toMatchObject({
    status: 503,
    response: { error: 'AI_INFERENCE_UNAVAILABLE' },
  });
});

it('accepts an escaped reply at the existing character limit', async () => {
  const reply = '\u0001'.repeat(32_000);
  await worker(200, { reply, tokenUsage: null });
  expect(await completeViaAiWorker(modelId, input)).toEqual({ reply, tokenUsage: null });
});

it('ignores an oversized worker health response', async () => {
  await worker(200, {
    status: 'ok',
    active: 2,
    maxConcurrency: 10,
    saturated: false,
    padding: 'a'.repeat(4 * 1024),
  });
  expect(await readAiWorkerHealth()).toEqual({
    status: 'unavailable',
    active: null,
    maxConcurrency: null,
    saturated: null,
  });
});
