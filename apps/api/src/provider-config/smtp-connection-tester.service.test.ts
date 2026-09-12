import { describe, it, expect, vi, beforeEach } from 'vitest';
import nodemailer from 'nodemailer';
import { SmtpConnectionTesterService } from './smtp-connection-tester.service';
import { SmtpNetworkGuard } from './smtp-network-guard';

describe('SmtpConnectionTesterService (T-05.06.02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const baseConfig = {
    host: 'smtp.example.com',
    port: 587,
    security: 'STARTTLS',
    connection_timeout: 10,
    command_timeout: 15,
    from_email: 'noreply@example.com',
  } as const;

  for (const security of ['STARTTLS', 'TLS'] as const) {
    it(`pins the checked address and retains the TLS hostname (${security})`, async () => {
      const resolve = vi
        .fn()
        .mockResolvedValueOnce(['93.184.216.34'])
        .mockResolvedValue(['127.0.0.1']);
      const transport = {
        verify: vi.fn(async () => true),
        sendMail: vi.fn(async () => ({ accepted: ['staff@example.com'] })),
        close: vi.fn(),
      };
      const create = vi
        .spyOn(nodemailer, 'createTransport')
        .mockReturnValue(transport as unknown as ReturnType<typeof nodemailer.createTransport>);
      const service = new SmtpConnectionTesterService(
        undefined,
        new SmtpNetworkGuard({ allowlist: [], resolve })
      );
      expect(await service.test({ ...baseConfig, security }, 'staff@example.com')).toMatchObject({
        ok: true,
      });
      expect(resolve).toHaveBeenCalledExactlyOnceWith(baseConfig.host);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          host: '93.184.216.34',
          secure: security === 'TLS',
          tls: expect.objectContaining({ servername: baseConfig.host, minVersion: 'TLSv1.2' }),
        })
      );
      expect(transport.verify).toHaveBeenCalledOnce();
      expect(transport.sendMail).toHaveBeenCalledOnce();
      expect(transport.close).toHaveBeenCalledOnce();
    });
  }

  it('sends a test message and requires recipient acceptance after the handshake', async () => {
    const verify = vi.fn(async () => true);
    const sendMail = vi.fn(async () => ({ accepted: ['staff@example.com'], rejected: [] }));
    const closed = vi.fn();
    const service = new SmtpConnectionTesterService(
      () => ({ verify, sendMail, close: closed }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
    );
    const result = await service.test(baseConfig, 'staff@example.com');
    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(verify).toHaveBeenCalledOnce();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'staff@example.com',
        from: 'noreply@example.com',
        text: expect.stringContaining('test'),
      })
    );
    expect(closed).toHaveBeenCalledOnce();
  });

  for (const result of [
    { accepted: [] },
    { accepted: ['other@example.com'] },
    { accepted: ['staff@example.com'], rejected: ['staff@example.com'] },
    {},
  ]) {
    it(`rejects an unconfirmed test send ${JSON.stringify(result)}`, async () => {
      const close = vi.fn();
      const service = new SmtpConnectionTesterService(
        () => ({ verify: async () => true, sendMail: async () => result, close }),
        new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
      );
      expect(await service.test(baseConfig, 'staff@example.com')).toMatchObject({
        ok: false,
        error: expect.stringContaining('did not accept'),
      });
      expect(close).toHaveBeenCalledOnce();
    });
  }
  it('does not create a transport without a test recipient', async () => {
    const factory = vi.fn();
    const service = new SmtpConnectionTesterService(factory);
    expect(await service.test(baseConfig, '')).toMatchObject({ ok: false });
    expect(factory).not.toHaveBeenCalled();
  });
  it('redacts a failed send after a successful handshake and closes the connection', async () => {
    const password = 'private-fixture-password',
      close = vi.fn();
    const service = new SmtpConnectionTesterService(
      () => ({
        verify: async () => true,
        sendMail: async () => {
          throw new Error(`delivery rejected ${password}`);
        },
        close,
      }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
    );
    const result = await service.test({ ...baseConfig, password }, 'staff@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(password);
    expect(close).toHaveBeenCalledOnce();
  });
  it('checks authorization again after the handshake and before sending', async () => {
    const sendMail = vi.fn(),
      verify = vi.fn(async () => true);
    const beforeSend = vi.fn(async () => {
      throw new Error('expired');
    });
    const service = new SmtpConnectionTesterService(
      () => ({ verify, sendMail }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
    );
    expect(await service.test(baseConfig, 'staff@example.com', beforeSend)).toMatchObject({
      ok: false,
    });
    expect(verify).toHaveBeenCalledOnce();
    expect(beforeSend).toHaveBeenCalledOnce();
    expect(sendMail).not.toHaveBeenCalled();
  });
  it('returns a failing result when the handshake rejects', async () => {
    const service = new SmtpConnectionTesterService(
      () => ({
        sendMail: async () => ({ accepted: [] }),
        verify: async () => {
          throw new Error('535 5.7.8 Authentication credentials invalid');
        },
      }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
    );
    const result = await service.test(baseConfig, 'staff@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Authentication credentials');
  });

  it('redacts the configured password from error messages', async () => {
    const secret = 'super-secret-pw-123';
    const service = new SmtpConnectionTesterService(
      () => ({
        sendMail: async () => ({ accepted: [] }),
        verify: async () => {
          throw new Error(`login failed for "${secret}"`);
        },
      }),
      new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
    );
    const result = await service.test(
      { ...baseConfig, username: 'bob', password: secret },
      'staff@example.com'
    );
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain(secret);
    expect(result.error).toContain('••••');
  });

  for (const diagnostic of ['', 'x'.repeat(3000)]) {
    it(`bounds SMTP diagnostic length ${diagnostic.length}`, async () => {
      const service = new SmtpConnectionTesterService(
        () => ({
          sendMail: async () => ({ accepted: [] }),
          verify: async () => {
            throw new Error(diagnostic);
          },
        }),
        new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
      );
      const result = await service.test(baseConfig, 'staff@example.com');
      expect(result).toMatchObject({
        ok: false,
        error: diagnostic ? diagnostic.slice(0, 1000) : 'SMTP handshake failed',
      });
    });
  }
  it('rejects a private destination before any transport is created', async () => {
    const createTransport = vi.fn();
    const guard = new SmtpNetworkGuard({ resolve: async () => ['10.0.0.1'] });
    const service = new SmtpConnectionTesterService(createTransport, guard);
    const result = await service.test(baseConfig, 'staff@example.com');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('blocked');
    // createTransport must never be called for a blocked destination.
    expect(createTransport).not.toHaveBeenCalled();
  });
  for (const [error, transient] of [
    [Object.assign(new Error('temporary'), { responseCode: 451 }), true],
    [Object.assign(new Error('permanent'), { responseCode: 550 }), false],
    [Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }), true],
    [Object.assign(new Error('auth'), { code: 'EAUTH' }), false],
  ] as const) {
    it(`classifies SMTP ${error.message} for provider health`, async () => {
      const service = new SmtpConnectionTesterService(
        () => ({
          verify: async () => {
            throw error;
          },
          sendMail: vi.fn(),
        }),
        new SmtpNetworkGuard({ resolve: async () => ['93.184.216.34'] })
      );
      expect(await service.test(baseConfig, 'staff@example.com')).toMatchObject({
        ok: false,
        transient,
      });
    });
  }
});
