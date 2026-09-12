import { getDbPool } from '@barghsa/db';
import { durableDelivery, readDeliveryReceipt } from './send-receipt.js';
import {
  createSmsSender,
  prepareSmsMessage,
  type DeliveryPool,
  type SmsMessage,
} from '@barghsa/shared/notification-delivery';
import type {
  INotificationTransport,
  NotificationSendPayload,
  NotificationSendResult,
} from '@barghsa/shared/notifications';
import {
  assertNotificationRecipientAvailable,
  loadNotificationRecipient,
} from './channel-availability-loader.js';

export class SmsNotificationTransport implements INotificationTransport {
  readonly channel = 'sms' as const;
  constructor(
    private readonly pool: DeliveryPool = getDbPool(),
    private readonly request: typeof fetch = fetch
  ) {}
  async send(payload: NotificationSendPayload): Promise<NotificationSendResult> {
    if (!payload.outboxId || !payload.profileId)
      throw new Error('SMS requires a durable queued recipient');
    const receipt = await readDeliveryReceipt(this.pool, payload.outboxId, 'sms');
    if (receipt) return receipt;
    const recipient = await loadNotificationRecipient(this.pool, payload.outboxId);
    if (!recipient?.mobile || recipient.profileId !== payload.profileId)
      throw new Error('SMS recipient unavailable');
    const jobs = await this.pool.query(
      "SELECT delivery_payload,attempts FROM notification_job WHERE outbox_id=$1 AND channel='sms'",
      [payload.outboxId]
    );
    if (jobs.rows.length !== 1) throw new Error('SMS job unavailable');
    let snapshot = jobs.rows[0]!.delivery_payload;
    if (!snapshot) {
      // Never invent new parameters for an ambiguous historical attempt.
      if (Number(jobs.rows[0]!.attempts) > 0)
        throw new Error('Legacy SMS delivery requires reconciliation');
      const templates = await this.pool.query(
        `SELECT id,version,variables FROM notification_templates
        WHERE event_key=$1 AND channel='sms' AND locale=$2 AND status='active' AND is_active=true`,
        [payload.eventKey, recipient.locale]
      );
      if (templates.rows.length !== 1 || !Array.isArray(templates.rows[0]!.variables))
        throw new Error('Active SMS template unavailable');
      const template = templates.rows[0]!;
      const names = (template.variables as unknown[]).map((item) =>
        typeof item === 'string'
          ? item.trim()
          : item && typeof item === 'object' && 'name' in item && typeof item.name === 'string'
            ? item.name.trim()
            : ''
      );
      if (names.some((name) => !name)) throw new Error('Invalid SMS template variables');
      const message = await prepareSmsMessage(
        this.pool,
        recipient.mobile,
        payload.eventKey,
        names,
        payload.payload ?? {}
      );
      const result = await this.pool.query(
        `UPDATE notification_job SET delivery_payload=COALESCE(delivery_payload,$2::jsonb)
        WHERE outbox_id=$1 AND channel='sms' RETURNING delivery_payload`,
        [
          payload.outboxId,
          JSON.stringify({
            version: 1,
            userId: recipient.userId,
            profileId: recipient.profileId,
            idempotencyKey: payload.idempotencyKey,
            templateId: template.id,
            templateVersion: template.version,
            message,
          }),
        ]
      );
      snapshot = result.rows[0]?.delivery_payload;
    }
    if (!snapshot || typeof snapshot !== 'object') throw new Error('SMS snapshot unavailable');
    const saved = snapshot as Record<string, unknown>;
    const message = saved.message as SmsMessage | undefined;
    if (
      saved.version !== 1 ||
      saved.userId !== recipient.userId ||
      saved.profileId !== recipient.profileId ||
      saved.idempotencyKey !== payload.idempotencyKey ||
      message?.destination !== recipient.mobile ||
      typeof message.providerId !== 'string' ||
      typeof message.templateId !== 'string' ||
      !Array.isArray(message.parameters) ||
      message.parameters.some(
        (item) => !item || typeof item.name !== 'string' || typeof item.value !== 'string'
      )
    ) {
      throw new Error('SMS recipient or identity changed; delivery requires reconciliation');
    }
    await assertNotificationRecipientAvailable(
      this.pool,
      payload.outboxId,
      payload.eventKey,
      'sms',
      recipient
    );
    const providerRef = await createSmsSender(
      this.pool,
      this.request,
      durableDelivery(this.pool, payload.outboxId, 'sms', payload.idempotencyKey)
    )(message, payload.signal);
    return { status: 'delivered', providerRef };
  }
}
