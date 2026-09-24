import { createServer } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { guardedRequest } from './guarded-http.js';
import { EMBEDDING_DIMENSIONS, OpenAiEmbeddingClient } from './embedding.js';

const previous = {
  base: process.env.KB_EMBEDDING_BASE_URL,
  key: process.env.KB_EMBEDDING_API_KEY,
  allowlist: process.env.AI_MODEL_BASE_URL_ALLOWLIST,
};
afterEach(() => {
  for (const [name, value] of [
    ['KB_EMBEDDING_BASE_URL', previous.base],
    ['KB_EMBEDDING_API_KEY', previous.key],
    ['AI_MODEL_BASE_URL_ALLOWLIST', previous.allowlist],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

it('blocks private destinations before sending an embedding request', async () => {
  await expect(
    guardedRequest('http://127.0.0.1:1234/embeddings', {
      method: 'POST',
      allowHttp: true,
      maxBytes: 1024,
    })
  ).rejects.toThrow('Destination host is not allowed');
});

it('sends a bounded embedding request and restores provider index order', async () => {
  const calls: unknown[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      calls.push({
        path: request.url,
        token: request.headers.authorization,
        body: JSON.parse(body),
      });
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          data: [
            { index: 1, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.2) },
            { index: 0, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1) },
          ],
        })
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing server port');
    process.env.KB_EMBEDDING_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.KB_EMBEDDING_API_KEY = 'test-only-secret';
    process.env.AI_MODEL_BASE_URL_ALLOWLIST = '127.0.0.1';
    const vectors = await new OpenAiEmbeddingClient().embed(['alpha', 'beta'], 'embed-1536');
    expect(vectors[0]?.[0]).toBe(0.1);
    expect(vectors[1]?.[0]).toBe(0.2);
    expect(calls).toEqual([
      {
        path: '/v1/embeddings',
        token: 'Bearer test-only-secret',
        body: { model: 'embed-1536', input: ['alpha', 'beta'], encoding_format: 'float' },
      },
    ]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
