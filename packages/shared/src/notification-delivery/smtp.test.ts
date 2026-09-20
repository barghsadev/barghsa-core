vi.mock('./email-breaker.js', () => ({
  EmailCircuitBreaker: class {
    async decision() {
      return { allow: true, kind: 'closed' };
    }
    async recordOutcome() {}
  },
}));
import { beforeEach, expect, it, vi } from 'vitest';
import { createEmailSender } from './email.js';
const { lookup, createTransport, sendMail, close } = vi.hoisted(() => ({
  lookup: vi.fn(),
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  close: vi.fn(),
}));
vi.mock('node:dns/promises', () => ({ lookup }));
vi.mock('nodemailer', () => ({ default: { createTransport } }));
beforeEach(() => {
  vi.resetAllMocks();
  lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  createTransport.mockReturnValue({ sendMail, close });
  sendMail.mockResolvedValue({
    accepted: ['staff@example.test'],
    rejected: [],
    messageId: 'smtp-receipt',
  });
});
function sender(execute?: Parameters<typeof createEmailSender>[2]) {
  return createEmailSender(
    {
      query: async (sql) => ({
        rows: sql.includes('email_suppressions')
          ? []
          : [
              {
                id: 'smtp-provider',
                transport: 'smtp',
                config: {
                  host: 'mail.example.test',
                  from_email: 'sender@example.test',
                  security: 'STARTTLS',
                  username: 'test-only',
                  password: 'test-only',
                },
              },
            ],
      }),
    },
    undefined,
    execute
  );
}
const message = {
  destination: 'staff@example.test',
  subject: 'Invoice',
  text: '5000',
  idempotencyKey: 'same-occurrence',
};
it('runs the durable owner after network preflight and can recover without sending again', async () => {
  const execute = vi.fn<NonNullable<Parameters<typeof createEmailSender>[2]>>(
    async (provider, send) => {
      expect(provider).toEqual({ id: 'smtp-provider', transport: 'smtp' });
      expect(sendMail).not.toHaveBeenCalled();
      return send();
    }
  );
  expect(await sender(execute)(message)).toBe('smtp-receipt');
  sendMail.mockClear();
  execute.mockResolvedValueOnce('stored-smtp-receipt');
  expect(await sender(execute)(message)).toBe('stored-smtp-receipt');
  expect(sendMail).not.toHaveBeenCalled();
  execute.mockClear();
  lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  await expect(sender(execute)(message)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});
it('does not send or leave an unhandled cancellation when the claim owner delays dispatch', async () => {
  const controller = new AbortController();
  const execute: NonNullable<Parameters<typeof createEmailSender>[2]> = async (_provider, send) => {
    controller.abort();
    return send();
  };
  await expect(sender(execute)({ ...message, signal: controller.signal })).rejects.toThrow();
  expect(sendMail).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
it('pins the checked address, requires TLS and keeps stable message IDs across retries', async () => {
  const send = sender();
  expect(await send(message)).toBe('smtp-receipt');
  expect(await send(message)).toBe('smtp-receipt');
  expect(createTransport).toHaveBeenCalledWith(
    expect.objectContaining({
      host: '8.8.8.8',
      requireTLS: true,
      tls: { servername: 'mail.example.test', minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true,
    })
  );
  expect(sendMail.mock.calls[0]![0].messageId).toBe(sendMail.mock.calls[1]![0].messageId);
  expect(close).toHaveBeenCalledTimes(2);
});
it('refuses private SMTP addresses before opening a connection', async () => {
  lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  await expect(sender()(message)).rejects.toThrow();
  expect(createTransport).not.toHaveBeenCalled();
});
it('requires recipient acceptance and closes the connection after failure', async () => {
  sendMail.mockResolvedValue({
    accepted: [],
    rejected: ['staff@example.test'],
    messageId: 'not-delivered',
  });
  await expect(sender()(message)).rejects.toThrow('recipient rejected');
  expect(close).toHaveBeenCalled();
});
it('aborts an outstanding send when its worker claim is lost', async () => {
  sendMail.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const result = sender()({ ...message, signal: controller.signal });
  const assertion = expect(result).rejects.toThrow('cancelled');
  await vi.waitFor(() => expect(sendMail).toHaveBeenCalled());
  controller.abort();
  await assertion;
  expect(close).toHaveBeenCalled();
});
