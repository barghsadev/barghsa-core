import type { PoolClient } from 'pg';
import { NotificationsService } from '../notifications/notifications.service.js';

export async function notifyCancellationRequest(
  client: PoolClient,
  contractId: string,
  requestId: string,
  content: { title: string; localizedContent: Record<'fa' | 'en', { title: string; body: string }> }
): Promise<void> {
  const row = (
    await client.query<{
      profile_id: string;
      user_id: string;
      contract_number: string;
      electricity_id: string | null;
      saving_id: string | null;
      solar_id: string | null;
    }>(
      `SELECT c.profile_id,p.user_id,c.contract_number::text,
        e.id AS electricity_id,s.id AS saving_id,solar.id AS solar_id
      FROM contract_cancellation_requests r JOIN contracts c ON c.id=r.contract_id
      JOIN profiles p ON p.id=c.profile_id
      LEFT JOIN orders root ON root.id=c.order_id AND root.profile_id=c.profile_id
        AND root.order_type=c.service_type::text
      LEFT JOIN electricity_orders e ON e.id=root.id AND e.profile_id=c.profile_id
        AND c.service_type='electricity'
        AND EXISTS(SELECT 1 FROM electricity_contracts link WHERE link.order_id=e.id AND link.contract_id=c.id)
      LEFT JOIN saving_orders s ON s.order_id=root.id AND s.profile_id=c.profile_id
        AND c.service_type='savings'
      LEFT JOIN solar_construction_requests solar ON solar.contract_id=c.id
        AND solar.profile_id=c.profile_id AND c.service_type='solar'
      WHERE r.id=$2 AND r.contract_id=$1 AND r.status='Pending' AND NOT p.archived
      FOR SHARE OF p`,
      [contractId, requestId]
    )
  ).rows[0];
  if (!row) throw new Error('Cancellation notice requires a current pending request');
  const orderNumber = row.electricity_id ?? row.saving_id ?? row.solar_id ?? row.contract_number;
  const link = row.electricity_id
    ? `/electricity/orders/${row.electricity_id}`
    : row.saving_id
      ? `/savings/orders/${row.saving_id}`
      : row.solar_id
        ? `/solar/requests/${row.solar_id}`
        : `/contracts/${contractId}`;
  await new NotificationsService().createCustomerBusinessEvent(
    {
      ...content,
      profileId: row.profile_id,
      userId: row.user_id,
      operatingContext: 'customer',
      link,
      type: 'general',
      eventKey: 'order.cancellation_requested',
      occurrenceKey: `order.cancellation_requested:${contractId}:${requestId}:${row.user_id}`,
      payload: { orderNumber, requestId, contractId },
    },
    client
  );
}
