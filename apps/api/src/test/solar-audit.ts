import type { Pool } from 'pg';
import { expect } from 'vitest';

export async function expectSolarAudit(
  pool: Pool,
  event: string,
  entityId: string,
  metadata: Record<string, unknown>
) {
  const rows = (
    await pool.query(
      `SELECT *,metadata::jsonb AS parsed FROM audit_log WHERE event=$1 AND metadata::jsonb->>'entityId'=$2 AND metadata::jsonb @> $3::jsonb`,
      [event, entityId, JSON.stringify(metadata)]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row.user_id).toBe(metadata.actor);
  expect(row.created_at).toBeInstanceOf(Date);
  expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(row.ip).toBe('127.0.0.1');
  expect(row.parsed).toMatchObject({ ...metadata, entityId });
  return row;
}
export async function expectSolarPostalAudit(
  pool: Pool,
  event: string,
  requestId: string,
  metadata: Record<string, unknown>
) {
  const postal = (
    await pool.query('SELECT id FROM solar_construction_postal WHERE request_id=$1', [requestId])
  ).rows[0]!;
  return expectSolarAudit(pool, event, postal.id, {
    entity: 'solar_construction_postal',
    requestId,
    ...metadata,
  });
}
export async function expectSolarAuditRollback(
  pool: Pool,
  event: string,
  work: () => Promise<Response>
) {
  const snapshot = async () =>
    (
      await pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM solar_construction_requests r) AS requests,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM solar_construction_postal p) AS postal,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM solar_construction_progress_events p) AS progress,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM contracts c) AS contracts,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM invoices i) AS invoices,
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a) AS audits,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM in_app_notifications n) AS notices,
    (SELECT jsonb_agg(to_jsonb(k) ORDER BY entity_type,idempotency_key) FROM idempotency_keys k) AS keys,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY key) FROM app_config c) AS config,
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM config_version c) AS configVersion`)
    ).rows[0];
  const before = await snapshot();
  await pool.query(
    `CREATE FUNCTION reject_solar_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'solar audit unavailable'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_solar_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_solar_audit()`
  );
  try {
    const response = await work();
    expect(response.status, await response.clone().text()).toBe(500);
    expect(await snapshot()).toEqual(before);
  } finally {
    await pool.query(
      'DROP TRIGGER reject_solar_audit ON audit_log;DROP FUNCTION reject_solar_audit()'
    );
  }
}
