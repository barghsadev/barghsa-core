import type { PoolClient } from 'pg';
import { z } from 'zod';

export interface RelatedTicketRecord {
  sourceId: string;
  destination: 'contract' | 'invoice' | 'electricity_order' | 'saving_order';
  id: string;
}
interface TicketReference {
  id: string;
  userId: string;
  profileId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
}

/** Resolve only references already read through ticket authorization; never invent a detail ID. */
export async function withRelatedTicketRecords<T extends TicketReference>(
  tickets: T[],
  client: Pick<PoolClient, 'query'>
): Promise<Array<T & { relatedRecord: RelatedTicketRecord | null }>> {
  const references = tickets.filter(
    (ticket) =>
      ['order', 'contract', 'invoice'].includes(ticket.relatedEntityType ?? '') &&
      z.uuid().safeParse(ticket.relatedEntityId).success &&
      z.uuid().safeParse(ticket.profileId).success
  );
  const records = references.length
    ? (
        await client.query<{
          ticket_id: string;
          source_id: string;
          destination: RelatedTicketRecord['destination'] | null;
          destination_id: string | null;
        }>(
          `
    WITH requested AS (
      SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(ticket_id text,user_id text,profile_id uuid,kind text,record_id uuid,source_id text)
    )
    SELECT r.ticket_id,r.source_id,
      CASE WHEN c.id IS NOT NULL THEN 'contract' WHEN i.id IS NOT NULL THEN 'invoice'
           WHEN e.id IS NOT NULL THEN 'electricity_order' WHEN s.id IS NOT NULL THEN 'saving_order' END AS destination,
      COALESCE(c.id,i.id,e.id,s.id) AS destination_id
    FROM requested r
    JOIN profiles p ON p.id=r.profile_id AND p.user_id=r.user_id AND NOT p.archived
    LEFT JOIN contracts c ON r.kind='contract' AND c.id=r.record_id AND c.profile_id=p.id
      AND EXISTS (SELECT 1 FROM contract_publications WHERE contract_id=c.id)
    LEFT JOIN invoices i ON r.kind='invoice' AND i.id=r.record_id AND i.profile_id=p.id
    LEFT JOIN orders o ON r.kind='order' AND o.id=r.record_id AND o.profile_id=p.id
    LEFT JOIN electricity_orders e ON o.order_type='electricity' AND e.id=o.id AND e.profile_id=p.id
      AND EXISTS (
        SELECT 1 FROM electricity_contracts ec
        JOIN contracts linked ON linked.id=ec.contract_id AND linked.profile_id=p.id
        JOIN contract_activation_requirements ar ON ar.version_id=linked.current_version_id
        JOIN invoices initial ON initial.id=ar.initial_invoice_id AND initial.profile_id=p.id
        WHERE ec.order_id=e.id
      )
    LEFT JOIN saving_orders s ON o.order_type='savings' AND s.order_id=o.id AND s.profile_id=p.id
  `,
          [
            JSON.stringify(
              references.map((ticket) => ({
                ticket_id: ticket.id,
                user_id: ticket.userId,
                profile_id: ticket.profileId,
                kind: ticket.relatedEntityType,
                record_id: ticket.relatedEntityId,
                source_id: ticket.relatedEntityId,
              }))
            ),
          ]
        )
      ).rows
    : [];
  const byTicket = new Map(
    records.flatMap((record) =>
      record.destination && record.destination_id
        ? [
            [
              record.ticket_id,
              {
                sourceId: record.source_id,
                destination: record.destination,
                id: record.destination_id,
              },
            ] as const,
          ]
        : []
    )
  );
  return tickets.map((ticket) => ({ ...ticket, relatedRecord: byTicket.get(ticket.id) ?? null }));
}
