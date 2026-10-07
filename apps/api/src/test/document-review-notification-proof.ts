import { expect } from 'vitest';
import type { Pool } from 'pg';

export async function expectDocumentReviewDelivery(
  pool: Pool,
  id: string,
  revision: number,
  profile: string,
  user: string,
  reason?: string
) {
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='document.review_completed' AND payload->>'documentId'=$1",
      [id]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    profile_id: profile,
    user_id: user,
    event_key: 'document.review_completed',
    channels: ['in_app', 'email'],
    max_attempts: 5,
    idempotency_key: `document.review_completed:${id}:${revision}:${user}`,
    payload: {
      documentId: id,
      documentName: 'evidence.pdf',
      reviewResult: expect.stringMatching(/[\u0600-\u06ff].* \/ .*[A-Za-z]/),
    },
  });
  if (reason) expect(rows[0].payload.reviewResult).toContain(reason);
  const inbox = (
    await pool.query("SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
      rows[0].id,
    ])
  ).rows;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    profile_id: profile,
    recipient_user_id: user,
    operating_context: 'customer',
    type: 'document.review_completed',
    link_route: null,
  });
  expect(inbox[0].localized_content.fa.body).toMatch(/[\u0600-\u06ff]/);
  expect(inbox[0].localized_content.en.body).toContain(id);
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [rows[0].id]
      )
    ).rows
  ).toEqual([
    { channel: 'email', status: 'queued', attempts: 0, provider_ref: null },
    { channel: 'in_app', status: 'done', attempts: 1, provider_ref: inbox[0].id },
  ]);
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
        [rows[0].id]
      )
    ).rows
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
  ]);
  return rows[0];
}
export async function documentReviewDeliverySnapshot(pool: Pool, id: string) {
  const outbox = (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE event_key='document.review_completed' AND payload->>'documentId'=$1 ORDER BY id",
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
    logs: (
      await pool.query(
        'SELECT * FROM notification_delivery_log WHERE notification_id=ANY($1::uuid[]) ORDER BY id',
        [ids]
      )
    ).rows,
  };
}

export async function expectDocumentReviewRollback(
  pool: Pool,
  id: string,
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
  const match = `event_key='document.review_completed' AND payload->>'documentId'='${id}'`;
  for (const [table, predicate] of [
    [
      'notification_outbox',
      `NEW.event_key='document.review_completed' AND NEW.payload->>'documentId'='${id}'`,
    ],
    ...(!outboxOnly
      ? [
          [
            'in_app_notifications',
            `NEW.type='document.review_completed' AND EXISTS(SELECT 1 FROM notification_outbox WHERE 'outbox:'||id::text=NEW.delivery_key AND ${match})`,
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
