import type { Pool } from 'pg';
import { expect } from 'vitest';

export async function expectOrderSubmitted(
  pool: Pool,
  input: {
    service: string;
    id: string;
    profileId: string;
    owner: string;
    table: string;
    route: string;
  }
) {
  const rows = (
    await pool.query(
      `SELECT o.*,n.recipient_user_id,n.operating_context,n.type,n.localized_content,n.link_route,n.id AS notice_id
     FROM notification_outbox o JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text
     WHERE o.idempotency_key=$1`,
      [`order.submitted:${input.service}:${input.id}:${input.owner}`]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const submittedAt = (
    await pool.query(`SELECT submitted_at FROM ${input.table} WHERE id=$1`, [input.id])
  ).rows[0].submitted_at as Date;
  expect(rows[0]).toMatchObject({
    profile_id: input.profileId,
    user_id: input.owner,
    event_key: 'order.submitted',
    channels: ['in_app', 'email'],
    payload: {
      orderNumber: input.id,
      submittedAt: submittedAt.toISOString(),
      link_route: `${input.route}/${input.id}`,
    },
    operating_context: 'customer',
    recipient_user_id: input.owner,
    type: 'order.submitted',
    link_route: `${input.route}/${input.id}`,
    localized_content: {
      fa: { title: expect.any(String), body: expect.any(String) },
      en: { title: expect.any(String), body: expect.any(String) },
    },
  });
  expect(rows[0].localized_content.fa.title).toMatch(/[\u0600-\u06ff]/);
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [rows[0].id]
      )
    ).rows
  ).toEqual([
    { channel: 'email', status: 'queued', attempts: 0, provider_ref: null },
    { channel: 'in_app', status: 'done', attempts: 1, provider_ref: rows[0].notice_id },
  ]);
  expect(
    (
      await pool.query(
        'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
        [rows[0].id]
      )
    ).rows
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: rows[0].notice_id },
  ]);
}

/** Native HTTP failure leaves all business rows unchanged; session/rate-limit activity is outside that transaction. */
export async function expectSubmissionNotificationRollback(
  pool: Pool,
  submit: () => Promise<Response>
) {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('sessions','rate_limit_counters','rate_limit_windows') ORDER BY tablename"
    )
  ).rows.map((row) => row.tablename as string);
  const snapshot = async () => {
    const entries = await Promise.all(
      tables.map(async (table) => {
        const name = '"' + table.replaceAll('"', '""') + '"';
        return [
          table,
          (
            await pool.query(
              `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM ${name} t`
            )
          ).rows[0].rows,
        ] as const;
      })
    );
    return Object.fromEntries(entries);
  };
  for (const mode of ['raise', 'suppress'] as const) {
    const before = await snapshot();
    await pool.query(
      `CREATE FUNCTION fail_order_submission_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_key='order.submitted' THEN ${mode === 'raise' ? "RAISE EXCEPTION 'order notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_order_submission_notice BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION fail_order_submission_notice()`
    );
    try {
      expect((await submit()).status).toBe(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_order_submission_notice ON notification_outbox; DROP FUNCTION fail_order_submission_notice()'
      );
    }
  }
}
