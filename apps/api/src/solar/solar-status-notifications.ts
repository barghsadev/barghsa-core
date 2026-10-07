import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { tSolar } from '@barghsa/i18n/solar';
import { NotificationsService } from '../notifications/notifications.service.js';

/** Invoked once by the native transaction after its guarded state write. */
export async function notifySolarStatus(
  client: PoolClient,
  id: string,
  from: string,
  to: string,
  content: {
    title: string;
    localizedContent: Record<'fa' | 'en', { title: string; body: string }>;
  },
  originalRecipient?: string
): Promise<void> {
  const current = (
    await client.query<{ profile_id: string; user_id: string; status: string }>(
      `SELECT r.profile_id,r.status,p.user_id FROM solar_construction_requests r
       JOIN profiles p ON p.id=r.profile_id WHERE r.id=$1 FOR SHARE OF p`,
      [id]
    )
  ).rows[0];
  if (!current || current.status !== to)
    throw new Error('Solar notice does not match saved status');
  const params = {
    profileId: current.profile_id,
    operatingContext: 'customer' as const,
    type: 'general' as const,
    ...content,
    link: `/solar/requests/${id}`,
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
      throw new Error('Private solar inbox was not stored');
  };
  if (from !== to) {
    // A UUID names this guarded mutation occurrence; the stored outbox reuses it on worker retries.
    await notifications.createCustomerBusinessEvent(
      {
        ...params,
        userId: current.user_id,
        eventKey: 'order.status_changed',
        occurrenceKey: `order.status_changed:solar:${id}:${uuidv7()}:${current.user_id}`,
        payload: {
          orderNumber: id,
          newStatus: `${tSolar(`status_${to}`, 'fa')} / ${tSolar(`status_${to}`, 'en')}`,
          status: to,
        },
      },
      client
    );
  } else {
    await informational(current.user_id);
  }
  if (originalRecipient && originalRecipient !== current.user_id) {
    const allowed = await client.query(
      `SELECT a.id FROM profile_agents a JOIN profiles p ON p.id=a.profile_id JOIN users u ON u.user_id=a.user_id
       WHERE a.profile_id=$1 AND a.user_id=$2 AND a.role='Manager' AND p.profile_type='LEGAL'
       AND NOT p.archived AND u.disabled_at IS NULL AND u.activation_token IS NULL FOR SHARE OF a`,
      [current.profile_id, originalRecipient]
    );
    if (allowed.rows.length) await informational(originalRecipient);
  }
}
