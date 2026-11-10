import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  ResendConnectionTesterService,
  type ResendApiClientLike,
} from './resend-connection-tester.service';
import type { ResendConfig } from './resend-config.schema';

describe('ResendConnectionTesterService (T-05.06.03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const verifiedDomains = { data: [{ id: 'd1', name: 'example.com', status: 'verified' }] };

  const baseConfig: ResendConfig = {
    api_key: 're_secret-key-123',
    from_name: 'Barghsa',
    from_email: 'no-reply@example.com',
  };

  const fakeClient = (overrides: Partial<ResendApiClientLike>): ResendApiClientLike => ({
    listDomains: async () => [{ id: 'd1', name: 'example.com', status: 'verified' }],
    sendEmail: async () => ({ id: 'email_123' }),
    ...overrides,
  });

  it('checks and sends only at the fixed Resend endpoints with deadlines and no redirects', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(verifiedDomains))
      .mockResolvedValueOnce(Response.json({ id: 'email_1' }));
    vi.stubGlobal('fetch', request);
    try {
      const service = new ResendConnectionTesterService();
      expect(await service.test(baseConfig, 'staff@example.com')).toEqual({ ok: true });
      expect(request).toHaveBeenCalledTimes(2);
      const options = { redirect: 'error', signal: expect.any(AbortSignal) };
      expect(request).toHaveBeenNthCalledWith(
        1,
        'https://api.resend.com/domains',
        expect.objectContaining(options)
      );
      expect(request).toHaveBeenNthCalledWith(
        2,
        'https://api.resend.com/emails',
        expect.objectContaining({ ...options, method: 'POST' })
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    [false, { ...verifiedDomains, padding: 'x'.repeat(2 * 1024 * 1024) }, 200, 'size limit'],
    [false, { data: [null] }, 200, 'invalid domain list'],
    [true, { id: 'valid-looking', padding: 'x'.repeat(64 * 1024) }, 200, 'size limit'],
    [true, { message: 'private-diagnostic'.repeat(8192) }, 503, 'HTTP 503'],
  ] as const)(
    'rejects untrusted Resend response %# without another send',
    async (send, body, status, error) => {
      const request = vi.fn<typeof fetch>();
      if (send) request.mockResolvedValueOnce(Response.json(verifiedDomains));
      request.mockResolvedValueOnce(Response.json(body, { status }));
      vi.stubGlobal('fetch', request);
      try {
        const service = new ResendConnectionTesterService();
        const result = await service.test(baseConfig, 'staff@example.com');
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining(error) });
        expect(result.error).not.toContain('private-diagnostic');
        expect(request).toHaveBeenCalledTimes(send ? 2 : 1);
      } finally {
        vi.unstubAllGlobals();
      }
    }
  );

  it('keeps malformed provider bytes out of the connection diagnostic', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private-malformed-body'));
    vi.stubGlobal('fetch', request);
    try {
      const result = await new ResendConnectionTesterService().test(
        baseConfig,
        'staff@example.com'
      );
      expect(result).toMatchObject({ ok: false, error: expect.stringContaining('valid JSON') });
      expect(result.error).not.toContain('private-malformed-body');
      expect(request).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('returns ok when the domain is verified and the test-send succeeds', async () => {
    const sendEmail: ResendApiClientLike['sendEmail'] = vi.fn(async () => ({ id: 'email_1' }));
    const client = fakeClient({ sendEmail });
    const service = new ResendConnectionTesterService(client);
    const result = await service.test(baseConfig, 'admin@example.com');
    expect(result.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalledOnce();
    const payload = vi.mocked(sendEmail).mock.calls[0]![1];
    expect(payload.to).toBe('admin@example.com');
    expect(payload.from).toContain('Barghsa');
    expect(payload.from).toContain('no-reply@example.com');
  });

  it('checks authorization after the domain lookup and before sending', async () => {
    const sendEmail = vi.fn(),
      beforeSend = vi.fn(async () => {
        throw new Error('expired');
      });
    const service = new ResendConnectionTesterService(fakeClient({ sendEmail }));
    expect(await service.test(baseConfig, 'admin@example.com', beforeSend)).toMatchObject({
      ok: false,
    });
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(sendEmail).not.toHaveBeenCalled();
  });
  it('uses from_email domain when sending_domain is absent', async () => {
    const listDomains = vi.fn(async () => [{ id: 'd1', name: 'example.com', status: 'verified' }]);
    const service = new ResendConnectionTesterService(fakeClient({ listDomains }));
    await service.test(baseConfig, 'admin@example.com');
    // only called once (no extra sends), the domain derives from from_email.
    expect(listDomains).toHaveBeenCalledOnce();
  });

  it('fails when the sending domain is not registered in the account', async () => {
    const client = fakeClient({ listDomains: async () => [] });
    const service = new ResendConnectionTesterService(client);
    const result = await service.test(baseConfig, 'admin@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not registered');
  });

  it('fails when the sending domain is not yet verified', async () => {
    const client = fakeClient({
      listDomains: async () => [{ id: 'd1', name: 'example.com', status: 'pending' }],
    });
    const service = new ResendConnectionTesterService(client);
    const result = await service.test(baseConfig, 'admin@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not verified');
  });

  it('falls back to sending_domain when explicitly configured', async () => {
    const listDomains = vi.fn(async () => [
      { id: 'd1', name: 'marketing.example.com', status: 'verified' },
    ]);
    const service = new ResendConnectionTesterService(fakeClient({ listDomains }));
    const result = await service.test(
      { ...baseConfig, from_email: 'no-reply@other.com', sending_domain: 'marketing.example.com' },
      'admin@example.com'
    );
    expect(result.ok).toBe(true);
    // listDomains was called; the marketing domain had to be looked up.
    expect(listDomains).toHaveBeenCalledOnce();
  });

  it('fails when the test-send is rejected by Resend', async () => {
    const client = fakeClient({ sendEmail: async () => ({ message: 'domain not verified' }) });
    const service = new ResendConnectionTesterService(client);
    const result = await service.test(baseConfig, 'admin@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('domain not verified');
  });

  it('redacts the api_key from error messages', async () => {
    const secret = 'secret-test-key-123';
    const client = fakeClient({
      sendEmail: async () => ({ message: `unauthorized for key ${secret}` }),
    });
    const service = new ResendConnectionTesterService(client);
    const result = await service.test({ ...baseConfig, api_key: secret }, 'admin@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(secret);
    expect(result.error).toContain('••••');
  });

  it('handles a thrown error from the API client', async () => {
    const client = fakeClient({
      listDomains: async () => {
        throw new Error('HTTP 401 unauthorized');
      },
    });
    const service = new ResendConnectionTesterService(client);
    const result = await service.test(baseConfig, 'admin@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not verify sending domain');
  });

  it.each(['domain lookup', 'test-send'] as const)(
    'bounds private %s failure diagnostics',
    async (phase) => {
      const recipient = 'private-recipient@example.test';
      const diagnostic = `temporary refusal for ${recipient} and ${baseConfig.api_key}`;
      const client = fakeClient(
        phase === 'domain lookup'
          ? {
              listDomains: async () => {
                throw new Error(diagnostic);
              },
            }
          : { sendEmail: async () => ({ message: diagnostic }) }
      );
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const result = await new ResendConnectionTesterService(client).test(baseConfig, recipient);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('temporary refusal');
      expect(result.error).not.toContain(recipient);
      expect(result.error).not.toContain(baseConfig.api_key);
      expect(warn).toHaveBeenCalledExactlyOnceWith(`Resend ${phase} failed`);
    }
  );
  for (const phase of ['domain', 'send'])
    for (const status of [401, 429, 503]) {
      it(`classifies actual Resend ${phase} HTTP ${status} response`, async () => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async (url: string) => {
            if (phase === 'send' && url.endsWith('/domains'))
              return new Response(
                JSON.stringify({
                  data: [{ id: 'domain', name: 'example.com', status: 'verified' }],
                })
              );
            return new Response(JSON.stringify({ message: 'Provider refused request' }), {
              status,
            });
          })
        );
        try {
          const service = new ResendConnectionTesterService();
          expect(await service.test(baseConfig, 'staff@example.com')).toMatchObject({
            ok: false,
            transient: status !== 401,
          });
        } finally {
          vi.unstubAllGlobals();
        }
      });
    }
});
