import type { PoolClient } from 'pg';
import { NotificationsService } from './notifications.service.js';

const orders = {
  electricity: { table: 'electricity_orders', route: '/electricity/orders' },
  saving: { table: 'saving_orders', route: '/savings/orders' },
  solar: { table: 'solar_construction_requests', route: '/solar/requests' },
  consultation: { table: 'consultation_requests', route: '/consultations' },
} as const;

/** Called only for a new native submission, inside its business transaction. */
export async function notifyOrderSubmitted(
  client: PoolClient,
  service: keyof typeof orders,
  id: string
): Promise<string> {
  const definition = orders[service];
  const row = (
    await client.query<{ profile_id: string; user_id: string; submitted_at: Date }>(
      `SELECT o.profile_id,p.user_id,o.submitted_at FROM ${definition.table} o
       JOIN profiles p ON p.id=o.profile_id WHERE o.id=$1 AND NOT p.archived`,
      [id]
    )
  ).rows[0];
  if (!row?.submitted_at) throw new Error('Submitted order notification recipient unavailable');
  await new NotificationsService().createCustomerBusinessEvent(
    {
      userId: row.user_id,
      profileId: row.profile_id,
      operatingContext: 'customer',
      type: 'general',
      eventKey: 'order.submitted',
      occurrenceKey: `order.submitted:${service}:${id}:${row.user_id}`,
      // Existing customer order/request identifiers are the stable public references.
      payload: { orderNumber: id, submittedAt: row.submitted_at.toISOString() },
      title: 'Order submitted',
      localizedContent: {
        fa: { title: 'درخواست ثبت شد', body: 'درخواست شما برای بررسی کارشناسان ثبت شد.' },
        en: { title: 'Order submitted', body: 'Your request has been sent for staff review.' },
      },
      link: `${definition.route}/${id}`,
    },
    client
  );
  return row.user_id;
}

/** The native cancellation engine owns the state/refund decision and its stable command key. */
export async function notifyOrderCancelled(
  client: PoolClient,
  service: keyof typeof orders,
  id: string,
  commandKey: string
): Promise<void> {
  const definition = orders[service];
  const row = (
    await client.query<{ profile_id: string; user_id: string }>(
      `SELECT o.profile_id,p.user_id FROM ${definition.table} o JOIN profiles p ON p.id=o.profile_id
       WHERE o.id=$1 AND o.status='cancelled' AND NOT p.archived`,
      [id]
    )
  ).rows[0];
  if (!row || !commandKey.trim()) throw new Error('Cancelled order notification unavailable');
  await new NotificationsService().createCustomerBusinessEvent(
    {
      userId: row.user_id,
      profileId: row.profile_id,
      operatingContext: 'customer',
      type: 'general',
      eventKey: 'order.status_changed',
      occurrenceKey: `order.status_changed:${service}:${id}:cancel:${commandKey}:${row.user_id}`,
      payload: { orderNumber: id, newStatus: 'لغو شده / Cancelled', status: 'cancelled' },
      title: 'Order cancelled',
      localizedContent: {
        fa: {
          title: 'سفارش لغو شد',
          body: 'سفارش شما لغو شد. وضعیت بازپرداخت جداگانه پیگیری می‌شود.',
        },
        en: {
          title: 'Order cancelled',
          body: 'Your order has been cancelled. Refund progress is tracked separately.',
        },
      },
      link: `${definition.route}/${id}`,
    },
    client
  );
}
