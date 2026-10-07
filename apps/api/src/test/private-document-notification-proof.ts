import { expect } from 'vitest';
import type { Pool } from 'pg';

export async function expectPrivateDocumentDelivery(
  pool: Pool,
  id: string,
  event: 'document.uploaded' | 'document.quarantined',
  recipients: Array<{ user: string; context: 'customer' | 'staff'; profile: string | null }>,
  revision?: number
) {
  const doc = (await pool.query('SELECT original_name FROM documents WHERE id=$1', [id])).rows[0];
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key=$1 AND payload->>'documentId'=$2 ORDER BY user_id",
      [event, id]
    )
  ).rows;
  expect(rows.map((r) => r.user_id)).toEqual(recipients.map((r) => r.user).sort());
  for (const recipient of recipients) {
    const row = rows.find((r) => r.user_id === recipient.user)!;
    expect(row).toMatchObject({
      profile_id: recipient.profile,
      user_id: recipient.user,
      event_key: event,
      channels: ['in_app'],
      max_attempts: 5,
      idempotency_key:
        event === 'document.uploaded'
          ? `document.uploaded:${id}:${recipient.user}`
          : `document.quarantined:${id}:manual:${revision}:${recipient.user}`,
      payload: { documentId: id, documentName: doc.original_name },
    });
    const inbox = (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [row.id]
      )
    ).rows;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      profile_id: recipient.profile,
      recipient_user_id: recipient.user,
      operating_context: recipient.context,
      type: event,
      link_route: recipient.context === 'staff' ? '/admin/documents' : null,
    });
    for (const locale of ['fa', 'en'] as const) {
      expect(inbox[0].localized_content[locale].body).toContain(doc.original_name);
      expect(inbox[0].localized_content[locale].body).toContain(id);
    }
    expect(inbox[0].localized_content.fa.title).toMatch(/[\u0600-\u06ff]/);
    expect(
      (
        await pool.query(
          'SELECT channel,status,priority,attempts,max_attempts,provider_ref FROM notification_job WHERE outbox_id=$1',
          [row.id]
        )
      ).rows
    ).toEqual([
      {
        channel: 'in_app',
        status: 'done',
        priority: event === 'document.quarantined' ? 'urgent' : 'normal',
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
export async function privateDocumentSnapshot(pool: Pool, id: string) {
  const outbox = (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE event_key IN ('document.uploaded','document.quarantined') AND payload->>'documentId'=$1 ORDER BY id",
        [id]
      )
    ).rows,
    ids = outbox.map((r) => r.id);
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
    history: (
      await pool.query(
        'SELECT * FROM notification_delivery_log WHERE notification_id=ANY($1::uuid[]) ORDER BY id',
        [ids]
      )
    ).rows,
  };
}

export async function expectPrivateDocumentRollback(
  pool: Pool,
  id: string,
  work: () => Promise<Response>,
  event: string,
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
  const match = `event_key='${event}' AND payload->>'documentId'='${id}'`;
  for (const [table, predicate] of [
    ['notification_outbox', `NEW.event_key='${event}' AND NEW.payload->>'documentId'='${id}'`],
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
        `CREATE FUNCTION fail_document_review_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'document review delivery unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_document_review_delivery BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_document_review_delivery()`
      );
      try {
        expect((await work()).status).toBe(failureStatuses[mode]);
        const after = await snapshot();
        expect(after).toEqual(before);
      } finally {
        await pool.query(
          `DROP TRIGGER fail_document_review_delivery ON ${table}; DROP FUNCTION fail_document_review_delivery()`
        );
      }
    }
}
