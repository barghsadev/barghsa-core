import { createHash } from 'node:crypto';
import { DeliveryRejected } from '@barghsa/shared/notification-delivery';
import type {
  INotificationTransport,
  NotificationChannel,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications';

export type FakeProviderOutcome = 'success' | 'transient' | 'permanent';

/** Deterministic provider adapter for exercising the worker without credentials or I/O. */
abstract class FakeProviderTransport implements INotificationTransport {
  readonly calls: NotificationSendPayload[] = [];
  private readonly accepted = new Map<string, string>();
  private readonly outcomes: FakeProviderOutcome[];

  protected constructor(
    readonly channel: NotificationChannel,
    private readonly providerName: string,
    outcomes: readonly FakeProviderOutcome[]
  ) {
    this.outcomes = [...outcomes];
  }

  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    if (payload.channel !== this.channel || !payload.idempotencyKey.trim())
      throw new Error('Invalid fake provider delivery');
    payload.signal?.throwIfAborted();
    this.calls.push(payload);
    const previous = this.accepted.get(payload.idempotencyKey);
    if (previous) return { status: 'delivered', providerRef: previous };
    const outcome = this.outcomes.shift() ?? 'success';
    if (outcome === 'transient')
      throw Object.assign(new Error('Provider temporarily unavailable'), { httpStatus: 503 });
    if (outcome === 'permanent') throw new DeliveryRejected('Provider rejected delivery');
    const digest = createHash('sha256').update(payload.idempotencyKey).digest('hex').slice(0, 16);
    const providerRef = `${this.providerName}:${digest}`;
    this.accepted.set(payload.idempotencyKey, providerRef);
    return { status: 'delivered', providerRef };
  }
}

export class FakeSmtpTransport extends FakeProviderTransport {
  constructor(outcomes: readonly FakeProviderOutcome[] = []) {
    super('email', 'smtp', outcomes);
  }
}

export class FakeResendTransport extends FakeProviderTransport {
  constructor(outcomes: readonly FakeProviderOutcome[] = []) {
    super('email', 'resend', outcomes);
  }
}

export class FakeSmsIrTransport extends FakeProviderTransport {
  constructor(outcomes: readonly FakeProviderOutcome[] = []) {
    super('sms', 'smsir', outcomes);
  }
}
