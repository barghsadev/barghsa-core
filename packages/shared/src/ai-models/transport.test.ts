import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type RequestListener } from 'node:http';
import { once } from 'node:events';
import { promises as dns, type LookupAddress } from 'node:dns';

const resolver: {
  lookup(host: string, options: { all: true; verbatim: true }): Promise<LookupAddress[]>;
} = dns;
import { AiModelTester } from './tester.js';

async function withProvider(handler: RequestListener, run: (port: number) => Promise<void>) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  try {
    await run(address.port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
function test(
  baseUrl: string,
  providerType: 'openai_compatible' | 'anthropic' = 'openai_compatible'
) {
  return new AiModelTester().test({
    providerType,
    baseUrl,
    modelName: 'local-test',
    apiToken: 'local-only-token',
  });
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('AI provider socket transport', () => {
  it('rejects a private DNS answer at connection time after a public preflight', async () => {
    const hits = vi.fn();
    await withProvider(hits, async (port) => {
      vi.stubEnv('AI_MODEL_BASE_URL_ALLOWLIST', '');
      const resolve = vi.spyOn(resolver, 'lookup');
      resolve.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
      resolve.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
      const result = await test(`http://rebind.example.test:${port}/v1`);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not allowed');
      expect(resolve).toHaveBeenCalledTimes(2);
      expect(hits).not.toHaveBeenCalled();
    });
  });

  it.each(['openai_compatible', 'anthropic'] as const)(
    'preserves the allowed host and %s request shape',
    async (providerType) => {
      let received: unknown;
      await withProvider(
        (request, response) => {
          const chunks: Buffer[] = [];
          request.on('data', (chunk: Buffer) => chunks.push(chunk));
          request.on('end', () => {
            received = {
              host: request.headers.host,
              authorization: request.headers.authorization,
              apiKey: request.headers['x-api-key'],
              path: request.url,
              body: JSON.parse(Buffer.concat(chunks).toString()),
            };
            response.end(
              JSON.stringify(
                providerType === 'anthropic'
                  ? { content: [{ text: 'pong' }] }
                  : { choices: [{ message: { content: 'pong' } }] }
              )
            );
          });
        },
        async (port) => {
          vi.stubEnv('AI_MODEL_BASE_URL_ALLOWLIST', 'local-provider.example.test');
          const resolve = vi
            .spyOn(resolver, 'lookup')
            .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
          expect(
            await test(`http://local-provider.example.test:${port}/v1`, providerType)
          ).toMatchObject({
            ok: true,
            responsePreview: 'pong',
          });
          expect(resolve).toHaveBeenCalledOnce();
          expect(received).toMatchObject({
            host: `local-provider.example.test:${port}`,
            ...(providerType === 'anthropic'
              ? { apiKey: 'local-only-token', authorization: undefined, path: '/v1/messages' }
              : {
                  authorization: 'Bearer local-only-token',
                  apiKey: undefined,
                  path: '/v1/chat/completions',
                }),
            body: { model: 'local-test', max_tokens: 1 },
          });
        }
      );
    }
  );

  it('rejects oversized responses and closes the provider connection', async () => {
    let closed = false;
    await withProvider(
      (_request, response) => {
        response.on('close', () => {
          closed = true;
        });
        response.write(Buffer.alloc(70_000));
      },
      async (port) => {
        vi.stubEnv('AI_MODEL_BASE_URL_ALLOWLIST', '127.0.0.1');
        expect(await test(`http://127.0.0.1:${port}/v1`)).toMatchObject({
          ok: false,
          error: expect.stringContaining('exceeds size limit'),
        });
        await expect.poll(() => closed).toBe(true);
      }
    );
  });

  it('does not follow a provider redirect', async () => {
    let hits = 0;
    await withProvider(
      (_request, response) => {
        hits++;
        response.writeHead(302, { location: '/private' });
        response.end();
      },
      async (port) => {
        vi.stubEnv('AI_MODEL_BASE_URL_ALLOWLIST', '127.0.0.1');
        expect(await test(`http://127.0.0.1:${port}/v1`)).toMatchObject({
          ok: false,
          error: expect.stringContaining('redirects'),
        });
        expect(hits).toBe(1);
      }
    );
  });

  it('aborts a provider that never replies', async () => {
    await withProvider(
      () => {},
      async (port) => {
        vi.stubEnv('AI_MODEL_BASE_URL_ALLOWLIST', '127.0.0.1');
        vi.stubEnv('AI_MODEL_TEST_TIMEOUT_MS', '1000');
        expect(await test(`http://127.0.0.1:${port}/v1`)).toMatchObject({ ok: false });
      }
    );
  });
});

it('bounds a stalled DNS preflight without starting the transport', async () => {
  vi.useFakeTimers();
  vi.stubEnv('AI_MODEL_BASE_URL_ALLOWLIST', '');
  vi.stubEnv('AI_MODEL_TEST_TIMEOUT_MS', '1000');
  const lookup = vi.spyOn(resolver, 'lookup').mockReturnValue(new Promise(() => {}));
  const pending = test('http://stalled.example.test/v1');
  await vi.advanceTimersByTimeAsync(1000);
  expect(await pending).toMatchObject({
    ok: false,
    error: expect.stringContaining('lookup timed out'),
  });
  expect(lookup).toHaveBeenCalledOnce();
});
