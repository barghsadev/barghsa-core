import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { tSaving } from '@barghsa/i18n/saving';
import { NotificationsService } from '../notifications/notifications.service.js';

/** Invoked once by the native transaction after its guarded state write. */
export async function notifySavingStatus(
  client: PoolClient,
  id: string,
  from: string,
  to: string,
  content: {
    title: string;
    localizedContent: Record<'fa' | 'en', { title: string; body: string }>;
  }
): Promise<void> {
  const current = (
    await client.query<{ profile_id: string; user_id: string; status: string }>(
      `SELECT r.profile_id,r.status,p.user_id FROM saving_orders r
       JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR SHARE OF p`,
      [id]
    )
  ).rows[0];
  if (!current || current.status !== to)
    throw new Error('Saving notice does not match saved status');
  const label =
    to === 'awaiting_staff_review' ? 'staffReview' : to === 'in_progress' ? 'inProgress' : to;
  const params = {
    profileId: current.profile_id,
    operatingContext: 'customer' as const,
    type: 'general' as const,
    ...content,
    link: `/savings/orders/${id}`,
  };
  const notifications = new NotificationsService();
  const informational = async (userId: string) => {
    const notice = await notifications.create({ ...params, userId }, client);
    if (
      !(
        await client.query(
          "SELECT id FROM in_app_notifications WHERE id=$1 AND recipient_user_id=$2 AND profile_id=$3 AND operating_context='customer'",
          [notice.id, userId, current.profile_id]
        )
      ).rows[0]
    )
      throw new Error('Private saving inbox was not stored');
  };
  if (from !== to) {
    // A UUID names this guarded mutation occurrence; the stored outbox reuses it on worker retries.
    await notifications.createCustomerBusinessEvent(
      {
        ...params,
        userId: current.user_id,
        eventKey: 'order.status_changed',
        occurrenceKey: `order.status_changed:saving:${id}:${uuidv7()}:${current.user_id}`,
        payload: {
          orderNumber: id,
          newStatus: `${tSaving(label, 'fa')} / ${tSaving(label, 'en')}`,
          status: to,
        },
      },
      client
    );
  } else {
    await informational(current.user_id);
  }
}
