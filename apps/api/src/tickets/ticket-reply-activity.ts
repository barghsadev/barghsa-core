import { HttpException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { TicketRow } from './tickets.service.js';

type TicketQuery = Pick<PoolClient, 'query'>;

interface ReplyPreview {
  id: string;
  preview: string;
  createdAt: Date;
}
export type TicketQueueRow = TicketRow & {
  latestReply: ReplyPreview | null;
  hasUnreadReply: boolean;
};

// The outbox associates the notification with an exact reply. Older notices can
// still carry an earlier ticket URL, so the link is not used for read state.
const unreadReplyNotices = `
  FROM notification_outbox o
  JOIN in_app_notifications n ON n.delivery_key = 'outbox:' || o.id::text
  WHERE o.idempotency_key =
    'ticket.new_reply:' || c.ticket_id::text || ':' || c.id::text || ':' || $2::text
    AND o.event_key = 'ticket.new_reply' AND o.user_id = $2
    AND n.recipient_user_id = $2 AND n.operating_context = 'customer'
    AND n.profile_id IS NULL AND n.type = 'ticket.new_reply' AND NOT n.is_read
`;
const staffReply = `
  (c.author_context = 'staff' OR (c.author_context = 'unknown' AND c.author_id <> $2))
`;

/** Populate only the authorized page of tickets. Never project an internal note. */
export async function withTicketReplyPreviews(
  tickets: TicketRow[],
  db: TicketQuery,
  customerId?: string
): Promise<TicketQueueRow[]> {
  if (!tickets.length) return [];
  const { rows } = await db.query<{
    ticket_id: string;
    id: string | null;
    preview: string | null;
    created_at: Date | null;
    has_unread_reply: boolean;
  }>(
    `SELECT page.ticket_id, reply.id, reply.preview, reply.created_at,
      CASE WHEN $2::text IS NULL THEN false ELSE EXISTS (
        SELECT 1 FROM ticket_comments c
        WHERE c.ticket_id = page.ticket_id AND c.visibility = 'public' AND ${staffReply}
          AND EXISTS (SELECT 1 ${unreadReplyNotices})
      ) END AS has_unread_reply
    FROM unnest($1::uuid[]) page(ticket_id)
    LEFT JOIN LATERAL (
      SELECT c.id, c.created_at,
        left(btrim(regexp_replace(c.body, '[[:space:]]+', ' ', 'g')), 160) AS preview
      FROM ticket_comments c
      WHERE c.ticket_id = page.ticket_id AND c.visibility = 'public'
        AND ($2::text IS NULL OR ${staffReply})
      ORDER BY c.created_at DESC, c.id DESC
      LIMIT 1
    ) reply ON true`,
    [tickets.map((ticket) => ticket.id), customerId ?? null]
  );
  const replies = new Map(rows.map((row) => [row.ticket_id, row]));
  return tickets.map((ticket) => {
    const reply = replies.get(ticket.id);
    return {
      ...ticket,
      latestReply:
        reply?.id && reply.created_at && reply.preview !== null
          ? { id: reply.id, preview: reply.preview, createdAt: reply.created_at }
          : null,
      hasUnreadReply: reply?.has_unread_reply ?? false,
    };
  });
}

/** Called after customer ticket ownership is checked on the same transaction. */
export async function customerTicketReplies(ticketId: string, userId: string, db: TicketQuery) {
  return db.query(
    `SELECT c.*, ${staffReply} AND EXISTS (SELECT 1 ${unreadReplyNotices}) AS unread_reply
     FROM ticket_comments c WHERE c.ticket_id = $1 AND c.visibility = 'public'
     ORDER BY c.created_at ASC, c.id ASC`,
    [ticketId, userId]
  );
}

/** Only acknowledge the public replies actually returned to the customer. */
export async function markTicketRepliesSeen(
  ticketId: string,
  userId: string,
  replyIds: string[],
  db: PoolClient
): Promise<void> {
  const owned = await db.query('SELECT id FROM tickets WHERE id = $1 AND user_id = $2 FOR SHARE', [
    ticketId,
    userId,
  ]);
  if (!owned.rows.length) throw new HttpException('Ticket not found', 404);
  await db.query(
    `UPDATE in_app_notifications n SET is_read = true, read_at = COALESCE(n.read_at, NOW())
     WHERE NOT n.is_read AND n.id IN (
       SELECT seen.id FROM ticket_comments c
       CROSS JOIN LATERAL (SELECT n.id ${unreadReplyNotices}) seen
       WHERE c.ticket_id = $1 AND c.id = ANY($3::uuid[])
         AND c.visibility = 'public' AND ${staffReply}
     )`,
    [ticketId, userId, replyIds]
  );
}
