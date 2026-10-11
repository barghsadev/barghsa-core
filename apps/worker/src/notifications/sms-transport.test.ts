import { beforeEach, expect, it, vi } from 'vitest';
import { SmsNotificationTransport } from './sms-transport.js';

const { receipt, load, available, execute } = vi.hoisted(() => ({
  receipt: vi.fn(),
  load: vi.fn(),
  available: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('./send-receipt.js', () => ({
  readDeliveryReceipt: receipt,
  durableDelivery: () => execute,
}));
vi.mock('./channel-availability-loader.js', () => ({
  loadNotificationRecipient: load,
  assertNotificationRecipientAvailable: available,
}));
const recipient = { userId: 'owner', profileId: 'profile', mobile: '+989121234567', locale: 'fa' };
const payload = {
  outboxId: 'outbox',
  channel: 'sms' as const,
  recipientId: 'owner',
  profileId: 'profile',
  eventKey: 'profile.verification_status',
  idempotencyKey: 'verification-occurrence',
  payload: { messageFa: 'پیام آزمایشی تأیید پروفایل' },
};
beforeEach(() => {
  receipt.mockReset();
  receipt.mockResolvedValue(undefined);
  load.mockReset();
  load.mockResolvedValue(recipient);
  available.mockReset();
  available.mockResolvedValue(undefined);
  execute.mockReset();
  execute.mockImplementation(async (_provider, send) => send());
});
function setup(attempts = 0) {
  let snapshot: unknown = null;
  const query = vi.fn(async (sql: string, params?: unknown[]) => ({
    rows: sql.includes('SELECT delivery_payload')
      ? [{ delivery_payload: snapshot, attempts }]
      : sql.includes('FROM notification_templates')
        ? [
            {
              id: 'template',
              version: 2,
              variables: [{ name: 'messageFa' }],
              body_template: '{{messageFa}}',
            },
          ]
        : sql.includes('UPDATE notification_job SET delivery_payload')
          ? [{ delivery_payload: (snapshot ??= JSON.parse(params![1] as string)) }]
          : sql.includes('FROM sms_provider_configs') && !sql.includes('degraded_reason AS')
            ? [
                {
                  id: 'provider',
                  transport: 'smsir',
                  config: { api_key: 'fixture-only', sender: '3000', template_mappings: [] },
                },
              ]
            : sql.includes('rate_limit_rolling(')
              ? [{ count: 1, reset_ms: 1000 }]
              : sql.includes('clock_timestamp()')
                ? [{ now: new Date() }]
                : sql.includes('degraded_reason AS')
                  ? [
                      {
                        degraded: false,
                        degradedReason: null,
                        consecutiveFailures: 0,
                        windowFailures: 0,
                        openedAt: null,
                        cooldownUntil: null,
                      },
                    ]
                  : [],
  }));
  const request = vi
    .fn<typeof fetch>()
    .mockImplementation(
      async () => new Response(JSON.stringify({ status: 1, data: { messageIds: [321] } }))
    );
  const pool = { query };
  return {
    pool,
    request,
    transport: new SmsNotificationTransport(pool, request),
    snapshot: () => snapshot,
  };
}
it('freezes localized direct text before sending and reuses its durable receipt without another request', async () => {
  const { pool, request, transport, snapshot } = setup();
  expect(await transport.send(payload)).toEqual({ status: 'delivered', providerRef: '321' });
  expect(snapshot()).toMatchObject({
    version: 1,
    userId: 'owner',
    profileId: 'profile',
    templateId: 'template',
    templateVersion: 2,
    message: { mode: 'direct', sender: '3000', text: payload.payload.messageFa },
  });
  expect(available).toHaveBeenCalledWith(pool, 'outbox', payload.eventKey, 'sms', recipient);
  expect(JSON.parse(request.mock.calls[0]![1]!.body as string)).toEqual({
    lineNumber: 3000,
    messageText: payload.payload.messageFa,
    mobiles: ['09121234567'],
  });
  receipt.mockResolvedValue({ status: 'delivered', providerRef: '321' });
  expect(await transport.send(payload)).toEqual({ status: 'delivered', providerRef: '321' });
  expect(request).toHaveBeenCalledTimes(1);
});
it('refuses direct delivery after recipient revocation or a changed captured destination', async () => {
  const { request, transport } = setup();
  available.mockRejectedValueOnce(new Error('recipient revoked'));
  await expect(transport.send(payload)).rejects.toThrow('revoked');
  expect(request).not.toHaveBeenCalled();
  load.mockResolvedValue({ ...recipient, mobile: '+989121234568' });
  await expect(transport.send(payload)).rejects.toThrow('reconciliation');
  expect(request).not.toHaveBeenCalled();
});
it('never converts an already-attempted unsnapshotted legacy message into direct text', async () => {
  const { request, transport } = setup(1);
  await expect(transport.send(payload)).rejects.toThrow('Legacy SMS');
  expect(request).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});
