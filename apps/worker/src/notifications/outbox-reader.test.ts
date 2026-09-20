import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { dispatchOutbox, type OutboxRow } from './outbox-reader.js';
import type {
  INotificationTransport,
  NotificationChannel,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications';
import {
  PAYMENT_INVOICE_REMINDER_EVENT_KEY,
  reminderOutboxIdempotencyKey,
} from '../invoices/reminder-sender.js';

/**
 * Base outbox reader unit tests.
 *
 * `dispatchOutbox` is the pure, DB-free part of the scaffold (it fans a
 * claimed outbox row out to registered transports). The lease/Dispatch loop
 * against a real pool is covered at integration/e2e level (T-05.01.02).
 */

class FakeTransport implements INotificationTransport {
  readonly channel: NotificationChannel;
  reads: NotificationSendPayload[] = [];

  constructor(channel: NotificationChannel) {
    this.channel = channel;
  }

  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    this.reads.push(payload);
    return { providerRef: `ref_${payload.channel}`, status: 'delivered' };
  }
}

const row: OutboxRow = {
  id: '00000000-0000-7000-0000-000000000001',
  profileId: '00000000-0000-7000-0000-0000000000p1',
  userId: 'user-1',
  eventKey: 'profile_verified',
  payload: { name: 'Ali' },
  channels: ['in_app', 'email'],
  idempotencyKey: 'abc123',
  attempts: 0,
  maxAttempts: 5,
  scheduledAt: null,
  lastError: null,
};

describe('dispatchOutbox', () => {
  it('keeps parallel delivery traces separate and outside customer variables', async () => {
    const output = vi.spyOn(console, 'info').mockImplementation(() => {});
    const email = new FakeTransport('email');
    const rows = [
      '01900000-0000-7000-8000-000000000001',
      '01900000-0000-7000-8000-000000000002',
    ].map((id) => ({
      ...row,
      id,
      correlationId: id,
      channels: ['email'] as NotificationChannel[],
      payload: { privateMessage: 'customer-content' },
    }));
    try {
      await Promise.all(rows.map((item) => dispatchOutbox(item, { email })));
      expect(
        email.reads.map((message) => [message.outboxId, message.correlationId]).sort()
      ).toEqual(rows.map((item) => [item.id, item.correlationId]).sort());
      for (const message of email.reads)
        expect(message.payload).toEqual({ privateMessage: 'customer-content' });
      const logs = output.mock.calls.map(([message]) => JSON.parse(String(message)));
      expect(logs.map((item) => [item.outboxId, item.correlationId]).sort()).toEqual(
        rows.map((item) => [item.id, item.correlationId]).sort()
      );
      expect(JSON.stringify(logs)).not.toContain('customer-content');
      await dispatchOutbox({ ...row, channels: ['email'] }, { email });
      expect(JSON.parse(String(output.mock.lastCall![0])).correlationId).toBeNull();
    } finally {
      output.mockRestore();
    }
  });

  it('delivers to each registered channel with a matching payload', async () => {
    const inApp = new FakeTransport('in_app');
    const email = new FakeTransport('email');
    const outcomes = await dispatchOutbox(row, { in_app: inApp, email });

    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((o) => o.channel)).toEqual(['in_app', 'email']);
    expect(outcomes.every((o) => o.result.status === 'delivered')).toBe(true);

    expect(inApp.reads[0]!.idempotencyKey).toMatch(/^[0-9a-f]{64}$/);
    expect(inApp.reads[0]!.recipientId).toBe('user-1');
    expect(email.reads[0]!.channel).toBe('email');
    expect(email.reads[0]!.providerRef).toBeUndefined();
  });

  it('gives each channel a distinct per-channel idempotency key (T-05.01.04)', async () => {
    const inApp = new FakeTransport('in_app');
    const email = new FakeTransport('email');
    await dispatchOutbox(row, { in_app: inApp, email });

    const inAppKey = inApp.reads[0]!.idempotencyKey;
    const emailKey = email.reads[0]!.idempotencyKey;
    expect(inAppKey).toMatch(/^[0-9a-f]{64}$/);
    expect(emailKey).toMatch(/^[0-9a-f]{64}$/);
    // Different channels ⇒ different keys for the same event/profile.
    expect(inAppKey).not.toBe(emailKey);
  });

  it('derives a stable per-channel key across retries of the same row (T-05.01.04)', async () => {
    const inApp = new FakeTransport('in_app');
    const email = new FakeTransport('email');
    await dispatchOutbox(row, { in_app: inApp, email });
    await dispatchOutbox(row, { in_app: inApp, email });
    expect(inApp.reads[0]!.idempotencyKey).toBe(inApp.reads[1]!.idempotencyKey);
    expect(email.reads[0]!.idempotencyKey).toBe(email.reads[1]!.idempotencyKey);
  });

  it('gives distinct transport keys to two reminder rows for the same profile (T-04.1.04.03)', async () => {
    const invoiceA = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaa1';
    const invoiceB = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbb2';
    const rowA: OutboxRow = {
      ...row,
      eventKey: PAYMENT_INVOICE_REMINDER_EVENT_KEY,
      idempotencyKey: reminderOutboxIdempotencyKey(invoiceA, -7),
    };
    const rowB: OutboxRow = {
      ...row,
      eventKey: PAYMENT_INVOICE_REMINDER_EVENT_KEY,
      idempotencyKey: reminderOutboxIdempotencyKey(invoiceB, -3),
    };

    const inApp = new FakeTransport('in_app');
    const email = new FakeTransport('email');
    await dispatchOutbox(rowA, { in_app: inApp, email });
    await dispatchOutbox(rowB, { in_app: inApp, email });
    await dispatchOutbox(rowA, { in_app: inApp, email });

    const inAppA = inApp.reads[0]!.idempotencyKey;
    const inAppB = inApp.reads[1]!.idempotencyKey;
    const inAppARetry = inApp.reads[2]!.idempotencyKey;
    const emailA = email.reads[0]!.idempotencyKey;
    const emailB = email.reads[1]!.idempotencyKey;
    const emailARetry = email.reads[2]!.idempotencyKey;

    expect(inAppA).toMatch(/^[0-9a-f]{64}$/);
    expect(inAppB).toMatch(/^[0-9a-f]{64}$/);
    expect(inAppA).not.toBe(inAppB);
    expect(emailA).not.toBe(emailB);
    expect(inAppA).not.toBe(emailA);
    expect(inAppA).toBe(inAppARetry);
    expect(emailA).toBe(emailARetry);
  });

  it('presents the legacy provider key on retry of a pre-existing non-reminder row', async () => {
    const queuedBeforeDeploy: OutboxRow = {
      ...row,
      eventKey: 'profile_verified',
      idempotencyKey: 'pre-deploy-outbox-key',
    };
    const inApp = new FakeTransport('in_app');
    const email = new FakeTransport('email');
    await dispatchOutbox(queuedBeforeDeploy, { in_app: inApp, email });
    await dispatchOutbox(queuedBeforeDeploy, { in_app: inApp, email });

    const expectedInApp = createHash('sha256')
      .update(`profile_verified:in_app:${queuedBeforeDeploy.profileId}`)
      .digest('hex');
    const expectedEmail = createHash('sha256')
      .update(`profile_verified:email:${queuedBeforeDeploy.profileId}`)
      .digest('hex');

    expect(inApp.reads[0]!.idempotencyKey).toBe(expectedInApp);
    expect(email.reads[0]!.idempotencyKey).toBe(expectedEmail);
    expect(inApp.reads[1]!.idempotencyKey).toBe(expectedInApp);
    expect(email.reads[1]!.idempotencyKey).toBe(expectedEmail);
  });

  it('records missing adapters as failures while delivering available channels', async () => {
    const email = new FakeTransport('email');
    const missingInApp = await dispatchOutbox(row, { email });
    expect(missingInApp.map((o) => o.result.status)).toEqual(['failed', 'delivered']);
    expect(missingInApp[0]?.error).toBe('in_app transport unavailable');
    const inApp = new FakeTransport('in_app');
    const missingEmail = await dispatchOutbox(row, { in_app: inApp });
    expect(missingEmail.map((o) => o.result.status)).toEqual(['delivered', 'failed']);
    expect(missingEmail[1]?.error).toBe('email transport unavailable');
  });

  it('preserves successful legs around a thrown provider failure without leaking credentials', async () => {
    const inApp = new FakeTransport('in_app'),
      sms = new FakeTransport('sms');
    const email: INotificationTransport = {
      channel: 'email',
      async send() {
        throw new Error('timeout api_key=secret456');
      },
    };
    const outcomes = await dispatchOutbox(
      { ...row, channels: ['in_app', 'email', 'sms'] },
      { in_app: inApp, email, sms }
    );
    expect(outcomes.map((o) => o.result.status)).toEqual(['delivered', 'failed', 'delivered']);
    expect(outcomes[1]?.error).toContain('timeout');
    expect(JSON.stringify(outcomes)).not.toContain('secret456');
  });

  it('sends exactly one send call per registered channel (no duplicates)', async () => {
    const inApp = new FakeTransport('in_app');
    const email = new FakeTransport('email');
    await dispatchOutbox(row, { in_app: inApp, email });
    expect(inApp.reads).toHaveLength(1);
    expect(email.reads).toHaveLength(1);
  });

  it('uses profileId as recipient when no user id is present', async () => {
    const inApp = new FakeTransport('in_app');
    const noUser = { ...row, userId: null };
    await dispatchOutbox(noUser, { in_app: inApp });
    expect(inApp.reads[0]!.recipientId).toBe(row.profileId);
  });
});

describe('transport result contract', () => {
  it('fake returns delivered with a provider ref', async () => {
    const t = new FakeTransport('sms');
    const r = await t.send({} as NotificationSendPayload);
    expect(r.status).toBe('delivered');
    expect(typeof r.providerRef).toBe('string');
  });
});
