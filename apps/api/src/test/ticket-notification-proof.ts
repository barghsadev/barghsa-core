import { expect } from 'vitest';
import type { Pool } from 'pg';
import type { TicketBusinessEvent } from '../notifications/notifications.service.js';

export async function expectTicketDelivery(
  pool: Pool,
  id: string,
  event: TicketBusinessEvent,
  occurrence: string,
  recipients: Array<{ user: string; context: 'customer' | 'staff' }>
) {
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key=$1 AND payload->>'ticketNumber'=$2 ORDER BY user_id",
      [event, id]
    )
  ).rows;
  expect(rows.map((r) => r.user_id)).toEqual(recipients.map((r) => r.user).sort());
  for (const recipient of recipients) {
    const row = rows.find((r) => r.user_id === recipient.user)!;
    const link = `${recipient.context === 'staff' ? '/admin' : ''}/tickets?ticketId=${id}`;
    expect(row).toMatchObject({
      profile_id: null,
      event_key: event,
      channels: event === 'ticket.assigned' ? ['in_app'] : ['in_app', 'email'],
      max_attempts: 5,
      idempotency_key: `${event}:${id}:${occurrence}:${recipient.user}`,
      payload: { ticketNumber: id, link_route: link },
    });
    expect(Object.keys(row.payload).sort()).toEqual(['link_route', 'ticketNumber']);
    const inbox = (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [row.id]
      )
    ).rows;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      profile_id: null,
      recipient_user_id: recipient.user,
      operating_context: recipient.context,
      type: event,
      link_route: link,
    });
    expect(inbox[0].localized_content.fa.title).toMatch(/[\u0600-\u06ff]/);
    expect(inbox[0].localized_content.en.title).toMatch(/[A-Za-z]/);
    const jobs = (
      await pool.query(
        'SELECT channel,status,priority,attempts,max_attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [row.id]
      )
    ).rows;
    expect(jobs).toEqual([
      ...(event === 'ticket.new_reply'
        ? [
            {
              channel: 'email',
              status: 'queued',
              priority: 'normal',
              attempts: 0,
              max_attempts: 5,
              provider_ref: null,
            },
          ]
        : []),
      {
        channel: 'in_app',
        status: 'done',
        priority: 'normal',
        attempts: 1,
        max_attempts: 5,
        provider_ref: inbox[0].id,
      },
    ]);
    expect(
      (
        await pool.query(
          'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
          [row.id]
        )
      ).rows
    ).toEqual([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
    ]);
  }
  return rows;
}
export async function ticketDeliverySnapshot(pool: Pool, id: string) {
  const outbox = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key IN ('ticket.new_reply','ticket.assigned') AND payload->>'ticketNumber'=$1 ORDER BY id",
      [id]
    )
  ).rows;
  const ids = outbox.map((r) => r.id);
  return {
    outbox,
    inbox: (
      await pool.query(
        'SELECT * FROM in_app_notifications WHERE delivery_key=ANY($1::text[]) ORDER BY id',
        [ids.map((id) => `outbox:${id}`)]
      )
    ).rows,
    jobs: (
      await pool.query(
        'SELECT * FROM notification_job WHERE outbox_id=ANY($1::uuid[]) ORDER BY outbox_id,channel',
        [ids]
      )
    ).rows,
    logs: (
      await pool.query(
        'SELECT * FROM notification_delivery_log WHERE notification_id=ANY($1::uuid[]) ORDER BY id',
        [ids]
      )
    ).rows,
  };
}

export async function expectTicketNoticeRollback(
  pool: Pool,
  id: string,
  event: TicketBusinessEvent,
  work: () => Promise<Response>,
  outboxOnly = false,
  failureStatuses: Record<'raise' | 'suppress', number> = { raise: 500, suppress: 500 }
) {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('sessions','rate_limit_counters','rate_limit_windows') ORDER BY tablename"
    )
  ).rows.map((r) => r.tablename as string);
  const snapshot = async (): Promise<Record<string, Array<Record<string, unknown>>>> =>
    Object.fromEntries(
      await Promise.all(
        tables.map(async (table) => [
          table,
          (
            await pool.query(
              `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${table.replaceAll('"', '""')}" t`
            )
          ).rows[0].rows,
        ])
      )
    );
  const match = `event_key='${event}' AND payload->>'ticketNumber'='${id}'`;
  for (const [table, predicate] of [
    ['notification_outbox', `NEW.event_key='${event}' AND NEW.payload->>'ticketNumber'='${id}'`],
    ...(!outboxOnly
      ? [
          [
            'in_app_notifications',
            `NEW.type='${event}' AND EXISTS(SELECT 1 FROM notification_outbox WHERE 'outbox:'||id::text=NEW.delivery_key AND ${match})`,
          ],
          [
            'notification_job',
            `EXISTS(SELECT 1 FROM notification_outbox WHERE id=NEW.outbox_id AND ${match})`,
          ],
          [
            'notification_delivery_log',
            `EXISTS(SELECT 1 FROM notification_outbox WHERE id=NEW.notification_id AND ${match})`,
          ],
        ]
      : []),
  ])
    for (const mode of ['raise', 'suppress'] as const) {
      const before = await snapshot();
      await pool.query(
        `CREATE FUNCTION fail_ticket_business_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'ticket notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_ticket_business_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_ticket_business_notice()`
      );
      try {
        expect((await work()).status).toBe(failureStatuses[mode]);
        const after = await snapshot();
        expect(after).toEqual(before);
      } finally {
        await pool.query(
          `DROP TRIGGER fail_ticket_business_notice ON ${table}; DROP FUNCTION fail_ticket_business_notice()`
        );
      }
    }
}
