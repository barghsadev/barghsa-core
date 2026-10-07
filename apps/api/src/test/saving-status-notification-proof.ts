import type { Pool } from 'pg';
import { expect } from 'vitest';

export async function expectSavingStatusDeliveries(
  pool: Pool,
  id: string,
  owner: string,
  statuses: string[]
) {
  const rows = (
    await pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='order.status_changed' AND payload->>'orderNumber'=$1 ORDER BY created_at,id",
      [id]
    )
  ).rows;
  expect(rows.map((r) => r.payload.status)).toEqual(statuses);
  for (const row of rows) {
    const prefix = `order.status_changed:saving:${id}:`,
      suffix = `:${owner}`;
    expect(row.idempotency_key.startsWith(prefix)).toBe(true);
    expect(row.idempotency_key.endsWith(suffix)).toBe(true);
    expect(row.idempotency_key.slice(prefix.length, -suffix.length)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(row).toMatchObject({
      user_id: owner,
      channels: ['in_app', 'email'],
      payload: {
        orderNumber: id,
        newStatus: expect.stringMatching(/[\u0600-\u06ff].* \/ .*[A-Za-z]/),
        link_route: `/savings/orders/${id}`,
      },
    });
    const inbox = (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [row.id]
      )
    ).rows;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      recipient_user_id: owner,
      profile_id: row.profile_id,
      operating_context: 'customer',
      type: 'order.status_changed',
      link_route: `/savings/orders/${id}`,
    });
    expect(inbox[0].localized_content.fa.body).toMatch(/[\u0600-\u06ff]/);
    expect(inbox[0].localized_content.en.body).toMatch(/[A-Za-z]/);
    expect(
      (
        await pool.query(
          'SELECT channel,status,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
          [row.id]
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
          [row.id]
        )
      ).rows
    ).toEqual([
      { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
    ]);
  }
  return rows;
}
export async function savingDeliverySnapshot(pool: Pool, id: string) {
  const outbox = (
      await pool.query(
        "SELECT * FROM notification_outbox WHERE event_key='order.status_changed' AND payload->>'orderNumber'=$1 ORDER BY id",
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
export async function expectSavingStatusRollback(
  pool: Pool,
  id: string,
  status: string,
  work: () => Promise<Response>,
  outboxOnly = false
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
  const match = `event_key='order.status_changed' AND payload->>'orderNumber'='${id}' AND payload->>'status'='${status}'`;
  for (const [table, predicate] of [
    [
      'notification_outbox',
      `NEW.event_key='order.status_changed' AND NEW.payload->>'orderNumber'='${id}' AND NEW.payload->>'status'='${status}'`,
    ],
    ...(!outboxOnly
      ? [
          [
            'in_app_notifications',
            `NEW.type='order.status_changed' AND NEW.link_route='/savings/orders/${id}'`,
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
    for (const mode of ['raise', 'suppress']) {
      const before = await snapshot();
      await pool.query(
        `CREATE FUNCTION fail_saving_status_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'saving status notice unavailable';" : 'RETURN NULL;'} END IF; RETURN NEW; END $$; CREATE TRIGGER fail_saving_status_notice BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_saving_status_notice()`
      );
      try {
        expect((await work()).status).toBe(500);
        const after = await snapshot();
        expect(after).toEqual(before);
      } finally {
        await pool.query(
          `DROP TRIGGER fail_saving_status_notice ON ${table}; DROP FUNCTION fail_saving_status_notice()`
        );
      }
    }
}
