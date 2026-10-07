import type { PoolClient } from 'pg';
import { tConsultation } from '@barghsa/i18n/consultation';
import { NotificationsService } from '../notifications/notifications.service.js';

/** Current private recipients; a saved native history occurrence binds each real status change. */
export async function notifyConsultationStatus(
  client: PoolClient,
  request: { id: string; profile_id: string; submitted_by: string; status: string },
  status: string,
  content: { title: string; localizedContent: Record<'fa' | 'en', { title: string; body: string }> }
): Promise<void> {
  const current = (
    await client.query<{ status: string; user_id: string }>(
      `SELECT r.status,p.user_id FROM consultation_requests r JOIN profiles p ON p.id=r.profile_id
       WHERE r.id=$1 AND r.profile_id=$2 FOR SHARE OF p`,
      [request.id, request.profile_id]
    )
  ).rows[0];
  if (!current || current.status !== status)
    throw new Error('Consultation notification does not match the saved status');
  const events = (
    await client.query<{ id: string; status: string }>(
      'SELECT id,status FROM consultation_request_events WHERE request_id=$1 ORDER BY created_at DESC,id DESC LIMIT 2',
      [request.id]
    )
  ).rows;
  const event = events[0];
  if (!event || event.status !== status)
    throw new Error('Consultation notification requires its saved history occurrence');
  const params = {
    profileId: request.profile_id,
    operatingContext: 'customer' as const,
    type: 'general' as const,
    ...content,
    link: `/consultations/${request.id}`,
  };
  const notifications = new NotificationsService();
  const informational = async (userId: string) => {
    const notice = await notifications.create({ ...params, userId }, client);
    const stored = await client.query(
      "SELECT id FROM in_app_notifications WHERE id=$1 AND recipient_user_id=$2 AND profile_id=$3 AND operating_context='customer'",
      [notice.id, userId, request.profile_id]
    );
    if (stored.rows.length !== 1) throw new Error('Private consultation inbox was not stored');
  };
  // Fee replacement can traverse two states in one transaction while its original request object
  // still contains the first state. Saved history distinguishes both transitions and cycles.
  if ((events[1]?.status ?? request.status) !== status) {
    const created = await notifications.createCustomerBusinessEvent(
      {
        ...params,
        userId: current.user_id,
        eventKey: 'order.status_changed',
        occurrenceKey: `order.status_changed:consultation:${request.id}:${event.id}:${current.user_id}`,
        payload: {
          orderNumber: request.id,
          newStatus: `${tConsultation(`status_${status}`, 'fa')} / ${tConsultation(`status_${status}`, 'en')}`,
          status,
        },
      },
      client
    );
    if (!created) return;
  } else {
    // Same-state fee/refund updates keep their existing informational inbox semantics.
    await informational(current.user_id);
  }
  if (request.submitted_by !== current.user_id) {
    const allowed = await client.query(
      `SELECT a.id FROM profile_agents a JOIN profiles p ON p.id=a.profile_id
       JOIN users u ON u.user_id=a.user_id
       WHERE a.profile_id=$1 AND a.user_id=$2 AND a.role='Manager' AND p.profile_type='LEGAL'
       AND NOT p.archived AND u.disabled_at IS NULL AND u.activation_token IS NULL FOR SHARE OF a`,
      [request.profile_id, request.submitted_by]
    );
    if (allowed.rows.length) await informational(request.submitted_by);
  }
}
