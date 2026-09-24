import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { completeChat } from './completion.js';

const previous = process.env.AI_MODEL_BASE_URL_ALLOWLIST;
afterEach(() => {
  if (previous === undefined) delete process.env.AI_MODEL_BASE_URL_ALLOWLIST;
  else process.env.AI_MODEL_BASE_URL_ALLOWLIST = previous;
});

it('sends an OpenAI-compatible completion with bounded settings', async () => {
  let requestBody: unknown;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      requestBody = {
        path: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      };
      response.end(
        JSON.stringify({
          choices: [{ message: { content: 'Hello' } }],
          usage: { prompt_tokens: 3, completion_tokens: 2 },
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No port');
    process.env.AI_MODEL_BASE_URL_ALLOWLIST = '127.0.0.1';
    const result = await completeChat({
      providerType: 'openai_compatible',
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      modelName: 'test',
      apiToken: 'secret',
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0.2,
      maxTokens: 100,
    });
    expect(result).toEqual({ reply: 'Hello', tokenUsage: { input: 3, output: 2 } });
    expect(requestBody).toEqual({
      path: '/v1/chat/completions',
      authorization: 'Bearer secret',
      body: {
        model: 'test',
        max_tokens: 100,
        temperature: 0.2,
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('blocks private destinations without an allowlist', async () => {
  await expect(
    completeChat({
      providerType: 'anthropic',
      baseUrl: 'http://127.0.0.1:1',
      modelName: 'test',
      apiToken: null,
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 0,
      maxTokens: 20,
    })
  ).rejects.toThrow();
});
