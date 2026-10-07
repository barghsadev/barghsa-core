import type { Pool } from 'pg';
import { expect } from 'vitest';

export async function expectConsultationStatusDeliveries(
  pool: Pool,
  id: string,
  owner: string,
  statuses: string[]
) {
  const events = (
    await pool.query(
      'SELECT id,status FROM consultation_request_events WHERE request_id=$1 ORDER BY created_at,id',
      [id]
    )
  ).rows;
  const transitions = events.filter((r, i) => i > 0 && r.status !== events[i - 1].status);
  expect(transitions.map((r) => r.status)).toEqual(statuses);
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='order.status_changed' AND payload->>'orderNumber'=$1 ORDER BY created_at,id",
      [id]
    )
  ).rows;
  expect(rows).toHaveLength(statuses.length);
  for (let i = 0; i < rows.length; i++) {
    expect(rows[i]).toMatchObject({
      user_id: owner,
      event_key: 'order.status_changed',
      channels: ['in_app', 'email'],
      idempotency_key: `order.status_changed:consultation:${id}:${transitions[i].id}:${owner}`,
      payload: {
        orderNumber: id,
        status: statuses[i],
        newStatus: expect.stringMatching(/[\u0600-\u06ff].* \/ .*[A-Za-z]/),
        link_route: `/consultations/${id}`,
      },
    });
    const inbox = (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [rows[i].id]
      )
    ).rows;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      recipient_user_id: owner,
      operating_context: 'customer',
      profile_id: rows[i].profile_id,
      type: 'order.status_changed',
      link_route: `/consultations/${id}`,
    });
    expect(inbox[0].localized_content.fa.body).toMatch(/[\u0600-\u06ff]/);
    expect(inbox[0].localized_content.en.body).toMatch(/[A-Za-z]/);
    expect(
      (
        await pool.query(
          'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
          [rows[i].id]
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
          [rows[i].id]
        )
      ).rows
    ).toEqual([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
    ]);
  }
  return rows;
}

export async function expectConsultationStatusRollback(
  pool: Pool,
  id: string,
  status: string,
  work: () => Promise<Response>
) {
  const tables = (
    await pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('sessions','rate_limit_counters','rate_limit_windows') ORDER BY tablename"
    )
  ).rows.map((r) => r.tablename as string);
  async function snapshot() {
    return Object.fromEntries(
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
  }
  for (const mode of ['raise', 'suppress']) {
    const before = await snapshot();
    await pool.query(
      `CREATE FUNCTION fail_consultation_status_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_key='order.status_changed' AND NEW.payload->>'orderNumber'='${id}' AND NEW.payload->>'status'='${status}' THEN ${mode === 'raise' ? "RAISE EXCEPTION 'consultation status notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_consultation_status_notice BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION fail_consultation_status_notice()`
    );
    try {
      expect((await work()).status).toBe(500);
      expect(await snapshot()).toEqual(before);
    } finally {
      await pool.query(
        'DROP TRIGGER fail_consultation_status_notice ON notification_outbox; DROP FUNCTION fail_consultation_status_notice()'
      );
    }
  }
}
