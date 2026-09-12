import {
  addReminderOffset,
  isEligibleForReminderSend,
  isInvoiceReminderOffset,
} from '@barghsa/shared/finance';
import {
  DELIVERY_WINDOW_CONFIG_KEY,
  type DeliveryWindowConfig,
} from '@barghsa/shared/notifications';
import type { QueryPool } from '../notifications/channel-scheduling.js';
import type { OutboxRow } from '../notifications/outbox-reader.js';
import { normalizeWindowConfig } from '../notifications/delivery-window.js';

export interface ReminderDeliveryPolicy {
  skipReason?: string;
  deferUntil?: Date;
  window?: DeliveryWindowConfig;
}

// A reminder holds one connection through provider I/O; serialize these guards
// per pool so receipt persistence and lease renewal retain a free connection.
const turns = new WeakMap<QueryPool, Promise<void>>();

export async function withReminderDeliveryPolicy<T>(
  pool: QueryPool,
  row: OutboxRow,
  work: (policy: ReminderDeliveryPolicy) => Promise<T>,
  windowOverride?: DeliveryWindowConfig
): Promise<T> {
  if (row.eventKey !== 'payment.invoice_reminder') return work({});
  const { invoiceId, offset, dueAt } = row.payload;
  if (
    typeof invoiceId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId) ||
    typeof offset !== 'number' ||
    !isInvoiceReminderOffset(offset) ||
    typeof dueAt !== 'string' ||
    !Number.isFinite(Date.parse(dueAt)) ||
    !row.profileId
  )
    return work({ skipReason: 'reminder_invalid_identity' });
  if (!pool.connect || (pool as QueryPool & { options?: { max?: number } }).options?.max === 1)
    throw new Error('Reminder delivery requires a pool with at least two connections');
  const previous = turns.get(pool) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const turn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  turns.set(pool, turn);
  await previous;
  let client: Awaited<ReturnType<NonNullable<QueryPool['connect']>>> | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    // Match profile-first account/finance lock order. Payments, archive and
    // ownership changes cannot commit between eligibility and provider I/O.
    const profile = (
      await client.query('SELECT user_id,archived FROM profiles WHERE id=$1 FOR SHARE', [
        row.profileId,
      ])
    ).rows[0];
    if (!profile || profile.archived || (row.userId && row.userId !== profile.user_id))
      return await work({ skipReason: 'reminder_recipient_changed' });
    const user = (
      await client.query(
        'SELECT timezone,disabled_at,activation_token FROM users WHERE user_id=$1 FOR SHARE',
        [profile.user_id]
      )
    ).rows[0];
    if (!user || user.disabled_at || user.activation_token)
      return await work({ skipReason: 'reminder_recipient_unavailable' });
    const invoice = (
      await client.query(
        `SELECT state,profile_id,due_at,
      metadata #>> '{due,serviceType}' AS service_type,
      COALESCE(metadata @> '{"reminderPlanDirty":true}'::jsonb,false) AS dirty
      FROM invoices WHERE id=$1 FOR SHARE`,
        [invoiceId]
      )
    ).rows[0];
    if (
      !invoice ||
      invoice.profile_id !== row.profileId ||
      !isEligibleForReminderSend(invoice.state)
    )
      return await work({ skipReason: 'reminder_invoice_stopped' });
    const currentDue = new Date(invoice.due_at);
    if (
      !invoice.due_at ||
      !Number.isFinite(currentDue.getTime()) ||
      currentDue.getTime() !== Date.parse(dueAt)
    )
      return await work({ skipReason: 'reminder_deadline_changed' });
    const now = new Date();
    if (invoice.dirty) return await work({ deferUntil: new Date(now.getTime() + 60_000) });
    if (invoice.service_type) {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2 || ':' || $3::text))`,
        ['barghsa.invoice_reminder_offset_toggles', invoice.service_type, offset]
      );
      const toggle = (
        await client.query(
          'SELECT enabled FROM invoice_reminder_offset_toggles WHERE service_type=$1 AND "offset"=$2',
          [invoice.service_type, offset]
        )
      ).rows[0];
      if (toggle?.enabled === false)
        return await work({ deferUntil: new Date(now.getTime() + 3_600_000) });
    }
    const earliest = addReminderOffset(currentDue, offset);
    if (earliest > now) return await work({ deferUntil: earliest });
    const rawWindow =
      windowOverride ??
      (
        await client.query('SELECT value FROM app_config WHERE key=$1 FOR SHARE', [
          DELIVERY_WINDOW_CONFIG_KEY,
        ])
      ).rows[0]?.value;
    const window = normalizeWindowConfig({
      ...normalizeWindowConfig(rawWindow),
      timezone: user.timezone,
    });
    if (windowOverride) {
      window.startHour = windowOverride.startHour;
      window.endHour = windowOverride.endHour;
    }
    return await work({ window });
  } finally {
    if (client) {
      let destroy = false;
      try {
        await client.query('ROLLBACK');
      } catch {
        destroy = true;
      }
      client.release(destroy);
    }
    releaseTurn();
    if (turns.get(pool) === turn) turns.delete(pool);
  }
}
