const breaker = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('./email-breaker.js', () => ({
  EmailCircuitBreaker: class {
    async decision() {
      return { allow: true, kind: 'closed' };
    }
    async recordOutcome() {
      await breaker.record();
    }
  },
}));
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createEmailSender } from './email.js';

let server: Server, endpoint: string;
let code = 200,
  body: unknown = { id: 'provider-receipt' };
const received: Array<{ key: string | undefined; body: Record<string, unknown> }> = [];
beforeAll(async () => {
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    received.push({
      key: req.headers['idempotency-key'] as string | undefined,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test endpoint');
  endpoint = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});
const message = {
  destination: 'staff@example.test',
  subject: 'Test invoice',
  html: '<p>5000</p>',
  idempotencyKey: 'stable-test-key',
};
function setup(
  suppressed = false,
  provider = true,
  execute?: Parameters<typeof createEmailSender>[2]
) {
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('email_suppressions')
      ? suppressed
        ? [{ id: 'suppression' }]
        : []
      : provider
        ? [
            {
              id: 'provider',
              transport: 'resend',
              config: { api_key: 'local-test-only', from_email: 'sender@example.test' },
            },
          ]
        : [],
  }));
  const request = vi.fn<typeof fetch>(async (_url, options) => fetch(endpoint, options));
  return { send: createEmailSender({ query }, request, execute), request };
}

it('places durable execution after preflight and preserves acceptance when health recording fails', async () => {
  code = 200;
  body = { id: 'durable-receipt' };
  const seen: string[] = [];
  const execute = vi.fn<NonNullable<Parameters<typeof createEmailSender>[2]>>(
    async (provider, send) => {
      expect(provider).toEqual({ id: 'provider', transport: 'resend' });
      seen.push('started');
      const receipt = await send();
      seen.push(receipt);
      return receipt;
    }
  );
  const { send, request } = setup(false, true, execute);
  breaker.record.mockRejectedValueOnce(new Error('database unavailable after acceptance'));
  expect(await send(message)).toBe('durable-receipt');
  expect(seen).toEqual(['started', 'durable-receipt']);
  expect(request).toHaveBeenCalledOnce();
  execute.mockClear();
  await expect(setup(true, true, execute).send(message)).rejects.toThrow('suppressed');
  expect(execute).not.toHaveBeenCalled();
  execute.mockResolvedValueOnce('previously-stored-receipt');
  const cached = setup(false, true, execute);
  expect(await cached.send(message)).toBe('previously-stored-receipt');
  expect(cached.request).not.toHaveBeenCalled();
  execute.mockRejectedValueOnce(new Error('cannot persist send intent'));
  const blocked = setup(false, true, execute);
  await expect(blocked.send(message)).rejects.toThrow('cannot persist');
  expect(blocked.request).not.toHaveBeenCalled();
});
it('sends the selected content and stable key through the HTTP boundary', async () => {
  code = 200;
  body = { id: 'provider-receipt' };
  const { send } = setup();
  expect(await send(message)).toBe('provider-receipt');
  expect(await send(message)).toBe('provider-receipt');
  expect(received.slice(-2).map((item) => item.key)).toEqual([
    'stable-test-key',
    'stable-test-key',
  ]);
  expect(received.at(-1)?.body).toMatchObject({
    to: ['staff@example.test'],
    subject: 'Test invoice',
    html: '<p>5000</p>',
  });
});
it('rejects provider failures and successful responses with no receipt', async () => {
  const { send } = setup();
  code = 503;
  body = { error: 'test outage' };
  await expect(send(message)).rejects.toThrow('rejected');
  code = 200;
  body = {};
  await expect(send(message)).rejects.toThrow('no receipt');
});
it('does not contact a provider for suppressed addresses, unavailable configuration, invalid headers or cancellation', async () => {
  for (const [suppressed, provider] of [
    [true, true],
    [false, false],
  ] as const) {
    const { send, request } = setup(suppressed, provider);
    await expect(send(message)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  }
  const { send, request } = setup();
  await expect(send({ ...message, subject: 'Header\r\nInjection' })).rejects.toThrow('Invalid');
  await expect(send({ ...message, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it('refuses to replay an occurrence through a replacement provider', async () => {
  const { send, request } = setup();
  await expect(send({ ...message, expectedProviderId: 'previous-provider' })).rejects.toThrow(
    'requires reconciliation'
  );
  expect(request).not.toHaveBeenCalled();
});
