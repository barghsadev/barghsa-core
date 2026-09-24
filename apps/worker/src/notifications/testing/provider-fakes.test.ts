import { describe, expect, it } from 'vitest';
import { classifyProviderError } from '@barghsa/shared/notification-delivery';
import type {
  INotificationTransport,
  NotificationSendPayload,
} from '@barghsa/shared/notifications';
import {
  FakeResendTransport,
  FakeSmsIrTransport,
  FakeSmtpTransport,
  type FakeProviderOutcome,
} from './provider-fakes.js';

const adapters = [
  {
    name: 'SMTP',
    create: (outcomes: FakeProviderOutcome[]) => new FakeSmtpTransport(outcomes),
    channel: 'email',
  },
  {
    name: 'Resend',
    create: (outcomes: FakeProviderOutcome[]) => new FakeResendTransport(outcomes),
    channel: 'email',
  },
  {
    name: 'SMS.ir',
    create: (outcomes: FakeProviderOutcome[]) => new FakeSmsIrTransport(outcomes),
    channel: 'sms',
  },
] as const;

for (const adapter of adapters) {
  describe(`${adapter.name} fake transport contract`, () => {
    const payload = (): NotificationSendPayload => ({
      channel: adapter.channel,
      idempotencyKey: 'occurrence:one',
      recipientId: 'recipient-1',
      profileId: 'profile-1',
      eventKey: 'invoice.created',
      payload: { invoiceId: 'invoice-1' },
    });

    it('classifies scripted failures and preserves the accepted receipt on replay', async () => {
      const fake: INotificationTransport & { calls: NotificationSendPayload[] } = adapter.create([
        'transient',
        'permanent',
        'success',
        'permanent',
      ]);
      const first = await fake.send(payload()).catch((error: unknown) => error);
      expect(classifyProviderError(first)).toBe('transient');
      const second = await fake.send(payload()).catch((error: unknown) => error);
      expect(classifyProviderError(second)).toBe('permanent');
      const accepted = await fake.send(payload());
      expect(accepted).toMatchObject({ status: 'delivered' });
      expect(accepted.providerRef).toMatch(/^[a-z]+:[a-f0-9]{16}$/);
      expect(await fake.send(payload())).toEqual(accepted);
      expect(fake.calls).toHaveLength(4);
      const next = await fake
        .send({ ...payload(), idempotencyKey: 'occurrence:two' })
        .catch((error: unknown) => error);
      expect(classifyProviderError(next)).toBe('permanent');
    });

    it('refuses the wrong channel and a cancelled delivery before provider I/O', async () => {
      const fake = adapter.create([]);
      await expect(
        fake.send({ ...payload(), channel: adapter.channel === 'email' ? 'sms' : 'email' })
      ).rejects.toThrow('Invalid fake provider delivery');
      const controller = new AbortController();
      controller.abort();
      await expect(fake.send({ ...payload(), signal: controller.signal })).rejects.toThrow();
      expect(fake.calls).toHaveLength(0);
    });
  });
}
