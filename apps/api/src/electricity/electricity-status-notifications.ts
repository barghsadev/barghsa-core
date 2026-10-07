import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { t } from '@barghsa/i18n/app';
import { NotificationsService } from '../notifications/notifications.service.js';

export async function notifyElectricityStatus(
  client: PoolClient,
  id: string,
  from: string,
  to: string,
  content?: {
    title: string;
    localizedContent: Record<'fa' | 'en', { title: string; body: string }>;
  },
  reason?: string,
  linkOverride?: string | null
): Promise<void> {
  const current = (
    await client.query<{ profile_id: string; user_id: string; status: string }>(
      `SELECT e.profile_id,e.status,p.user_id FROM electricity_orders e JOIN profiles p ON p.id=e.profile_id
      WHERE e.id=$1 FOR SHARE OF p`,
      [id]
    )
  ).rows[0];
  if (!current || current.status !== to)
    throw new Error('Electricity notice does not match saved status');
  if (from === to) return;
  const fa = t(`electricity.order.status.${to}`, 'fa'),
    en = t(`electricity.order.status.${to}`, 'en');
  const link = linkOverride === undefined ? `/electricity/orders/${id}` : linkOverride;
  const message = content
    ? { title: content.title, localizedContent: content.localizedContent }
    : undefined;
  await new NotificationsService().createCustomerBusinessEvent(
    {
      ...(message ?? {
        title: en,
        localizedContent: {
          fa: { title: fa, body: fa + ' ' + id + (reason ? ' ' + reason : '') },
          en: { title: en, body: en + ' ' + id + (reason ? ' ' + reason : '') },
        },
      }),
      userId: current.user_id,
      profileId: current.profile_id,
      operatingContext: 'customer',
      type: 'general',
      ...(link ? { link } : {}),
      eventKey: 'order.status_changed',
      occurrenceKey: `order.status_changed:electricity:${id}:${uuidv7()}:${current.user_id}`,
      payload: { orderNumber: id, newStatus: fa + ' / ' + en, status: to },
    },
    client
  );
}
