import {
  expectContractCustomerDelivery,
  expectContractNoticeRollback,
} from '../test/contract-notification-proof.js';
import { expectCancellationRequestDelivery } from '../test/cancellation-request-notification-proof.js';
import {
  expectSavingStatusDeliveries,
  expectSavingStatusRollback,
  savingDeliverySnapshot,
} from '../test/saving-status-notification-proof.js';
import { notifySavingStatus } from './saving-status-notifications.js';
import { expectCoreAudit } from '../test/core-audit.js';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { activateReadyContracts } from '@barghsa/db/contract-activation';
import { runWalletRefund } from '@barghsa/db/refund-processing';
import { expireSavingInventory } from '@barghsa/db/saving-inventory';
import { startHttpFixture } from '../test/http-fixture.js';
import { expectSubmissionAudit } from '../test/submission-audit.js';
import {
  expectOrderSubmitted,
  expectSubmissionNotificationRollback,
} from '../test/order-submission-notifications.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let customerHeaders: Record<string, string>;
let staffHeaders: Record<string, string>;
let changeOutsiderHeaders: Record<string, string>;
let input: {
  profileId: string;
  savingPlanId: string;
  hardwareProductId: string;
  billIdentifier: string;
  installationAddressId: string;
  agreementVersionId: string;
};
let legalProfileId: string;

function request(path: string, method: string, body?: unknown, headers = customerHeaders) {
  return fetch(`${http.base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function savingChangeSnapshot(id: string) {
  return (
    await http.pool.query(
      `SELECT to_jsonb(s) AS saving_row,
        (SELECT to_jsonb(o) FROM orders o WHERE o.id=s.order_id) AS order_row,
        (SELECT to_jsonb(c) FROM contracts c WHERE c.order_id=s.order_id AND c.service_type='savings') AS contract_row,
        (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM invoices i WHERE i.order_id=s.order_id) AS invoices,
        (SELECT jsonb_agg(to_jsonb(v) ORDER BY version_number) FROM contract_versions v JOIN contracts c ON c.id=v.contract_id WHERE c.order_id=s.order_id) AS versions,
        (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM saving_order_revisions r WHERE r.order_id=s.id) AS revisions,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM saving_address_amendments a WHERE a.order_id=s.id) AS amendments,
        (SELECT jsonb_agg(to_jsonb(f) ORDER BY stage) FROM saving_fulfillment_stages f WHERE f.order_id=s.id) AS stages,
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM products p) AS products,
        (SELECT jsonb_agg(to_jsonb(k) ORDER BY idempotency_key) FROM idempotency_keys k WHERE entity_type='saving_address_amendment') AS keys,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE event IN ('saving.address_amended','saving.order.changed')) AS audits,
        (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM in_app_notifications n WHERE recipient_user_id='saving-order-buyer') AS notices
       FROM saving_orders s WHERE s.id=$1`,
      [id]
    )
  ).rows[0];
}

async function rejectedSavingChange(
  id: string,
  path: string,
  body: unknown,
  headers: Record<string, string>,
  fields?: string[],
  status = 400
) {
  const before = await savingChangeSnapshot(id);
  const response = await request(path, 'POST', body, headers);
  expect(response.status, http.logs()).toBe(status);
  const failure = await response.json();
  expect(failure).toHaveProperty('error.correlationId', expect.stringMatching(/^[0-9a-f-]{36}$/i));
  expect(JSON.stringify(failure)).not.toContain('PRIVATE');
  if (status === 400)
    expect(failure).toHaveProperty(
      'error.code',
      fields || body === null ? 'VALIDATION:INPUT:INVALID' : 'VALIDATION:INPUT_INVALID'
    );
  if (fields) expect(failure).toHaveProperty('error.fields', fields);
  else expect(failure).not.toHaveProperty('error.fields');
  expect(await savingChangeSnapshot(id)).toEqual(before);
}

async function savingSystemSnapshot(id: string) {
  const effects = (
    await http.pool.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE event LIKE 'saving.inventory.%' OR event IN ('saving.hardware_upgrade_applied','saving.hardware_upgrade_closed')) AS audits,
    (SELECT jsonb_agg(to_jsonb(w) ORDER BY profile_id) FROM wallets w) AS balances,
    (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM wallet_transactions t) AS transactions,
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM invoices i) AS invoiceRows,
    (SELECT jsonb_agg(to_jsonb(k) ORDER BY entity_type,idempotency_key) FROM idempotency_keys k) AS keys`)
  ).rows[0];
  return { resource: await savingHardwareSnapshot(id), effects };
}

async function expectSavingSystemFailure(id: string, event: string, work: () => Promise<unknown>) {
  const before = await savingSystemSnapshot(id);
  await http.pool.query(
    `CREATE FUNCTION reject_saving_system_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='${event}' THEN RAISE EXCEPTION 'saving system audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_saving_system_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_saving_system_audit()`
  );
  try {
    await work();
    expect(await savingSystemSnapshot(id)).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_saving_system_audit ON audit_log;DROP FUNCTION reject_saving_system_audit()'
    );
  }
}

async function expectSavingUpgradeAudit(
  id: string,
  order: string,
  to: 'applied' | 'cancelled' | 'expired',
  reason: string,
  context: 'staff' | null
) {
  const rows = (
    await http.pool.query(
      `SELECT *,metadata::jsonb AS parsed FROM audit_log WHERE event=$1 AND metadata::jsonb->>'entityId'=$2`,
      [to === 'applied' ? 'saving.hardware_upgrade_applied' : 'saving.hardware_upgrade_closed', id]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0]!;
  expect(row).toMatchObject({ user_id: 'saving-order-staff', operating_context: context });
  expect(row.created_at).toBeInstanceOf(Date);
  expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(row.parsed).toMatchObject({
    entity: 'saving_hardware_upgrade_request',
    entityId: id,
    fromState: 'awaiting_payment',
    toState: to,
    reason,
    actor: 'system',
    actorType: 'system',
    profileId: input.profileId,
    affectedUserId: 'saving-order-staff',
    savingOrderId: order,
    upgradeId: id,
    invoiceFromState: 'Unpaid',
    invoiceToState: to === 'applied' ? 'Paid' : to === 'expired' ? 'Overdue' : 'Cancelled',
  });
}

async function expectSavingInventoryHistory(
  id: string,
  transitions?: Array<[string | null, string]>
) {
  const rows = (
    await http.pool.query(
      `SELECT *,metadata::jsonb AS parsed FROM audit_log WHERE event LIKE 'saving.inventory.%' AND metadata::jsonb->>'savingOrderId'=$1 ORDER BY created_at,id`,
      [id]
    )
  ).rows;
  const canonical = rows.filter((r) => r.parsed.kind === 'reservation_change');
  expect(canonical.length).toBeGreaterThan(0);
  if (transitions)
    expect(canonical.map((r) => [r.parsed.fromState, r.parsed.toState])).toEqual(transitions);
  let previous: (typeof canonical)[number] | undefined;
  for (const row of rows) {
    expect(row).toMatchObject({ user_id: 'saving-order-buyer' });
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.parsed).toMatchObject({
      entity: 'saving_inventory_reservation',
      entityId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      actor: 'system',
      actorType: 'system',
      profileId: input.profileId,
      affectedUserId: 'saving-order-buyer',
      savingOrderId: id,
      reason: null,
    });
    expect(row.parsed.entityId).toBe(row.parsed.reservationId);
    if (row.parsed.kind === 'reservation_change') {
      expect(row.parsed.fromState).toBe(previous?.parsed.toState ?? null);
      expect(row.parsed.previousHardwareProductId).toBe(previous?.parsed.hardwareProductId ?? null);
      previous = row;
    } else {
      expect(row.parsed.kind).toBe('inventory_action');
      expect(row.parsed.fromState).toBe(row.parsed.toState);
    }
  }
  const reservation = (
    await http.pool.query('SELECT * FROM saving_inventory_reservations WHERE order_id=$1', [id])
  ).rows[0]!;
  expect(previous!.parsed).toMatchObject({
    entityId: reservation.id,
    toState: reservation.status,
    hardwareProductId: reservation.hardware_product_id,
  });
}

async function savingHardwareSnapshot(id: string) {
  const effects = (
    await http.pool.query(
      `SELECT
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM saving_hardware_amendments a WHERE order_id=$1) AS amendments,
        (SELECT jsonb_agg(to_jsonb(u) ORDER BY id) FROM saving_hardware_upgrade_requests u WHERE order_id=$1) AS upgrades,
        (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM saving_inventory_reservations r WHERE order_id=$1) AS reservations,
        (SELECT jsonb_agg(to_jsonb(k) ORDER BY entity_type,idempotency_key) FROM idempotency_keys k WHERE entity_type IN ('saving_hardware_amendment','saving_hardware_upgrade_cancel')) AS keys,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE event IN ('saving.hardware_amended','saving.hardware_upgrade_requested','saving.hardware_upgrade_cancelled')) AS audits`,
      [id]
    )
  ).rows[0];
  return { resource: await savingChangeSnapshot(id), effects };
}

async function rejectedSavingHardware(
  id: string,
  path: string,
  body: unknown,
  fields?: string[],
  status = 400,
  headers = staffHeaders
) {
  const before = await savingHardwareSnapshot(id);
  await rejectedSavingChange(id, path, body, headers, fields, status);
  expect(await savingHardwareSnapshot(id)).toEqual(before);
}

async function hardwareFeedbackProbes(work: () => Promise<void>) {
  // Isolate only added invalid-input probes, then restore the original journeys' quotas.
  const keys = [
    'amend-hardware-review',
    'amend-hardware',
    'cancel-upgrade-review',
    'cancel-upgrade',
  ].map((name) => `saving:staff-${name}:user:127.0.0.1`);
  const saved = (
    await http.pool.query<{ value: unknown }>(
      'SELECT to_jsonb(r) AS value FROM rate_limit_windows r WHERE NOT security AND key=ANY($1::text[])',
      [keys]
    )
  ).rows.map((row) => row.value);
  await http.pool.query(
    'DELETE FROM rate_limit_windows WHERE NOT security AND key=ANY($1::text[])',
    [keys]
  );
  try {
    await work();
  } finally {
    await http.pool.query(
      'DELETE FROM rate_limit_windows WHERE NOT security AND key=ANY($1::text[])',
      [keys]
    );
    if (saved.length)
      await http.pool.query(
        'INSERT INTO rate_limit_windows SELECT * FROM jsonb_populate_recordset(NULL::rate_limit_windows,$1::jsonb)',
        [JSON.stringify(saved)]
      );
  }
}

async function savingOperationsSnapshot(id: string) {
  const effects = (
    await http.pool.query(
      `SELECT
        (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM saving_fulfillment_events e WHERE order_id=$1) AS events,
        (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.version_id) FROM contract_publications p JOIN contracts c ON c.id=p.contract_id WHERE c.order_id=s.order_id AND c.service_type='savings') AS publications,
        (SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM refund_obligations o WHERE order_id=s.order_id) AS obligations,
        (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM refunds r JOIN invoices i ON i.id=r.invoice_id WHERE i.order_id=s.order_id) AS refunds,
        (SELECT jsonb_agg(to_jsonb(k) ORDER BY entity_type,idempotency_key) FROM idempotency_keys k WHERE entity_type IN ('saving_staff_review','saving_stage_advance')) AS keys,
        (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE event LIKE 'saving.order_review.%' OR event LIKE 'saving.fulfillment.%') AS audits
       FROM saving_orders s WHERE s.id=$1`,
      [id]
    )
  ).rows[0];
  return { resource: await savingHardwareSnapshot(id), effects };
}

async function expectSavingStageAudits(id: string) {
  const events = (
    await http.pool.query(
      `SELECT e.*,s.id AS stage_id FROM saving_fulfillment_events e JOIN saving_fulfillment_stages s ON s.order_id=e.order_id AND s.stage=e.stage WHERE e.order_id=$1`,
      [id]
    )
  ).rows;
  const audits = (
    await http.pool.query(
      `SELECT user_id,operating_context,created_at,correlation_id,metadata::jsonb AS metadata FROM audit_log WHERE event='saving.fulfillment.stage_changed' AND metadata::jsonb->>'savingOrderId'=$1`,
      [id]
    )
  ).rows;
  expect(events.length).toBeGreaterThan(0);
  expect(audits).toHaveLength(events.length);
  for (const event of events) {
    const matches = audits.filter((a) => a.metadata.eventId === event.id);
    expect(matches).toHaveLength(1);
    const audit = matches[0]!;
    expect(audit.user_id).toBe(event.actor_user_id);
    expect(audit.operating_context).toBe(event.actor_context);
    expect(audit.created_at).toBeInstanceOf(Date);
    expect(audit.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.metadata).toMatchObject({
      entity: 'saving_fulfillment_stage',
      entityId: event.stage_id,
      fromState: event.from_status,
      toState: event.to_status,
      reason: event.explanation,
      stage: event.stage,
      handoverDescription: event.handover_description,
    });
    if (
      event.stage !== 'request_confirmation' &&
      ['completed', 'skipped'].includes(event.to_status)
    ) {
      const core = (
        await http.pool.query(
          `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event=$1 AND metadata::jsonb->>'entityId'=$2 AND metadata::jsonb->>'stage'=$3`,
          [
            'saving.fulfillment.' + (event.to_status === 'skipped' ? 'skip' : 'complete'),
            id,
            event.stage,
          ]
        )
      ).rows;
      expect(core).toHaveLength(1);
      expect(core[0].metadata).toMatchObject({
        entity: 'saving_order',
        entityId: id,
        fromState: event.stage === 'product_delivery' ? 'approved' : 'in_progress',
        toState: event.stage === 'process_completion' ? 'completed' : 'in_progress',
        reason: event.explanation,
      });
    }
  }
}

async function expectSavingRevisionStageAuditRollback(id: string, work: () => Promise<Response>) {
  const before = await savingOperationsSnapshot(id);
  await http.pool.query(
    `CREATE FUNCTION reject_saving_stage_reset_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='saving.fulfillment.stage_reset' THEN RAISE EXCEPTION 'revision stage audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_saving_stage_reset_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_saving_stage_reset_audit()`
  );
  try {
    const response = await work();
    expect(response.status, http.logs()).toBe(500);
    expect(await savingOperationsSnapshot(id)).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_saving_stage_reset_audit ON audit_log;DROP FUNCTION reject_saving_stage_reset_audit()'
    );
  }
}
async function expectSavingStageResetAudits(
  id: string,
  before: { id: string; stage: string; status: string }[],
  versionId: string,
  previousVersionId: string
) {
  const rows = (
    await http.pool.query(
      `SELECT user_id,operating_context,created_at,correlation_id,metadata::jsonb AS metadata FROM audit_log WHERE event='saving.fulfillment.stage_reset' AND metadata::jsonb->>'savingOrderId'=$1`,
      [id]
    )
  ).rows;
  const changed = before.filter((s) => s.status !== 'pending');
  expect(changed).toHaveLength(2);
  expect(rows).toHaveLength(changed.length);
  for (const stage of changed) {
    const matches = rows.filter((r) => r.metadata.entityId === stage.id);
    expect(matches).toHaveLength(1);
    const audit = matches[0]!;
    expect(audit.user_id).toBe('saving-order-buyer');
    expect(audit.operating_context).toBe('customer');
    expect(audit.created_at).toBeInstanceOf(Date);
    expect(audit.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(audit.metadata).toMatchObject({
      entity: 'saving_fulfillment_stage',
      entityId: stage.id,
      fromState: stage.status,
      toState: 'pending',
      reason: null,
      stage: stage.stage,
      source: 'customer_revision',
      versionId,
      previousVersionId,
    });
  }
}

async function expectSavingStageWriteRollback(
  id: string,
  stage: string,
  work: () => Promise<Response>
) {
  const before = await savingOperationsSnapshot(id);
  await http.pool.query(
    `CREATE FUNCTION skip_saving_stage_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.stage='${stage}' THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER skip_saving_stage_update BEFORE UPDATE ON saving_fulfillment_stages FOR EACH ROW EXECUTE FUNCTION skip_saving_stage_update()`
  );
  try {
    const response = await work();
    expect(response.status, http.logs()).toBe(409);
    expect(await savingOperationsSnapshot(id)).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER skip_saving_stage_update ON saving_fulfillment_stages;DROP FUNCTION skip_saving_stage_update()'
    );
  }
}

async function expectSavingStageAuditRollback(id: string, work: () => Promise<Response>) {
  const before = await savingOperationsSnapshot(id);
  await http.pool.query(
    `CREATE FUNCTION reject_saving_stage_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='saving.fulfillment.stage_changed' THEN RAISE EXCEPTION 'stage audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_saving_stage_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_saving_stage_audit()`
  );
  try {
    const response = await work();
    expect(response.status, http.logs()).toBe(500);
    expect(await savingOperationsSnapshot(id)).toEqual(before);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_saving_stage_audit ON audit_log;DROP FUNCTION reject_saving_stage_audit()'
    );
  }
}

async function rejectedSavingOperations(
  id: string,
  path: string,
  body: unknown,
  fields?: string[],
  status = 400,
  headers = staffHeaders
) {
  const before = await savingOperationsSnapshot(id);
  await rejectedSavingChange(id, path, body, headers, fields, status);
  expect(await savingOperationsSnapshot(id)).toEqual(before);
}

async function operationsFeedbackProbes(work: () => Promise<void>) {
  // Preserve the original journey quotas around only this batch's invalid-input probes.
  const keys = ['staff-financial-review', 'staff-review', 'stage-review', 'stage-advance'].map(
    (name) => `saving:${name}:user:127.0.0.1`
  );
  const saved = (
    await http.pool.query<{ value: unknown }>(
      'SELECT to_jsonb(r) AS value FROM rate_limit_windows r WHERE NOT security AND key=ANY($1::text[])',
      [keys]
    )
  ).rows.map((row) => row.value);
  await http.pool.query(
    'DELETE FROM rate_limit_windows WHERE NOT security AND key=ANY($1::text[])',
    [keys]
  );
  try {
    await work();
  } finally {
    await http.pool.query(
      'DELETE FROM rate_limit_windows WHERE NOT security AND key=ANY($1::text[])',
      [keys]
    );
    if (saved.length)
      await http.pool.query(
        'INSERT INTO rate_limit_windows SELECT * FROM jsonb_populate_recordset(NULL::rate_limit_windows,$1::jsonb)',
        [JSON.stringify(saved)]
      );
  }
}

async function decisionReview(orderId: string, action: 'approve' | 'reject', reason = '') {
  const response = await request(
    `/api/staff/saving/orders/${orderId}/financial-review`,
    'POST',
    { action, reason },
    staffHeaders
  );
  expect(response.status, http.logs()).toBe(200);
  return (await response.json()) as {
    hash: string;
    data: { outcome: string; refundAmount: string; invoiceId: string };
  };
}

async function hardwareAmendmentReview(
  orderId: string,
  input: {
    expectedVersionId: string;
    expectedHardwareId: string;
    hardwareProductId: string;
    reason: string;
  }
) {
  const response = await request(
    `/api/staff/saving/orders/${orderId}/amend-hardware-review`,
    'POST',
    {
      expectedVersionId: input.expectedVersionId,
      expectedHardwareId: input.expectedHardwareId,
      hardwareProductId: input.hardwareProductId,
      reason: input.reason,
    },
    staffHeaders
  );
  expect(response.status, http.logs()).toBe(200);
  return (await response.json()) as {
    hash: string;
    data: { outcome: string; priceDeltaIrR: string; targetAvailableCount: number };
  };
}

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    `INSERT INTO staff_roles(role_id,name,description,permissions)
     VALUES('saving-order-admin','Saving order','Test role','["admin:catalogue:edit","admin:financial:edit","contracts:read","contracts:write","invoices:write"]')`
  );
  for (const [user, staff] of [
    ['saving-order-buyer', false],
    ['saving-order-staff', true],
    ['saving-change-outsider', false],
  ] as const) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',$3)",
      [user, `${user}@example.test`, staff]
    );
    if (staff)
      await http.pool.query(
        "INSERT INTO user_roles(user_id,role_id) VALUES($1,'saving-order-admin')",
        [user]
      );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, randomUUID()]
    );
    const headers = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
    if (staff) staffHeaders = headers;
    else if (user === 'saving-change-outsider') changeOutsiderHeaders = headers;
    else customerHeaders = headers;
  }
  const profileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('saving-order-buyer','INDIVIDUAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0]!.id;
  legalProfileId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES('saving-order-buyer','LEGAL','ACTIVE',false) RETURNING id"
    )
  ).rows[0]!.id;
  const provinceId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO provinces(name_fa,name_en) VALUES('استان تست','Test Province') RETURNING id"
    )
  ).rows[0]!.id;
  const cityId = (
    await http.pool.query<{ id: string }>(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر تست','Test City') RETURNING id",
      [provinceId]
    )
  ).rows[0]!.id;
  const addressId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
     VALUES($1,$2,$3,'Test installation address','1234567890',true) RETURNING id`,
      [profileId, provinceId, cityId]
    )
  ).rows[0]!.id;
  const hardwareResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه', en: 'Device' },
      description: { fa: 'تجهیز', en: 'Equipment' },
      price: '200000',
      status: 'active',
    },
    staffHeaders
  );
  expect(hardwareResponse.status, http.logs()).toBe(201);
  const hardware = (await hardwareResponse.json()) as { id: string };
  const inventory = await request(
    `/api/admin/catalogue/hardware/${hardware.id}/inventory`,
    'PUT',
    { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
    staffHeaders
  );
  expect(inventory.status, http.logs()).toBe(200);
  expect(await inventory.json()).toMatchObject({
    stockTracking: true,
    stockCount: 2,
    reservedCount: 0,
  });
  const inventoryRead = await request(
    `/api/admin/catalogue/hardware/${hardware.id}/inventory`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(inventoryRead.status, http.logs()).toBe(200);
  expect(await inventoryRead.json()).toMatchObject({ reservationMinutes: 30 });
  const planResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'saving_plan',
      title: { fa: 'طرح', en: 'Plan' },
      description: { fa: 'صرفه‌جویی', en: 'Saving' },
      price: '100000',
      status: 'inactive',
      hardwareIds: [hardware.id],
    },
    staffHeaders
  );
  expect(planResponse.status, http.logs()).toBe(201);
  const plan = (await planResponse.json()) as { id: string };
  const draftResponse = await request(
    `/api/admin/catalogue/saving-plans/${plan.id}/agreements/draft`,
    'POST',
    { title: 'Test terms', body: 'The customer agrees to the plan.' },
    staffHeaders
  );
  expect(draftResponse.status, http.logs()).toBe(201);
  const agreement = (await draftResponse.json()) as { id: string };
  expect(
    (
      await request(
        `/api/admin/catalogue/saving-plans/${plan.id}/agreements/${agreement.id}/activate`,
        'POST',
        undefined,
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(201);
  expect(
    (
      await request(
        `/api/admin/catalogue/products/${plan.id}`,
        'PUT',
        { status: 'active' },
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  await http.pool.query(
    `INSERT INTO vat_configurations(category,rate,effective_from,created_by)
     VALUES('saving_plan',900,NOW()-INTERVAL '1 day','saving-order-staff')`
  );
  input = {
    profileId,
    savingPlanId: plan.id,
    hardwareProductId: hardware.id,
    billIdentifier: '1234567890123',
    installationAddressId: addressId,
    agreementVersionId: agreement.id,
  };
}, 60000);

afterAll(async () => {
  await http?.close();
}, 15000);

beforeEach(async () => {
  // These scenarios share a profile but represent separate customer sessions.
  await http.pool.query("UPDATE saving_orders SET submitted_at=NOW()-INTERVAL '2 minutes'");
});

it('resumes a profile-owned saving form draft and rejects invalid or expired progress', async () => {
  const path = `/api/saving/orders/draft?profileId=${input.profileId}`;
  const empty = await request(path, 'GET');
  expect(empty.status, http.logs()).toBe(200);
  expect(await empty.json()).toMatchObject({ currentStep: 1, data: null });
  const data = {
    planId: input.savingPlanId,
    hardwareId: input.hardwareProductId,
    billIdentifier: input.billIdentifier,
    addressId: input.installationAddressId,
    giftCode: '',
  };
  const saved = await request(path, 'PUT', { profileId: input.profileId, currentStep: 5, data });
  expect(saved.status, http.logs()).toBe(200);
  expect(await saved.json()).toMatchObject({ currentStep: 5, data });
  const resumed = await request(path, 'GET');
  expect(await resumed.json()).toMatchObject({ currentStep: 5, data });
  const invalid = await request(path, 'PUT', {
    profileId: input.profileId,
    currentStep: 5,
    data: { ...data, addressId: 'wrong' },
  });
  expect(invalid.status, http.logs()).toBe(400);
  const legal = await request(`/api/saving/orders/draft?profileId=${legalProfileId}`, 'GET');
  expect(legal.status, http.logs()).toBe(404);
  await http.pool.query(
    "UPDATE saving_customer_drafts SET updated_at=NOW()-INTERVAL '8 days' WHERE profile_id=$1",
    [input.profileId]
  );
  const expired = await request(path, 'GET');
  expect(await expired.json()).toMatchObject({ currentStep: 1, data: null });
});

it('quotes net VAT, rejects legal profiles, and atomically submits once', async () => {
  const legal = await request('/api/saving/orders/quote', 'POST', {
    ...input,
    profileId: legalProfileId,
  });

  expect(legal.status, http.logs()).toBe(400);
  const quoteResponse = await request('/api/saving/orders/quote', 'POST', input);
  expect(quoteResponse.status, http.logs()).toBe(201);
  const quote = (await quoteResponse.json()) as {
    reviewDigest: string;
    totalIrR: string;
    vatIrR: string;
  };
  expect(quote.vatIrR).toBe('9000');
  expect(quote.totalIrR).toBe('309000');
  const beforeDuplicate = await request('/api/saving/orders/duplicate', 'POST', {
    profileId: input.profileId,
    savingPlanId: input.savingPlanId,
    billIdentifier: input.billIdentifier,
  });
  expect(beforeDuplicate.status, http.logs()).toBe(201);
  expect(await beforeDuplicate.json()).toEqual({
    duplicate: false,
    preventActiveDuplicates: true,
    existingOrderId: null,
  });
  const verification = await request('/api/saving/orders/verify-bill', 'POST', {
    profileId: input.profileId,
    billIdentifier: input.billIdentifier,
  });
  expect(verification.status, http.logs()).toBe(201);
  expect(await verification.json()).toMatchObject({ status: 'not_configured' });
  const stale = await request('/api/saving/orders', 'POST', {
    ...input,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: '0'.repeat(64),
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(stale.status, http.logs()).toBe(409);
  const submission = {
    ...input,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  };
  const draftBeforeSubmit = await request('/api/saving/orders/draft', 'PUT', {
    profileId: input.profileId,
    currentStep: 6,
    data: {
      planId: input.savingPlanId,
      hardwareId: input.hardwareProductId,
      billIdentifier: input.billIdentifier,
      addressId: input.installationAddressId,
      giftCode: '',
    },
  });
  expect(draftBeforeSubmit.status, http.logs()).toBe(200);
  await expectSubmissionNotificationRollback(http.pool, () =>
    request('/api/saving/orders', 'POST', submission)
  );
  const first = await request('/api/saving/orders', 'POST', submission);
  expect(first.status, http.logs()).toBe(201);
  const clearedDraft = await request(
    `/api/saving/orders/draft?profileId=${input.profileId}`,
    'GET'
  );
  expect(await clearedDraft.json()).toMatchObject({ currentStep: 1, data: null });
  const result = (await first.json()) as {
    savingOrderId: string;
    orderId: string;
    contractId: string;
    invoiceId: string;
  };
  expect((await request(`/api/contracts/${result.contractId}`, 'GET')).status).toBe(404);
  const afterDuplicate = await request('/api/saving/orders/duplicate', 'POST', {
    profileId: input.profileId,
    savingPlanId: input.savingPlanId,
    billIdentifier: input.billIdentifier,
  });
  expect(afterDuplicate.status, http.logs()).toBe(201);
  expect(await afterDuplicate.json()).toEqual({
    duplicate: true,
    preventActiveDuplicates: true,
    existingOrderId: result.savingOrderId,
  });
  const retry = await request('/api/saving/orders', 'POST', submission);
  expect(retry.status, http.logs()).toBe(201);
  expect(await retry.json()).toEqual(result);
  await expectOrderSubmitted(http.pool, {
    service: 'saving',
    id: result.savingOrderId,
    profileId: input.profileId,
    owner: 'saving-order-buyer',
    table: 'saving_orders',
    route: '/savings/orders',
  });
  await expectSubmissionAudit(http.pool, {
    event: 'order_created',
    actor: 'saving-order-buyer',
    entity: 'saving_order',
    id: result.savingOrderId,
    state: 'awaiting_staff_review',
  });
  const archiveAuditBefore = (
    await http.pool.query("SELECT id FROM audit_log WHERE event='catalogue_product_archived'")
  ).rows;
  for (const productId of [input.savingPlanId, input.hardwareProductId]) {
    const archive = await request(
      `/api/admin/catalogue/products/${productId}`,
      'DELETE',
      undefined,
      staffHeaders
    );
    expect(archive.status, http.logs()).toBe(409);
  }
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='catalogue_product_archived'"))
      .rows
  ).toEqual(archiveAuditBefore);
  const detail = await request(`/api/saving/orders/${result.savingOrderId}`, 'GET');
  expect(detail.status, http.logs()).toBe(200);
  const invoiceDetails = await request(`/api/invoices/${result.invoiceId}`, 'GET');
  expect(invoiceDetails.status, http.logs()).toBe(200);
  expect(await invoiceDetails.json()).toMatchObject({ savingOrderId: result.savingOrderId });
  expect(await detail.json()).toMatchObject({
    status: 'awaiting_staff_review',
    financial_status: 'unpaid',
    invoice_state: 'Unpaid',
    agreement_snapshot: 'Test terms\nThe customer agrees to the plan.',
    agreement_updated: false,
    cancellation_pending: false,
    contract_state: 'AwaitingStaffReview',
    stages: [
      { stage: 'request_confirmation' },
      { stage: 'product_delivery' },
      { stage: 'installation_and_document_upload' },
      { stage: 'equipment_handover' },
      { stage: 'process_completion' },
    ],
  });
  const list = await request(`/api/saving/orders?profileId=${input.profileId}`, 'GET');
  expect(list.status, http.logs()).toBe(200);
  expect(await list.json()).toMatchObject({
    orders: [{ id: result.savingOrderId, cancellation_pending: false, financial_status: 'unpaid' }],
    nextBefore: null,
  });
  const pendingList = await request(
    `/api/saving/orders?profileId=${input.profileId}&status=pending`,
    'GET'
  );
  expect(pendingList.status, http.logs()).toBe(200);
  expect(await pendingList.json()).toMatchObject({
    orders: [{ id: result.savingOrderId }],
  });
  const filtered = await request(
    `/api/saving/orders?profileId=${input.profileId}&statuses=submitted,awaiting_staff_review`,
    'GET'
  );
  expect(filtered.status, http.logs()).toBe(200);
  expect(await filtered.json()).toMatchObject({ orders: [{ id: result.savingOrderId }] });
  for (const q of [result.savingOrderId, input.billIdentifier, 'plan', 'دستگاه']) {
    const query = new URLSearchParams({
      profileId: input.profileId,
      q,
      sort: 'submitted_at:asc',
      statuses: 'submitted,awaiting_staff_review',
    });
    const searched = await request(`/api/saving/orders?${query}`, 'GET');
    expect(searched.status, http.logs()).toBe(200);
    expect(await searched.json()).toMatchObject({
      orders: [{ id: result.savingOrderId }],
      nextBefore: null,
    });
    query.set('before', result.savingOrderId);
    expect(await (await request(`/api/saving/orders?${query}`, 'GET')).json()).toEqual({
      orders: [],
      nextBefore: null,
    });
  }
  const literal = new URLSearchParams({ profileId: input.profileId, q: '%' });
  expect(await (await request(`/api/saving/orders?${literal}`, 'GET')).json()).toEqual({
    orders: [],
    nextBefore: null,
  });
  literal.set('before', result.savingOrderId);
  expect((await request(`/api/saving/orders?${literal}`, 'GET')).status).toBe(404);
  for (const query of [{ sort: 'status:asc' }, { q: 'a'.repeat(121) }]) {
    const params = new URLSearchParams({ profileId: input.profileId, ...query });
    expect((await request(`/api/saving/orders?${params}`, 'GET')).status).toBe(400);
  }
  const rangeId = result.savingOrderId;
  const oldTime = (
    await http.pool.query<{ submitted_at: Date }>(
      'SELECT submitted_at FROM saving_orders WHERE id=$1',
      [rangeId]
    )
  ).rows[0]!.submitted_at;
  const start = '2027-01-01T10:00:00.000Z';
  const end = '2027-01-01T10:00:01.000Z';
  await http.pool.query('UPDATE saving_orders SET submitted_at=$2 WHERE id=$1', [rangeId, start]);
  const range = new URLSearchParams({ profileId: input.profileId, from: start, to: end });
  const ranged = await request(`/api/saving/orders?${range}`, 'GET');
  expect(ranged.status, http.logs()).toBe(200);
  expect(await ranged.json()).toMatchObject({ orders: [{ id: rangeId }], nextBefore: null });
  range.set('to', start);
  expect((await request(`/api/saving/orders?${range}`, 'GET')).status).toBe(400);
  range.delete('from');
  range.set('before', rangeId);
  expect((await request(`/api/saving/orders?${range}`, 'GET')).status).toBe(404);
  range.set('from', 'invalid-date');
  expect((await request(`/api/saving/orders?${range}`, 'GET')).status).toBe(400);
  await http.pool.query('UPDATE saving_orders SET submitted_at=$2 WHERE id=$1', [rangeId, oldTime]);
  const noMatch = await request(
    `/api/saving/orders?profileId=${input.profileId}&statuses=completed`,
    'GET'
  );
  expect(await noMatch.json()).toEqual({ orders: [], nextBefore: null });
  expect(
    (
      await request(
        `/api/saving/orders?profileId=${input.profileId}&statuses=completed&before=${result.savingOrderId}`,
        'GET'
      )
    ).status
  ).toBe(404);
  expect(
    (await request(`/api/saving/orders?profileId=${input.profileId}&statuses=unknown`, 'GET'))
      .status
  ).toBe(400);
  expect(
    (await request(`/api/saving/orders?profileId=${input.profileId}&status=active`, 'GET')).status
  ).toBe(400);
  const afterOrder = await request(
    `/api/saving/orders?profileId=${input.profileId}&before=${result.savingOrderId}`,
    'GET'
  );
  expect(afterOrder.status, http.logs()).toBe(200);
  expect(await afterOrder.json()).toMatchObject({ orders: [], nextBefore: null });
  expect(
    (await request(`/api/saving/orders?profileId=${input.profileId}&before=invalid`, 'GET')).status
  ).toBe(400);
  expect(
    (await request(`/api/saving/orders?profileId=${input.profileId}&before=${randomUUID()}`, 'GET'))
      .status
  ).toBe(404);
  const counts = await http.pool.query<{ orders: string; contracts: string; invoices: string }>(
    `SELECT (SELECT COUNT(*)::text FROM orders WHERE id=$1) AS orders,
            (SELECT COUNT(*)::text FROM contracts WHERE order_id=$1) AS contracts,
            (SELECT COUNT(*)::text FROM invoices WHERE order_id=$1) AS invoices`,
    [result.orderId]
  );
  expect(counts.rows[0]).toMatchObject({ orders: '1', contracts: '1', invoices: '1' });
  const commentsPath = `/api/saving/orders/${result.savingOrderId}/comments`;
  const staffCommentsPath = `/api/staff/saving/orders/${result.savingOrderId}/comments`;
  const commentSnapshot = async () =>
    (
      await http.pool.query(
        `SELECT
         (SELECT to_jsonb(o) FROM orders o WHERE id=$1::uuid) AS order_row,
         (SELECT to_jsonb(s) FROM saving_orders s WHERE id=$2::uuid) AS saving_row,
         (SELECT to_jsonb(c) FROM contracts c WHERE id=$3::uuid) AS contract_row,
         (SELECT jsonb_agg(to_jsonb(v) ORDER BY version_number) FROM contract_versions v WHERE contract_id=$3::uuid) AS versions,
         (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM invoices i WHERE order_id=$1::uuid) AS invoices,
         (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM saving_order_comments c WHERE order_id=$2::uuid) AS comments,
         (SELECT jsonb_agg(to_jsonb(k) ORDER BY idempotency_key) FROM idempotency_keys k WHERE entity_type='saving_order_comment') AS keys,
         (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE event='saving.order_comment_added') AS audits,
         (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM in_app_notifications n WHERE recipient_user_id='saving-order-buyer') AS notices`,
        [result.orderId, result.savingOrderId, result.contractId]
      )
    ).rows[0];
  const rejectedComment = async (
    path: string,
    auth: Record<string, string>,
    body: unknown,
    fields?: string[],
    status = 400
  ) => {
    const before = await commentSnapshot();
    const response = await request(path, 'POST', body, auth);
    expect(response.status, http.logs()).toBe(status);
    const failure = await response.json();
    expect(failure).toHaveProperty(
      'error.correlationId',
      expect.stringMatching(/^[0-9a-f-]{36}$/i)
    );
    expect(JSON.stringify(failure)).not.toContain('PRIVATE');
    if (status === 400)
      expect(failure).toHaveProperty(
        'error.code',
        fields ? 'VALIDATION:INPUT:INVALID' : 'VALIDATION:INPUT_INVALID'
      );
    if (fields) expect(failure).toHaveProperty('error.fields', fields);
    else expect(failure).not.toHaveProperty('error.fields');
    expect(await commentSnapshot()).toEqual(before);
  };
  await rejectedComment(
    commentsPath,
    customerHeaders,
    {
      idempotencyKey: randomUUID(),
      body: '   ',
    },
    ['body']
  );
  await rejectedComment(commentsPath, customerHeaders, {
    idempotencyKey: 'PRIVATE-invalid-key',
    body: '   ',
  });
  await rejectedComment(
    staffCommentsPath,
    staffHeaders,
    {
      idempotencyKey: randomUUID(),
      body: `PRIVATE-${'x'.repeat(10000)}`,
    },
    ['body']
  );
  await rejectedComment(staffCommentsPath, staffHeaders, {
    idempotencyKey: randomUUID(),
    body: '   ',
    visibility: 'PRIVATE-internal',
  });
  await http.pool.query(
    "DELETE FROM user_roles WHERE user_id='saving-order-staff' AND role_id='saving-order-admin'"
  );
  try {
    await rejectedComment(
      staffCommentsPath,
      staffHeaders,
      {
        idempotencyKey: randomUUID(),
        body: '   ',
      },
      undefined,
      403
    );
  } finally {
    await http.pool.query(
      "INSERT INTO user_roles(user_id,role_id) VALUES('saving-order-staff','saving-order-admin')"
    );
  }
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='saving-order-staff'"
  );
  try {
    await rejectedComment(
      staffCommentsPath,
      staffHeaders,
      {
        idempotencyKey: randomUUID(),
        body: '   ',
      },
      undefined,
      403
    );
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='saving-order-staff'"
    );
  }
  await rejectedComment(
    `/api/saving/orders/${randomUUID()}/comments`,
    customerHeaders,
    {
      idempotencyKey: randomUUID(),
      body: '   ',
    },
    undefined,
    404
  );
  const outsider = randomUUID(),
    outsiderSession = randomUUID(),
    outsiderCsrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test-only')",
    [outsider]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [outsiderSession, outsider, outsiderCsrf, randomUUID()]
  );
  await rejectedComment(
    commentsPath,
    {
      Cookie: `barghsa_session=${outsiderSession}`,
      'X-CSRF-Token': outsiderCsrf,
      'Content-Type': 'application/json',
    },
    { idempotencyKey: randomUUID(), body: '   ' },
    undefined,
    404
  );
  const customerComment = { idempotencyKey: randomUUID(), body: 'Please call before delivery.' };
  const postedCustomer = await request(commentsPath, 'POST', customerComment);
  expect(postedCustomer.status, http.logs()).toBe(200);
  const customerReceipt = await postedCustomer.json();
  expect(customerReceipt).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    orderId: result.savingOrderId,
    authorUserId: 'saving-order-buyer',
    authorName: 'saving-order-buyer@example.test',
    body: customerComment.body,
    authorRole: 'customer',
    createdAt: expect.any(String),
  });
  expect(customerReceipt).not.toHaveProperty('visibility');
  const beforeCustomerReplay = await commentSnapshot();
  const customerRetry = await request(commentsPath, 'POST', customerComment);
  expect(customerRetry.status, http.logs()).toBe(200);
  expect(await customerRetry.json()).toEqual(customerReceipt);
  expect(await commentSnapshot()).toEqual(beforeCustomerReplay);
  const staffComment = { idempotencyKey: randomUUID(), body: 'We will call before delivery.' };
  const postedStaff = await request(staffCommentsPath, 'POST', staffComment, staffHeaders);
  expect(postedStaff.status, http.logs()).toBe(200);
  const staffReceipt = await postedStaff.json();
  expect(staffReceipt).toMatchObject({
    id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    orderId: result.savingOrderId,
    authorUserId: 'saving-order-staff',
    authorName: 'saving-order-staff@example.test',
    authorRole: 'staff',
    body: staffComment.body,
    createdAt: expect.any(String),
  });
  expect(staffReceipt).not.toHaveProperty('visibility');
  const beforeStaffReplay = await commentSnapshot();
  const staffReplay = await request(staffCommentsPath, 'POST', staffComment, staffHeaders);
  expect(staffReplay.status, http.logs()).toBe(200);
  expect(await staffReplay.json()).toEqual(staffReceipt);
  expect(await commentSnapshot()).toEqual(beforeStaffReplay);
  const comments = await request(commentsPath, 'GET');
  expect(comments.status, http.logs()).toBe(200);
  expect(await comments.json()).toMatchObject({
    comments: [
      { body: customerComment.body, authorRole: 'customer' },
      { body: 'We will call before delivery.', authorRole: 'staff' },
    ],
    nextBefore: null,
  });
  const persistedComments = await http.pool.query<{ total: string }>(
    'SELECT COUNT(*)::text AS total FROM saving_order_comments WHERE order_id=$1',
    [result.savingOrderId]
  );
  expect(persistedComments.rows[0]?.total).toBe('2');
  expect(
    (
      await http.pool.query(
        `SELECT 1 FROM in_app_notifications WHERE recipient_user_id='saving-order-buyer'
       AND link_route=$1 AND localized_content->'en'->>'body' LIKE '%replied%'`,
        [`/savings/orders/${result.savingOrderId}`]
      )
    ).rowCount
  ).toBe(1);
  await http.pool.query(
    `INSERT INTO saving_order_comments(id,order_id,author_user_id,body)
     SELECT uuid_generate_v7(),$1,'saving-order-buyer','Follow-up ' || n
     FROM generate_series(1,49) AS n`,
    [result.savingOrderId]
  );
  const recentComments = await request(commentsPath, 'GET');
  const recentPage = (await recentComments.json()) as {
    comments: { id: string }[];
    nextBefore: string | null;
  };
  expect(recentPage.comments).toHaveLength(50);
  expect(recentPage.nextBefore).not.toBeNull();
  const earlierComments = await request(`${commentsPath}?before=${recentPage.nextBefore}`, 'GET');
  const earlierPage = (await earlierComments.json()) as { comments: { id: string }[] };
  expect(earlierPage.comments).toHaveLength(1);
  expect(
    new Set([...recentPage.comments, ...earlierPage.comments].map((item) => item.id)).size
  ).toBe(51);
  await expect(
    http.pool.query('UPDATE saving_order_comments SET body=$1 WHERE order_id=$2', [
      'silently changed',
      result.savingOrderId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const duplicate = await request('/api/saving/orders', 'POST', {
    ...submission,
    idempotencyKey: randomUUID(),
  });
  expect(duplicate.status, http.logs()).toBe(409);

  await http.pool.query(
    `INSERT INTO gift_codes(code,discount_type,discount_value,categories,created_by)
     VALUES('SAVING30','fixed_irr',30000,ARRAY['saving_plan'],'saving-order-staff')`
  );
  const discountedInput = { ...input, billIdentifier: '1234567890124', giftCode: 'saving30' };
  const discountedQuoteResponse = await request(
    '/api/saving/orders/quote',
    'POST',
    discountedInput
  );
  expect(discountedQuoteResponse.status, http.logs()).toBe(201);
  const discountedQuote = (await discountedQuoteResponse.json()) as {
    reviewDigest: string;
    discountIrR: string;
    vatIrR: string;
    totalIrR: string;
  };
  expect(discountedQuote).toMatchObject({
    discountIrR: '30000',
    vatIrR: '8100',
    totalIrR: '278100',
  });
  const discounted = await request('/api/saving/orders', 'POST', {
    ...discountedInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: discountedQuote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(discounted.status, http.logs()).toBe(201);
  const discountedOrder = (await discounted.json()) as { orderId: string; savingOrderId: string };
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.reserved_count
  ).toBe(2);
  const inventoryPath = `/api/admin/catalogue/hardware/${input.hardwareProductId}/inventory`;
  expect(
    (
      await request(
        inventoryPath,
        'PUT',
        {
          stockTracking: true,
          stockCount: 1,
          reservationMinutes: 30,
        },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(
    (
      await request(
        inventoryPath,
        'PUT',
        {
          stockTracking: false,
          stockCount: 2,
          reservationMinutes: 30,
        },
        staffHeaders
      )
    ).status
  ).toBe(409);
  const noStockInput = { ...input, billIdentifier: '1234567890126' };
  const noStockQuote = await request('/api/saving/orders/quote', 'POST', noStockInput);
  expect(noStockQuote.status, http.logs()).toBe(201);
  const noStockDigest = ((await noStockQuote.json()) as { reviewDigest: string }).reviewDigest;
  expect(
    (
      await request('/api/saving/orders', 'POST', {
        ...noStockInput,
        idempotencyKey: randomUUID(),
        expectedQuoteDigest: noStockDigest,
        agreementAccepted: true,
        hardwareConfirmed: true,
        submitForStaffReview: true,
      })
    ).status,
    http.logs()
  ).toBe(409);
  expect(
    (
      await http.pool.query<{ discount_amount: string }>(
        'SELECT discount_amount::text FROM gift_code_redemptions WHERE order_id=$1',
        [discountedOrder.orderId]
      )
    ).rows[0]?.discount_amount
  ).toBe('30000');

  const staffQueue = await request('/api/staff/saving/orders', 'GET', undefined, staffHeaders);
  expect(staffQueue.status, http.logs()).toBe(200);
  expect(
    ((await staffQueue.json()) as { orders: Array<{ id: string }> }).orders.map((order) => order.id)
  ).toContain(result.savingOrderId);
  const reviewQueue = await request(
    '/api/staff/saving/orders?lane=review',
    'GET',
    undefined,
    staffHeaders
  );
  expect(reviewQueue.status, http.logs()).toBe(200);
  expect(
    (
      (await reviewQueue.json()) as { orders: Array<{ id: string }>; nextAfter: string | null }
    ).orders.map((order) => order.id)
  ).toContain(result.savingOrderId);
  const reviewAfter = await request(
    `/api/staff/saving/orders?lane=review&after=${result.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(reviewAfter.status, http.logs()).toBe(200);
  expect(
    ((await reviewAfter.json()) as { orders: Array<{ id: string }> }).orders.map(
      (order) => order.id
    )
  ).not.toContain(result.savingOrderId);
  expect(
    (
      await request(
        `/api/staff/saving/orders?lane=fulfillment&after=${result.savingOrderId}`,
        'GET',
        undefined,
        staffHeaders
      )
    ).status
  ).toBe(404);
  expect(
    (await request('/api/staff/saving/orders?after=bad', 'GET', undefined, staffHeaders)).status
  ).toBe(400);
  const staffDetailResponse = await request(
    `/api/staff/saving/orders/${result.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(staffDetailResponse.status, http.logs()).toBe(200);
  const staffDetail = (await staffDetailResponse.json()) as { versionId: string };
  const approvalReview = await decisionReview(result.savingOrderId, 'approve');
  expect(approvalReview.data.outcome).toBe('publish_contract');
  const approval = {
    idempotencyKey: randomUUID(),
    expectedVersionId: staffDetail.versionId,
    expectedReviewHash: approvalReview.hash,
  };
  const approvePath = `/api/staff/saving/orders/${result.savingOrderId}/approve`;
  await operationsFeedbackProbes(async () => {
    const preview = { action: 'reject', reason: 'Valid rejection' };
    const mutation = { ...approval, reason: 'Valid rejection' };
    for (const [route, body] of [
      [`/api/staff/saving/orders/${result.savingOrderId}/financial-review`, preview],
      [`/api/staff/saving/orders/${result.savingOrderId}/reject`, mutation],
    ] as const) {
      for (const reason of ['', 'x'.repeat(1001), null])
        await rejectedSavingOperations(result.savingOrderId, route, { ...body, reason }, [
          'reason',
        ]);
      for (const invalid of [
        { ...body, reason: '', extra: 'PRIVATE' },
        'action' in body
          ? { ...body, action: 'PRIVATE', reason: '' }
          : { ...body, expectedVersionId: 'PRIVATE', reason: '' },
        ...('idempotencyKey' in body
          ? [
              { ...body, idempotencyKey: 'PRIVATE', reason: '' },
              { ...body, expectedReviewHash: 'PRIVATE', reason: '' },
            ]
          : []),
        null,
      ])
        await rejectedSavingOperations(result.savingOrderId, route, invalid);
      await rejectedSavingOperations(
        result.savingOrderId,
        route,
        { ...body, reason: '' },
        undefined,
        403,
        customerHeaders
      );
      await rejectedSavingOperations(
        result.savingOrderId,
        route.replace(result.savingOrderId, randomUUID()),
        { ...body, reason: '' },
        undefined,
        404
      );
    }
    await rejectedSavingOperations(
      result.savingOrderId,
      `/api/staff/saving/orders/${result.savingOrderId}/financial-review`,
      { action: 'approve', reason: 'PRIVATE' }
    );
    await rejectedSavingOperations(result.savingOrderId, approvePath, { ...approval, reason: '' });
    const permissions = (
      await http.pool.query<{ permissions: unknown }>(
        "SELECT permissions FROM staff_roles WHERE role_id='saving-order-admin'"
      )
    ).rows[0]!.permissions;
    try {
      await http.pool.query(
        "UPDATE staff_roles SET permissions='[\"contracts:write\"]' WHERE role_id='saving-order-admin'"
      );
      for (const [route, body] of [
        [`/api/staff/saving/orders/${result.savingOrderId}/financial-review`, preview],
        [`/api/staff/saving/orders/${result.savingOrderId}/reject`, mutation],
      ] as const)
        await rejectedSavingOperations(result.savingOrderId, route, { ...body, reason: '' }, [
          'reason',
        ]);
      await http.pool.query(
        "UPDATE staff_roles SET permissions='[\"contracts:read\"]' WHERE role_id='saving-order-admin'"
      );
      await rejectedSavingOperations(
        result.savingOrderId,
        `/api/staff/saving/orders/${result.savingOrderId}/financial-review`,
        { ...preview, reason: '' },
        undefined,
        403
      );
    } finally {
      await http.pool.query(
        "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='saving-order-admin'",
        [typeof permissions === 'string' ? permissions : JSON.stringify(permissions)]
      );
    }
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='saving-order-staff'"
    );
    try {
      await rejectedSavingOperations(
        result.savingOrderId,
        `/api/staff/saving/orders/${result.savingOrderId}/reject`,
        { ...mutation, reason: '' },
        undefined,
        403
      );
    } finally {
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='saving-order-staff'"
      );
    }
    await http.pool.query(
      "UPDATE sessions SET revoked_at=NOW() WHERE user_id='saving-order-staff'"
    );
    try {
      await rejectedSavingOperations(
        result.savingOrderId,
        `/api/staff/saving/orders/${result.savingOrderId}/financial-review`,
        { ...preview, reason: '' },
        undefined,
        401
      );
    } finally {
      await http.pool.query(
        "UPDATE sessions SET revoked_at=NULL WHERE user_id='saving-order-staff'"
      );
    }
  });
  expect(
    (
      await request(
        approvePath,
        'POST',
        {
          idempotencyKey: randomUUID(),
          expectedVersionId: staffDetail.versionId,
        },
        staffHeaders
      )
    ).status
  ).toBe(400);
  const originalInvoiceState = (
    await http.pool.query<{ state: string }>('SELECT state FROM invoices WHERE id=$1', [
      approvalReview.data.invoiceId,
    ])
  ).rows[0]!.state;
  await http.pool.query('UPDATE invoices SET state=$2 WHERE id=$1', [
    approvalReview.data.invoiceId,
    originalInvoiceState === 'Overdue' ? 'Unpaid' : 'Overdue',
  ]);
  expect((await request(approvePath, 'POST', approval, staffHeaders)).status).toBe(409);
  await http.pool.query('UPDATE invoices SET state=$2 WHERE id=$1', [
    approvalReview.data.invoiceId,
    originalInvoiceState,
  ]);
  await expectSavingStageWriteRollback(result.savingOrderId, 'request_confirmation', () =>
    request(approvePath, 'POST', approval, staffHeaders)
  );
  await expectSavingStageAuditRollback(result.savingOrderId, () =>
    request(approvePath, 'POST', approval, staffHeaders)
  );

  await expectContractNoticeRollback(
    http.pool,
    result.contractId,
    'contract.awaiting_acceptance',
    () => request(approvePath, 'POST', approval, staffHeaders),
    true
  );
  const approved = await request(approvePath, 'POST', approval, staffHeaders);
  expect(approved.status, http.logs()).toBe(200);
  expect(await approved.json()).toMatchObject({ status: 'approved' });
  const contractNotice = await expectContractCustomerDelivery(
    http.pool,
    result.contractId,
    staffDetail.versionId,
    'contract.awaiting_acceptance'
  );
  expect((await request(approvePath, 'POST', approval, staffHeaders)).status).toBe(200);
  expect(
    await expectContractCustomerDelivery(
      http.pool,
      result.contractId,
      staffDetail.versionId,
      'contract.awaiting_acceptance'
    )
  ).toEqual(contractNotice);
  const decisionAudit = (
    await http.pool.query<{ metadata: { reviewHash: string; financialReview: { hash: string } } }>(
      `SELECT metadata::jsonb AS metadata FROM audit_log
       WHERE event='saving.order_review.approve' AND metadata::jsonb->>'savingOrderId'=$1
       ORDER BY created_at DESC LIMIT 1`,
      [result.savingOrderId]
    )
  ).rows[0];
  expect(decisionAudit?.metadata.reviewHash).toBe(approvalReview.hash);
  expect(decisionAudit?.metadata.financialReview.hash).toBe(approvalReview.hash);
  await expectCoreAudit(http.pool, 'saving.order_review.approve', result.savingOrderId, {
    entity: 'saving_order',
    fromState: 'awaiting_staff_review',
    toState: 'approved',
    reason: '',
    actor: 'saving-order-staff',
    context: 'staff',
  });

  const publishedContract = await request(`/api/contracts/${result.contractId}`, 'GET');
  expect(publishedContract.status, http.logs()).toBe(200);
  expect(await publishedContract.json()).toMatchObject({
    id: result.contractId,
    orderId: result.orderId,
    savingOrderId: result.savingOrderId,
  });
  const fulfillmentQueue = await request(
    '/api/staff/saving/orders?lane=fulfillment',
    'GET',
    undefined,
    staffHeaders
  );
  expect(fulfillmentQueue.status, http.logs()).toBe(200);
  expect(
    ((await fulfillmentQueue.json()) as { orders: Array<{ id: string }> }).orders.map(
      (order) => order.id
    )
  ).toContain(result.savingOrderId);
  expect(
    (
      await http.pool.query<{ stock_count: number; reserved_count: number }>(
        'SELECT stock_count,reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]
  ).toMatchObject({ stock_count: 1, reserved_count: 1 });
  await expectSavingStatusDeliveries(http.pool, result.savingOrderId, 'saving-order-buyer', [
    'approved',
  ]);
  const approvalDeliveryBefore = await savingDeliverySnapshot(http.pool, result.savingOrderId);
  const approvalRetry = await request(approvePath, 'POST', approval, staffHeaders);
  expect(approvalRetry.status, http.logs()).toBe(200);
  expect(await approvalRetry.json()).toMatchObject({ status: 'approved' });
  expect(await savingDeliverySnapshot(http.pool, result.savingOrderId)).toEqual(
    approvalDeliveryBefore
  );
  expect(
    (
      await request(
        approvePath,
        'POST',
        { ...approval, idempotencyKey: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  const stagePath = (stage: string, action = 'complete') =>
    `/api/staff/saving/orders/${result.savingOrderId}/stages/${stage}/${action}`;
  const stageInput = () => ({
    idempotencyKey: randomUUID(),
    expectedStatus: 'in_progress',
    expectedReviewHash: '0'.repeat(64),
    explanation: 'Staff verified progress',
  });
  const reviewedStageInput = async (stage: string, action = 'complete') => {
    const input = stageInput();
    const response = await request(
      `${stagePath(stage, action)}/review`,
      'POST',
      { expectedStatus: input.expectedStatus, explanation: input.explanation },
      staffHeaders
    );
    expect(response.status, http.logs()).toBe(200);
    const review = (await response.json()) as {
      hash: string;
      data: { stage: string; action: string; nextStatus: string };
    };
    expect(review.data).toMatchObject({ stage, action });
    return { ...input, expectedReviewHash: review.hash };
  };
  await operationsFeedbackProbes(async () => {
    const mutation = { ...stageInput(), handoverDescription: 'Existing description' };
    const preview = {
      expectedStatus: mutation.expectedStatus,
      explanation: mutation.explanation,
      handoverDescription: mutation.handoverDescription,
    };
    for (const [route, body] of [
      [`${stagePath('product_delivery')}/review`, preview],
      [stagePath('product_delivery'), mutation],
    ] as const) {
      for (const [invalid, fields] of [
        [{ ...body, explanation: '' }, ['explanation']],
        [{ ...body, handoverDescription: 'x'.repeat(1001) }, ['handoverDescription']],
        [
          { ...body, explanation: '', handoverDescription: null },
          ['explanation', 'handoverDescription'],
        ],
      ] as const)
        await rejectedSavingOperations(result.savingOrderId, route, invalid, [...fields]);
      for (const invalid of [
        { ...body, expectedStatus: 'PRIVATE', explanation: '' },
        { ...body, explanation: '', extra: 'PRIVATE' },
        ...('idempotencyKey' in body
          ? [
              { ...body, idempotencyKey: 'PRIVATE', explanation: '' },
              { ...body, expectedReviewHash: 'PRIVATE', explanation: '' },
            ]
          : []),
        null,
      ])
        await rejectedSavingOperations(result.savingOrderId, route, invalid);
      await rejectedSavingOperations(
        result.savingOrderId,
        route.replace('product_delivery', 'PRIVATE'),
        { ...body, explanation: '' }
      );
      await rejectedSavingOperations(
        result.savingOrderId,
        route,
        { ...body, explanation: '' },
        undefined,
        403,
        customerHeaders
      );
      await rejectedSavingOperations(
        result.savingOrderId,
        route.replace(result.savingOrderId, randomUUID()),
        { ...body, explanation: '' },
        undefined,
        404
      );
    }
    const permissions = (
      await http.pool.query<{ permissions: unknown }>(
        "SELECT permissions FROM staff_roles WHERE role_id='saving-order-admin'"
      )
    ).rows[0]!.permissions;
    try {
      await http.pool.query(
        "UPDATE staff_roles SET permissions='[\"contracts:write\"]' WHERE role_id='saving-order-admin'"
      );
      for (const [route, body] of [
        [`${stagePath('product_delivery')}/review`, preview],
        [stagePath('product_delivery'), mutation],
      ] as const)
        await rejectedSavingOperations(result.savingOrderId, route, { ...body, explanation: '' }, [
          'explanation',
        ]);
      await http.pool.query(
        "UPDATE staff_roles SET permissions='[\"contracts:read\"]' WHERE role_id='saving-order-admin'"
      );
      await rejectedSavingOperations(
        result.savingOrderId,
        `${stagePath('product_delivery')}/review`,
        { ...preview, explanation: '' },
        undefined,
        403
      );
    } finally {
      await http.pool.query(
        "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='saving-order-admin'",
        [typeof permissions === 'string' ? permissions : JSON.stringify(permissions)]
      );
    }
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='saving-order-staff'"
    );
    try {
      await rejectedSavingOperations(
        result.savingOrderId,
        stagePath('product_delivery'),
        { ...mutation, explanation: '' },
        undefined,
        403
      );
    } finally {
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='saving-order-staff'"
      );
    }
    await http.pool.query(
      "UPDATE sessions SET revoked_at=NOW() WHERE user_id='saving-order-staff'"
    );
    try {
      await rejectedSavingOperations(
        result.savingOrderId,
        `${stagePath('product_delivery')}/review`,
        { ...preview, explanation: '' },
        undefined,
        401
      );
    } finally {
      await http.pool.query(
        "UPDATE sessions SET revoked_at=NULL WHERE user_id='saving-order-staff'"
      );
    }
  });
  expect(
    (await request(stagePath('product_delivery'), 'POST', stageInput(), staffHeaders)).status
  ).toBe(409);
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
     VALUES($1,1000000,0) ON CONFLICT(profile_id)
     DO UPDATE SET posted_balance=1000000,reserved_balance=0`,
    [input.profileId]
  );
  const paymentPath = `/api/invoices/${result.invoiceId}/wallet-payment`;
  const walletReviewResponse = await request(paymentPath, 'GET');
  expect(walletReviewResponse.status, http.logs()).toBe(200);
  const walletHash = ((await walletReviewResponse.json()) as { review: { hash: string } }).review
    .hash;
  const paid = await request(paymentPath, 'POST', {
    idempotencyKey: randomUUID(),
    expectedRemainingAmount: quote.totalIrR,
    expectedReviewHash: walletHash,
  });
  expect(paid.status, http.logs()).toBe(200);
  const equalHardwareResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه جایگزین', en: 'Replacement device' },
      description: { fa: 'تجهیز جایگزین', en: 'Replacement equipment' },
      price: '200000',
      status: 'active',
    },
    staffHeaders
  );
  expect(equalHardwareResponse.status, http.logs()).toBe(201);
  const equalHardwareId = ((await equalHardwareResponse.json()) as { id: string }).id;
  const costlyHardwareResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه گران‌تر', en: 'Costlier device' },
      description: { fa: 'تجهیز گران‌تر', en: 'Costlier equipment' },
      price: '250000',
      status: 'active',
    },
    staffHeaders
  );
  expect(costlyHardwareResponse.status, http.logs()).toBe(201);
  const costlyHardwareId = ((await costlyHardwareResponse.json()) as { id: string }).id;
  await http.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
    input.savingPlanId,
    equalHardwareId,
  ]);
  await http.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
    input.savingPlanId,
    costlyHardwareId,
  ]);
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${equalHardwareId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  const originalStock = (
    await http.pool.query<{ stock_count: number }>('SELECT stock_count FROM products WHERE id=$1', [
      input.hardwareProductId,
    ])
  ).rows[0]!.stock_count;
  const hardwarePath = `/api/staff/saving/orders/${result.savingOrderId}/amend-hardware`;
  const hardwareInput = {
    idempotencyKey: randomUUID(),
    expectedVersionId: staffDetail.versionId,
    expectedHardwareId: input.hardwareProductId,
    hardwareProductId: equalHardwareId,
    reason: 'Customer requested an equal-price device before delivery',
    expectedReviewHash: '',
  };
  const initialHardwareReview = await hardwareAmendmentReview(result.savingOrderId, hardwareInput);
  expect(initialHardwareReview.data).toMatchObject({
    outcome: 'swap_without_price_change',
    priceDeltaIrR: '0',
  });
  hardwareInput.expectedReviewHash = initialHardwareReview.hash;
  await hardwareFeedbackProbes(async () => {
    const previewBody = {
      expectedVersionId: hardwareInput.expectedVersionId,
      expectedHardwareId: hardwareInput.expectedHardwareId,
      hardwareProductId: hardwareInput.hardwareProductId,
      reason: hardwareInput.reason,
    };
    for (const [route, body] of [
      [`${hardwarePath}-review`, previewBody],
      [hardwarePath, hardwareInput],
    ] as const) {
      for (const [invalid, fields] of [
        [{ ...body, hardwareProductId: 'PRIVATE' }, ['hardwareProductId']],
        [{ ...body, reason: '  ' }, ['reason']],
        [{ ...body, reason: 'x'.repeat(1001) }, ['reason']],
        [{ ...body, hardwareProductId: '', reason: '' }, ['hardwareProductId', 'reason']],
      ] as const)
        await rejectedSavingHardware(result.savingOrderId, route, invalid, [...fields]);
      for (const invalid of [
        { ...body, expectedVersionId: 'PRIVATE' },
        { ...body, reason: '', expectedHardwareId: 'PRIVATE' },
        { ...body, reason: '', extra: 'PRIVATE' },
        null,
        ...(route === hardwarePath
          ? [
              { ...body, reason: '', idempotencyKey: 'PRIVATE' },
              { ...body, reason: '', expectedReviewHash: 'PRIVATE' },
            ]
          : []),
      ])
        await rejectedSavingHardware(result.savingOrderId, route, invalid);
      await rejectedSavingHardware(
        result.savingOrderId,
        route,
        { ...body, reason: '' },
        undefined,
        403,
        customerHeaders
      );
      await rejectedSavingHardware(
        result.savingOrderId,
        route.replace(result.savingOrderId, randomUUID()),
        { ...body, reason: '' },
        undefined,
        404
      );
    }
    const originalPermissions = (
      await http.pool.query<{ permissions: unknown }>(
        "SELECT permissions FROM staff_roles WHERE role_id='saving-order-admin'"
      )
    ).rows[0]!.permissions;
    try {
      await http.pool.query(
        "UPDATE staff_roles SET permissions='[\"contracts:write\"]' WHERE role_id='saving-order-admin'"
      );
      for (const route of [`${hardwarePath}-review`, hardwarePath]) {
        const body = route === hardwarePath ? hardwareInput : previewBody;
        await rejectedSavingHardware(result.savingOrderId, route, { ...body, reason: '' }, [
          'reason',
        ]);
        await rejectedSavingHardware(
          result.savingOrderId,
          route,
          { ...body, hardwareProductId: costlyHardwareId, reason: '' },
          undefined,
          403
        );
      }
      await http.pool.query(
        "UPDATE staff_roles SET permissions='[\"contracts:read\"]' WHERE role_id='saving-order-admin'"
      );
      await rejectedSavingHardware(
        result.savingOrderId,
        `${hardwarePath}-review`,
        { ...previewBody, reason: '' },
        undefined,
        403
      );
    } finally {
      await http.pool.query(
        "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='saving-order-admin'",
        [
          typeof originalPermissions === 'string'
            ? originalPermissions
            : JSON.stringify(originalPermissions),
        ]
      );
    }
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='saving-order-staff'"
    );
    try {
      await rejectedSavingHardware(
        result.savingOrderId,
        hardwarePath,
        { ...hardwareInput, reason: '' },
        undefined,
        403
      );
    } finally {
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='saving-order-staff'"
      );
    }
    await http.pool.query(
      "UPDATE sessions SET revoked_at=NOW() WHERE user_id='saving-order-staff'"
    );
    try {
      await rejectedSavingHardware(
        result.savingOrderId,
        `${hardwarePath}-review`,
        { ...previewBody, reason: '' },
        undefined,
        401
      );
    } finally {
      await http.pool.query(
        "UPDATE sessions SET revoked_at=NULL WHERE user_id='saving-order-staff'"
      );
    }
  });
  expect(
    await (
      await request(
        `/api/staff/saving/orders/${result.savingOrderId}`,
        'GET',
        undefined,
        staffHeaders
      )
    ).json()
  ).toMatchObject({
    canAmendHardware: true,
    hardwareOptions: expect.arrayContaining([
      expect.objectContaining({ id: equalHardwareId, priceDeltaIrR: '0' }),
      expect.objectContaining({ id: costlyHardwareId }),
    ]),
  });
  // A delayed private read must derive price-changing options from the current locked grant.
  const beforePrivateRead = await savingSystemSnapshot(result.savingOrderId);
  const capabilityBlocker = await http.pool.connect();
  let capabilityRead: Promise<Response> | undefined;
  const currentGrants = (
    await http.pool.query("SELECT permissions FROM staff_roles WHERE role_id='saving-order-admin'")
  ).rows[0].permissions;
  try {
    await capabilityBlocker.query('BEGIN');
    await capabilityBlocker.query(
      "UPDATE staff_roles SET permissions=permissions::jsonb-'invoices:write' WHERE role_id='saving-order-admin'"
    );
    await capabilityBlocker.query('LOCK TABLE products IN ACCESS EXCLUSIVE MODE');
    const blockerPid = (await capabilityBlocker.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid as number;
    capabilityRead = request(
      `/api/staff/saving/orders/${result.savingOrderId}`,
      'GET',
      undefined,
      staffHeaders
    );
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
              [blockerPid]
            )
          ).rows[0].blocked
      )
      .toBe(true);
    await capabilityBlocker.query('COMMIT');
    const current = await capabilityRead;
    expect(current.status, http.logs()).toBe(200);
    const options = (
      (await current.json()) as { hardwareOptions: Array<{ id: string; priceDeltaIrR: string }> }
    ).hardwareOptions;
    expect(options).toContainEqual(
      expect.objectContaining({ id: equalHardwareId, priceDeltaIrR: '0' })
    );
    expect(options.some((option) => option.id === costlyHardwareId)).toBe(false);
    expect(await savingSystemSnapshot(result.savingOrderId)).toEqual(beforePrivateRead);
  } finally {
    await capabilityBlocker.query('ROLLBACK');
    capabilityBlocker.release();
    await capabilityRead;
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='saving-order-admin'",
      [typeof currentGrants === 'string' ? currentGrants : JSON.stringify(currentGrants)]
    );
  }
  // Session validity is checked again after the complete, delayed detail read.
  const originalSessions = (
    await http.pool.query(
      "SELECT session_id,expires_at,idle_deadline FROM sessions WHERE user_id='saving-order-staff'"
    )
  ).rows;
  const sessionBlocker = await http.pool.connect();
  let delayedDetail: Promise<Response> | undefined;
  let delayedStatus: number | undefined;
  try {
    await sessionBlocker.query('BEGIN');
    await sessionBlocker.query('LOCK TABLE products IN ACCESS EXCLUSIVE MODE');
    const blockerPid = (await sessionBlocker.query('SELECT pg_backend_pid() AS pid')).rows[0]
      .pid as number;
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '1 second' WHERE user_id='saving-order-staff'"
    );
    delayedDetail = request(
      `/api/staff/saving/orders/${result.savingOrderId}`,
      'GET',
      undefined,
      staffHeaders
    ).then((response) => {
      delayedStatus = response.status;
      return response;
    });
    await expect
      .poll(async () =>
        (
          await http.pool.query(
            'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
            [blockerPid]
          )
        ).rows[0].blocked
          ? 'blocked'
          : delayedStatus === undefined
            ? 'pending'
            : `finished:${delayedStatus}`
      )
      .toBe('blocked');
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              "SELECT bool_and(expires_at<clock_timestamp()) AS expired FROM sessions WHERE user_id='saving-order-staff'"
            )
          ).rows[0].expired
      )
      .toBe(true);
    await sessionBlocker.query('COMMIT');
    const expired = await delayedDetail;
    expect(expired.status, await expired.clone().text()).toBe(401);
    expect(await expired.json()).not.toHaveProperty('hardwareOptions');
    expect(await savingSystemSnapshot(result.savingOrderId)).toEqual(beforePrivateRead);
  } finally {
    await sessionBlocker.query('ROLLBACK');
    sessionBlocker.release();
    await delayedDetail;
    for (const original of originalSessions)
      await http.pool.query(
        'UPDATE sessions SET expires_at=$2,idle_deadline=$3 WHERE session_id=$1',
        [original.session_id, original.expires_at, original.idle_deadline]
      );
  }
  expect((await request(hardwarePath, 'POST', hardwareInput)).status).toBe(403);
  const { expectedReviewHash: _unusedHash, ...withoutHardwareHash } = hardwareInput;
  expect(
    (
      await request(
        hardwarePath,
        'POST',
        { ...withoutHardwareHash, idempotencyKey: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(400);
  expect(
    (
      await request(
        hardwarePath,
        'POST',
        { ...hardwareInput, expectedVersionId: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${equalHardwareId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 1, reservationMinutes: 30 },
        staffHeaders
      )
    ).status
  ).toBe(200);
  expect((await request(hardwarePath, 'POST', hardwareInput, staffHeaders)).status).toBe(409);
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${equalHardwareId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 0, reservationMinutes: 30 },
        staffHeaders
      )
    ).status
  ).toBe(200);
  expect((await request(hardwarePath, 'POST', hardwareInput, staffHeaders)).status).toBe(409);
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${equalHardwareId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
        staffHeaders
      )
    ).status
  ).toBe(200);
  const hardwareAmended = await request(hardwarePath, 'POST', hardwareInput, staffHeaders);
  expect(hardwareAmended.status, http.logs()).toBe(201);
  const hardwareAmendment = (await hardwareAmended.json()) as { amendmentId: string };
  const hardwareAudit = (
    await http.pool.query<{ metadata: { reviewHash: string } }>(
      `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='saving.hardware_amended'
       AND metadata::jsonb->>'savingOrderId'=$1 ORDER BY created_at DESC LIMIT 1`,
      [result.savingOrderId]
    )
  ).rows[0];
  expect(hardwareAudit?.metadata.reviewHash).toBe(initialHardwareReview.hash);
  await expectCoreAudit(http.pool, 'saving.hardware_amended', result.savingOrderId, {
    entity: 'saving_order',
    fromState: 'approved',
    toState: 'approved',
    reason: hardwareInput.reason,
    actor: 'saving-order-staff',
    context: 'staff',
  });

  expect((await request(hardwarePath, 'POST', hardwareInput, staffHeaders)).status).toBe(201);
  expect(
    (
      await request(
        hardwarePath,
        'POST',
        { ...hardwareInput, idempotencyKey: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(
    (
      await http.pool.query<{ stock_count: number }>(
        'SELECT stock_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.stock_count
  ).toBe(originalStock + 1);
  expect(
    (
      await http.pool.query<{ stock_count: number }>(
        'SELECT stock_count FROM products WHERE id=$1',
        [equalHardwareId]
      )
    ).rows[0]?.stock_count
  ).toBe(1);
  expect(
    (
      await http.pool.query<{ status: string; hardware_product_id: string }>(
        'SELECT status,hardware_product_id FROM saving_inventory_reservations WHERE order_id=$1',
        [result.savingOrderId]
      )
    ).rows[0]
  ).toMatchObject({ status: 'allocated', hardware_product_id: equalHardwareId });
  expect(
    await (await request(`/api/saving/orders/${result.savingOrderId}`, 'GET')).json()
  ).toMatchObject({
    hardware_product_id: equalHardwareId,
    current_hardware_title: { en: 'Replacement device' },
    pricing_snapshot: { hardware: { title: { en: 'Device' } } },
    hardwareAmendments: [{ id: hardwareAmendment.amendmentId, priceDeltaIrR: '0' }],
  });
  await expect(
    http.pool.query('DELETE FROM saving_hardware_amendments WHERE id=$1', [
      hardwareAmendment.amendmentId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const reverseInput = {
    idempotencyKey: randomUUID(),
    expectedVersionId: staffDetail.versionId,
    expectedHardwareId: equalHardwareId,
    hardwareProductId: input.hardwareProductId,
    reason: 'Customer chose the original device before delivery',
  };
  const reverseHardware = await request(
    hardwarePath,
    'POST',
    {
      ...reverseInput,
      expectedReviewHash: (await hardwareAmendmentReview(result.savingOrderId, reverseInput)).hash,
    },
    staffHeaders
  );
  expect(reverseHardware.status, http.logs()).toBe(201);
  expect(
    (
      await http.pool.query<{ stock_count: number }>(
        'SELECT stock_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.stock_count
  ).toBe(originalStock);
  const amendedAddressId = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
       SELECT profile_id,province_id,city_id,'Corrected installation address','9876543210',false
       FROM addresses WHERE id=$1 RETURNING id`,
      [input.installationAddressId]
    )
  ).rows[0]!.id;
  const amendPath = `/api/staff/saving/orders/${result.savingOrderId}/amend-address`;
  const amendmentInput = {
    idempotencyKey: randomUUID(),
    expectedVersionId: staffDetail.versionId,
    expectedAddressId: input.installationAddressId,
    expectedReviewHash: '',
    addressId: amendedAddressId,
    reason: 'Customer confirmed the corrected installation address',
  };
  const addressPreviewPath = `${amendPath}-review`;
  const addressPreviewInput = {
    expectedVersionId: amendmentInput.expectedVersionId,
    expectedAddressId: amendmentInput.expectedAddressId,
    addressId: amendmentInput.addressId,
    reason: amendmentInput.reason,
  };
  for (const [route, body] of [
    [addressPreviewPath, addressPreviewInput],
    [amendPath, { ...amendmentInput, expectedReviewHash: 'a'.repeat(64) }],
  ] as const) {
    for (const [invalid, fields] of [
      [{ ...body, addressId: 'PRIVATE' }, ['addressId']],
      [{ ...body, reason: '  ' }, ['reason']],
      [{ ...body, reason: 'x'.repeat(1001) }, ['reason']],
      [{ ...body, addressId: '', reason: '' }, ['addressId', 'reason']],
    ] as const)
      await rejectedSavingChange(result.savingOrderId, route, invalid, staffHeaders, [...fields]);
    for (const invalid of [
      { ...body, expectedVersionId: 'PRIVATE' },
      { ...body, reason: '', expectedAddressId: 'PRIVATE' },
      { ...body, reason: '', extra: 'PRIVATE' },
      null,
    ])
      await rejectedSavingChange(result.savingOrderId, route, invalid, staffHeaders);
    await rejectedSavingChange(
      result.savingOrderId,
      route,
      { ...body, reason: '' },
      customerHeaders,
      undefined,
      403
    );
    await rejectedSavingChange(
      result.savingOrderId,
      route.replace(result.savingOrderId, randomUUID()),
      { ...body, reason: '' },
      staffHeaders,
      undefined,
      404
    );
  }
  const livePermissions = (
    await http.pool.query<{ permissions: unknown }>(
      "SELECT permissions FROM staff_roles WHERE role_id='saving-order-admin'"
    )
  ).rows[0]!.permissions;
  await http.pool.query(
    "UPDATE staff_roles SET permissions='[\"contracts:read\"]' WHERE role_id='saving-order-admin'"
  );
  try {
    await rejectedSavingChange(
      result.savingOrderId,
      addressPreviewPath,
      { ...addressPreviewInput, reason: '' },
      staffHeaders,
      undefined,
      403
    );
  } finally {
    await http.pool.query(
      "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='saving-order-admin'",
      [typeof livePermissions === 'string' ? livePermissions : JSON.stringify(livePermissions)]
    );
  }
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='saving-order-staff'"
  );
  try {
    await rejectedSavingChange(
      result.savingOrderId,
      amendPath,
      { ...amendmentInput, expectedReviewHash: 'a'.repeat(64), reason: '' },
      staffHeaders,
      undefined,
      403
    );
  } finally {
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='saving-order-staff'"
    );
  }
  const maximalPreview = await request(
    addressPreviewPath,
    'POST',
    { ...addressPreviewInput, reason: ` ${'x'.repeat(1000)} ` },
    staffHeaders
  );
  expect(maximalPreview.status, http.logs()).toBe(200);
  expect(await maximalPreview.json()).toHaveProperty('data.reason', 'x'.repeat(1000));
  const addressPreview = await request(
    `/api/staff/saving/orders/${result.savingOrderId}/amend-address-review`,
    'POST',
    {
      expectedVersionId: amendmentInput.expectedVersionId,
      expectedAddressId: amendmentInput.expectedAddressId,
      addressId: amendmentInput.addressId,
      reason: amendmentInput.reason,
    },
    staffHeaders
  );
  expect(addressPreview.status, http.logs()).toBe(200);
  const addressReview = (await addressPreview.json()) as {
    hash: string;
    data: {
      previousAddress: { full_address: string };
      replacementAddress: { full_address: string; postal_code: string };
      invoiceState: string;
      invoiceTotalIrR: string;
      paidAmountIrR: string;
      outcome: string;
    };
  };
  expect(addressReview.data).toMatchObject({
    previousAddress: { full_address: 'Test installation address' },
    replacementAddress: {
      full_address: 'Corrected installation address',
      postal_code: '9876543210',
    },
    invoiceState: 'Paid',
    outcome: 'update_installation_address_without_repricing',
  });
  expect(addressReview.data.paidAmountIrR).toBe(addressReview.data.invoiceTotalIrR);
  amendmentInput.expectedReviewHash = addressReview.hash;
  expect(
    await (
      await request(
        `/api/staff/saving/orders/${result.savingOrderId}`,
        'GET',
        undefined,
        staffHeaders
      )
    ).json()
  ).toMatchObject({ canAmendAddress: true });
  expect((await request(amendPath, 'POST', amendmentInput)).status).toBe(403);
  const { expectedReviewHash: _unusedAddressHash, ...addressWithoutHash } = amendmentInput;
  expect((await request(amendPath, 'POST', addressWithoutHash, staffHeaders)).status).toBe(400);
  expect(
    (
      await request(
        amendPath,
        'POST',
        { ...amendmentInput, expectedVersionId: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  await http.pool.query("UPDATE addresses SET postal_code='1111111111' WHERE id=$1", [
    amendedAddressId,
  ]);
  expect((await request(amendPath, 'POST', amendmentInput, staffHeaders)).status).toBe(409);
  await http.pool.query("UPDATE addresses SET postal_code='9876543210' WHERE id=$1", [
    amendedAddressId,
  ]);
  const amended = await request(amendPath, 'POST', amendmentInput, staffHeaders);
  expect(amended.status, http.logs()).toBe(201);
  const amendment = (await amended.json()) as {
    amendmentId: string;
    savingOrderId: string;
    address: unknown;
  };
  const savedAddress = (
    await http.pool.query(
      'SELECT id,province_id,city_id,full_address,postal_code FROM addresses WHERE id=$1',
      [amendedAddressId]
    )
  ).rows[0];
  expect(amendment).toEqual({
    amendmentId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    savingOrderId: result.savingOrderId,
    address: savedAddress,
  });
  const addressAudit = (
    await http.pool.query<{ metadata: { reviewHash: string } }>(
      `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='saving.address_amended'
       AND metadata::jsonb->>'savingOrderId'=$1 ORDER BY created_at DESC LIMIT 1`,
      [result.savingOrderId]
    )
  ).rows[0];
  expect(addressAudit?.metadata.reviewHash).toBe(addressReview.hash);
  await expectCoreAudit(http.pool, 'saving.address_amended', result.savingOrderId, {
    entity: 'saving_order',
    fromState: 'approved',
    toState: 'approved',
    reason: amendmentInput.reason,
    actor: 'saving-order-staff',
    context: 'staff',
  });

  const beforeAddressReplay = await savingChangeSnapshot(result.savingOrderId);
  const addressReplay = await request(amendPath, 'POST', amendmentInput, staffHeaders);
  expect(addressReplay.status, http.logs()).toBe(201);
  expect(await addressReplay.json()).toEqual(amendment);
  expect(await savingChangeSnapshot(result.savingOrderId)).toEqual(beforeAddressReplay);
  expect(
    (
      await request(
        amendPath,
        'POST',
        { ...amendmentInput, idempotencyKey: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  const amendedStaffDetail = await request(
    `/api/staff/saving/orders/${result.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(await amendedStaffDetail.json()).toMatchObject({
    versionId: staffDetail.versionId,
    installationAddressId: amendedAddressId,
    addressOptions: expect.arrayContaining([expect.objectContaining({ id: amendedAddressId })]),
    addressAmendments: [{ id: amendment.amendmentId }],
  });
  expect(
    await (await request(`/api/saving/orders/${result.savingOrderId}`, 'GET')).json()
  ).toMatchObject({
    address_snapshot: { full_address: 'Corrected installation address' },
    addressAmendments: [
      {
        id: amendment.amendmentId,
        previousAddress: 'Test installation address',
        address: 'Corrected installation address',
        reason: amendmentInput.reason,
      },
    ],
  });
  expect(
    (
      await http.pool.query<{
        total_amount: string;
        snapshot_full_address: string;
        invoiced_address: string;
        published_address: string;
      }>(
        `SELECT i.total_amount::text,o.snapshot_full_address,
          i.invoice_calculation_snapshot #>> '{address,full_address}' AS invoiced_address,
          (SELECT content #>> '{address,full_address}' FROM contract_versions WHERE id=$2) AS published_address
         FROM invoices i
         JOIN orders o ON o.id=i.order_id WHERE i.id=$1`,
        [result.invoiceId, staffDetail.versionId]
      )
    ).rows[0]
  ).toMatchObject({
    total_amount: quote.totalIrR,
    snapshot_full_address: 'Corrected installation address',
    invoiced_address: 'Test installation address',
    published_address: 'Test installation address',
  });
  await expect(
    http.pool.query('DELETE FROM saving_address_amendments WHERE id=$1', [amendment.amendmentId])
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${costlyHardwareId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  const upgradeInput = {
    idempotencyKey: randomUUID(),
    expectedVersionId: staffDetail.versionId,
    expectedHardwareId: input.hardwareProductId,
    hardwareProductId: costlyHardwareId,
    reason: 'Customer requested a higher-priced device before delivery',
    expectedReviewHash: '',
  };
  const upgradeReview = await hardwareAmendmentReview(result.savingOrderId, upgradeInput);
  expect(upgradeReview.data.outcome).toBe('additional_charge');
  expect(BigInt(upgradeReview.data.priceDeltaIrR)).toBeGreaterThan(0n);
  upgradeInput.expectedReviewHash = upgradeReview.hash;
  const requestedUpgrade = await request(hardwarePath, 'POST', upgradeInput, staffHeaders);
  expect(requestedUpgrade.status, http.logs()).toBe(201);
  const upgrade = (await requestedUpgrade.json()) as {
    upgradeId: string;
    adjustmentInvoiceId: string;
    priceDeltaIrR: string;
    status: string;
  };
  expect(upgrade.status).toBe('awaiting_payment');
  await expectCoreAudit(http.pool, 'saving.hardware_upgrade_requested', upgrade.upgradeId, {
    entity: 'saving_hardware_upgrade_request',
    fromState: null,
    toState: 'awaiting_payment',
    reason: upgradeInput.reason,
    actor: 'saving-order-staff',
    context: 'staff',
  });

  expect(BigInt(upgrade.priceDeltaIrR)).toBeGreaterThan(0n);
  expect((await request(hardwarePath, 'POST', upgradeInput, staffHeaders)).status).toBe(201);
  expect(
    (await request(stagePath('product_delivery'), 'POST', stageInput(), staffHeaders)).status
  ).toBe(409);
  expect(
    (
      await http.pool.query<{ hardware_product_id: string }>(
        'SELECT hardware_product_id FROM saving_orders WHERE id=$1',
        [result.savingOrderId]
      )
    ).rows[0]?.hardware_product_id
  ).toBe(input.hardwareProductId);
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [costlyHardwareId]
      )
    ).rows[0]?.reserved_count
  ).toBe(1);
  expect(
    await (await request(`/api/saving/orders/${result.savingOrderId}`, 'GET')).json()
  ).toMatchObject({
    hardwareUpgrades: [
      {
        id: upgrade.upgradeId,
        status: 'awaiting_payment',
        adjustmentInvoiceId: upgrade.adjustmentInvoiceId,
      },
    ],
  });
  expect(
    await (await request(`/api/saving/orders?profileId=${input.profileId}`, 'GET')).json()
  ).toMatchObject({
    orders: expect.arrayContaining([
      expect.objectContaining({
        id: result.savingOrderId,
        pending_upgrade_invoice_id: upgrade.adjustmentInvoiceId,
        pending_upgrade_invoice_state: 'Unpaid',
      }),
    ]),
  });
  const cancelUpgradePath = `/api/staff/saving/orders/${result.savingOrderId}/cancel-hardware-upgrade`;
  const cancelUpgradeInput = {
    idempotencyKey: randomUUID(),
    upgradeId: upgrade.upgradeId,
    reason: 'Customer changed their mind before paying',
    expectedReviewHash: '',
  };
  const cancellationReview = await request(
    `/api/staff/saving/orders/${result.savingOrderId}/cancel-hardware-upgrade-review`,
    'POST',
    { upgradeId: cancelUpgradeInput.upgradeId, reason: cancelUpgradeInput.reason },
    staffHeaders
  );
  expect(cancellationReview.status, http.logs()).toBe(200);
  const cancellationSnapshot = (await cancellationReview.json()) as {
    hash: string;
    data: { additionalChargeIrR: string; invoicePaidIrR: string; outcome: string };
  };
  expect(cancellationSnapshot.data).toMatchObject({
    additionalChargeIrR: expect.any(String),
    invoicePaidIrR: '0',
    outcome: 'cancel_unpaid_charge_and_release_reservation',
  });
  expect(BigInt(cancellationSnapshot.data.additionalChargeIrR)).toBeGreaterThan(0n);
  cancelUpgradeInput.expectedReviewHash = cancellationSnapshot.hash;
  await hardwareFeedbackProbes(async () => {
    const previewBody = {
      upgradeId: cancelUpgradeInput.upgradeId,
      reason: cancelUpgradeInput.reason,
    };
    for (const [route, body] of [
      [`${cancelUpgradePath}-review`, previewBody],
      [cancelUpgradePath, cancelUpgradeInput],
    ] as const) {
      for (const reason of ['', 'x'.repeat(1001), null])
        await rejectedSavingHardware(result.savingOrderId, route, { ...body, reason }, ['reason']);
      for (const invalid of [
        { ...body, upgradeId: 'PRIVATE' },
        { ...body, reason: '', upgradeId: 'PRIVATE' },
        { ...body, reason: '', extra: 'PRIVATE' },
        null,
        ...(route === cancelUpgradePath
          ? [
              { ...body, reason: '', idempotencyKey: 'PRIVATE' },
              { ...body, reason: '', expectedReviewHash: 'PRIVATE' },
            ]
          : []),
      ])
        await rejectedSavingHardware(result.savingOrderId, route, invalid);
      await rejectedSavingHardware(
        result.savingOrderId,
        route,
        { ...body, upgradeId: randomUUID(), reason: '' },
        undefined,
        409
      );
      await rejectedSavingHardware(
        result.savingOrderId,
        route.replace(result.savingOrderId, randomUUID()),
        { ...body, reason: '' },
        undefined,
        404
      );
      await rejectedSavingHardware(
        result.savingOrderId,
        route,
        { ...body, reason: '' },
        undefined,
        403,
        customerHeaders
      );
    }
    const originalPermissions = (
      await http.pool.query<{ permissions: unknown }>(
        "SELECT permissions FROM staff_roles WHERE role_id='saving-order-admin'"
      )
    ).rows[0]!.permissions;
    await http.pool.query(
      "UPDATE staff_roles SET permissions='[\"contracts:write\"]' WHERE role_id='saving-order-admin'"
    );
    try {
      for (const [route, body] of [
        [`${cancelUpgradePath}-review`, previewBody],
        [cancelUpgradePath, cancelUpgradeInput],
      ] as const)
        await rejectedSavingHardware(
          result.savingOrderId,
          route,
          { ...body, reason: '' },
          undefined,
          403
        );
    } finally {
      await http.pool.query(
        "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='saving-order-admin'",
        [
          typeof originalPermissions === 'string'
            ? originalPermissions
            : JSON.stringify(originalPermissions),
        ]
      );
    }
    await http.pool.query(
      "UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='saving-order-staff'"
    );
    try {
      await rejectedSavingHardware(
        result.savingOrderId,
        cancelUpgradePath,
        { ...cancelUpgradeInput, reason: '' },
        undefined,
        403
      );
    } finally {
      await http.pool.query(
        "UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='saving-order-staff'"
      );
    }
  });
  const { expectedReviewHash: _unusedCancelHash, ...cancelWithoutHash } = cancelUpgradeInput;
  const missingCancellationReview = await request(
    cancelUpgradePath,
    'POST',
    cancelWithoutHash,
    staffHeaders
  );
  expect(missingCancellationReview.status, await missingCancellationReview.text()).toBe(400);
  expect(
    (
      await request(
        cancelUpgradePath,
        'POST',
        { ...cancelUpgradeInput, reason: 'A different cancellation reason' },
        staffHeaders
      )
    ).status
  ).toBe(409);
  await expectSavingSystemFailure(
    result.savingOrderId,
    'saving.hardware_upgrade_closed',
    async () => {
      const failed = await request(cancelUpgradePath, 'POST', cancelUpgradeInput, staffHeaders);
      expect(failed.status, http.logs()).toBe(500);
    }
  );
  const cancelledUpgrade = await request(
    cancelUpgradePath,
    'POST',
    cancelUpgradeInput,
    staffHeaders
  );
  expect(cancelledUpgrade.status, http.logs()).toBe(200);
  await expectSavingUpgradeAudit(
    upgrade.upgradeId,
    result.savingOrderId,
    'cancelled',
    upgradeInput.reason,
    'staff'
  );
  const cancellationAudit = (
    await http.pool.query<{ metadata: { reviewHash: string } }>(
      `SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='saving.hardware_upgrade_cancelled'
       AND metadata::jsonb->>'savingOrderId'=$1 ORDER BY created_at DESC LIMIT 1`,
      [result.savingOrderId]
    )
  ).rows[0];
  expect(cancellationAudit?.metadata.reviewHash).toBe(cancellationSnapshot.hash);
  await expectCoreAudit(http.pool, 'saving.hardware_upgrade_cancelled', upgrade.upgradeId, {
    entity: 'saving_hardware_upgrade_request',
    fromState: 'awaiting_payment',
    toState: 'cancelled',
    reason: cancelUpgradeInput.reason,
    actor: 'saving-order-staff',
    context: 'staff',
  });

  expect((await request(cancelUpgradePath, 'POST', cancelUpgradeInput, staffHeaders)).status).toBe(
    200
  );
  expect(
    (
      await http.pool.query<{ status: string }>(
        'SELECT status FROM saving_hardware_upgrade_requests WHERE id=$1',
        [upgrade.upgradeId]
      )
    ).rows[0]?.status
  ).toBe('cancelled');
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [costlyHardwareId]
      )
    ).rows[0]?.reserved_count
  ).toBe(0);
  await expect(
    http.pool.query("UPDATE invoices SET state='Paid',paid_amount=total_amount WHERE id=$1", [
      upgrade.adjustmentInvoiceId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const expiringRequest = await request(
    hardwarePath,
    'POST',
    { ...upgradeInput, idempotencyKey: randomUUID() },
    staffHeaders
  );
  expect(expiringRequest.status, http.logs()).toBe(201);
  const expiringUpgrade = (await expiringRequest.json()) as {
    upgradeId: string;
    adjustmentInvoiceId: string;
  };
  const expiringPreview = await request(
    `/api/staff/saving/orders/${result.savingOrderId}/cancel-hardware-upgrade-review`,
    'POST',
    { upgradeId: expiringUpgrade.upgradeId, reason: 'Payment window ended' },
    staffHeaders
  );
  expect(expiringPreview.status, http.logs()).toBe(200);
  const expiringHash = ((await expiringPreview.json()) as { hash: string }).hash;
  await expectSavingSystemFailure(
    result.savingOrderId,
    'saving.hardware_upgrade_closed',
    async () => {
      await expect(
        http.pool.query("UPDATE invoices SET state='Overdue' WHERE id=$1", [
          expiringUpgrade.adjustmentInvoiceId,
        ])
      ).rejects.toThrow('saving system audit unavailable');
    }
  );
  await http.pool.query("UPDATE invoices SET state='Overdue' WHERE id=$1", [
    expiringUpgrade.adjustmentInvoiceId,
  ]);
  await expectSavingUpgradeAudit(
    expiringUpgrade.upgradeId,
    result.savingOrderId,
    'expired',
    upgradeInput.reason,
    null
  );
  expect(
    (
      await request(
        cancelUpgradePath,
        'POST',
        {
          idempotencyKey: randomUUID(),
          upgradeId: expiringUpgrade.upgradeId,
          expectedReviewHash: expiringHash,
          reason: 'Payment window ended',
        },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(
    (
      await http.pool.query<{ status: string }>(
        'SELECT status FROM saving_hardware_upgrade_requests WHERE id=$1',
        [expiringUpgrade.upgradeId]
      )
    ).rows[0]?.status
  ).toBe('expired');
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [costlyHardwareId]
      )
    ).rows[0]?.reserved_count
  ).toBe(0);
  await expect(
    http.pool.query("UPDATE invoices SET state='Paid',paid_amount=total_amount WHERE id=$1", [
      expiringUpgrade.adjustmentInvoiceId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const requestedAgain = await request(
    hardwarePath,
    'POST',
    { ...upgradeInput, idempotencyKey: randomUUID() },
    staffHeaders
  );
  expect(requestedAgain.status, http.logs()).toBe(201);
  const payableUpgrade = (await requestedAgain.json()) as {
    upgradeId: string;
    adjustmentInvoiceId: string;
    priceDeltaIrR: string;
  };
  const upgradePaymentPath = `/api/invoices/${payableUpgrade.adjustmentInvoiceId}/wallet-payment`;
  const upgradePaymentReview = await request(upgradePaymentPath, 'GET');
  expect(upgradePaymentReview.status, http.logs()).toBe(200);
  const upgradePaymentHash = ((await upgradePaymentReview.json()) as { review: { hash: string } })
    .review.hash;
  await expectSavingSystemFailure(
    result.savingOrderId,
    'saving.hardware_upgrade_applied',
    async () => {
      const failed = await request(upgradePaymentPath, 'POST', {
        idempotencyKey: randomUUID(),
        expectedRemainingAmount: payableUpgrade.priceDeltaIrR,
        expectedReviewHash: upgradePaymentHash,
      });
      expect(failed.status, http.logs()).toBe(500);
    }
  );
  const upgradePaid = await request(upgradePaymentPath, 'POST', {
    idempotencyKey: randomUUID(),
    expectedRemainingAmount: payableUpgrade.priceDeltaIrR,
    expectedReviewHash: upgradePaymentHash,
  });
  expect(upgradePaid.status, http.logs()).toBe(200);
  await expectSavingUpgradeAudit(
    payableUpgrade.upgradeId,
    result.savingOrderId,
    'applied',
    upgradeInput.reason,
    null
  );
  await expectSavingInventoryHistory(result.savingOrderId);
  expect(
    (
      await http.pool.query<{ total_amount: string }>(
        'SELECT total_amount::text FROM invoices WHERE id=$1',
        [result.invoiceId]
      )
    ).rows[0]?.total_amount
  ).toBe(quote.totalIrR);
  expect(
    await (await request(`/api/saving/orders/${result.savingOrderId}`, 'GET')).json()
  ).toMatchObject({
    hardware_product_id: costlyHardwareId,
    current_hardware_title: { en: 'Costlier device' },
    hardwareUpgrades: expect.arrayContaining([
      expect.objectContaining({ id: payableUpgrade.upgradeId, status: 'applied' }),
    ]),
    hardwareAmendments: expect.arrayContaining([
      expect.objectContaining({
        adjustmentInvoiceId: payableUpgrade.adjustmentInvoiceId,
        priceDeltaIrR: payableUpgrade.priceDeltaIrR,
      }),
    ]),
  });
  expect(
    (
      await http.pool.query<{ stock_count: number; reserved_count: number }>(
        'SELECT stock_count,reserved_count FROM products WHERE id=$1',
        [costlyHardwareId]
      )
    ).rows[0]
  ).toMatchObject({ stock_count: 1, reserved_count: 0 });
  const deliveryInput = await reviewedStageInput('product_delivery');
  expect(
    (
      await request(
        stagePath('product_delivery'),
        'POST',
        { ...deliveryInput, idempotencyKey: randomUUID(), expectedReviewHash: '0'.repeat(64) },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(
    (
      await request(
        stagePath('product_delivery'),
        'POST',
        { ...deliveryInput, idempotencyKey: randomUUID(), expectedReviewHash: undefined },
        staffHeaders
      )
    ).status
  ).toBe(400);
  await expectSavingStageWriteRollback(
    result.savingOrderId,
    'installation_and_document_upload',
    () => request(stagePath('product_delivery'), 'POST', deliveryInput, staffHeaders)
  );
  await expectSavingStageAuditRollback(result.savingOrderId, () =>
    request(stagePath('product_delivery'), 'POST', deliveryInput, staffHeaders)
  );
  await expectSavingStatusRollback(
    http.pool,
    result.savingOrderId,
    'in_progress',
    () => request(stagePath('product_delivery'), 'POST', deliveryInput, staffHeaders),
    true
  );
  const delivered = await request(
    stagePath('product_delivery'),
    'POST',
    deliveryInput,
    staffHeaders
  );
  expect(delivered.status, http.logs()).toBe(200);
  const deliveryAudit = (
    await http.pool.query<{
      metadata: { reviewHash: string; financialReview: { hash: string } };
    }>(
      `SELECT metadata::jsonb AS metadata FROM audit_log
       WHERE event='saving.fulfillment.complete' AND metadata::jsonb->>'savingOrderId'=$1
       ORDER BY created_at DESC LIMIT 1`,
      [result.savingOrderId]
    )
  ).rows[0];
  expect(deliveryAudit?.metadata.reviewHash).toBe(deliveryInput.expectedReviewHash);
  expect(deliveryAudit?.metadata.financialReview.hash).toBe(deliveryInput.expectedReviewHash);
  expect(
    await (
      await request(
        `/api/staff/saving/orders/${result.savingOrderId}`,
        'GET',
        undefined,
        staffHeaders
      )
    ).json()
  ).toMatchObject({ canAmendAddress: false, canAmendHardware: false });
  expect(
    (
      await request(
        hardwarePath,
        'POST',
        { ...hardwareInput, idempotencyKey: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(
    (
      await request(
        amendPath,
        'POST',
        {
          ...amendmentInput,
          idempotencyKey: randomUUID(),
          expectedAddressId: amendedAddressId,
          addressId: input.installationAddressId,
        },
        staffHeaders
      )
    ).status
  ).toBe(409);
  expect(await delivered.json()).toMatchObject({
    status: 'in_progress',
    nextStage: 'installation_and_document_upload',
  });
  expect(
    (await request(stagePath('equipment_handover', 'skip'), 'POST', stageInput(), staffHeaders))
      .status
  ).toBe(409);
  const installed = await request(
    stagePath('installation_and_document_upload'),
    'POST',
    await reviewedStageInput('installation_and_document_upload'),
    staffHeaders
  );
  expect(installed.status, http.logs()).toBe(200);
  const skipped = await request(
    stagePath('equipment_handover', 'skip'),
    'POST',
    await reviewedStageInput('equipment_handover', 'skip'),
    staffHeaders
  );
  expect(skipped.status, http.logs()).toBe(200);
  expect(
    (await request(stagePath('process_completion'), 'POST', stageInput(), staffHeaders)).status
  ).toBe(409);
  const acceptanceReview = await request(
    `/api/contracts/${result.contractId}/acceptance-review?versionId=${staffDetail.versionId}`,
    'GET'
  );
  expect(acceptanceReview.status, http.logs()).toBe(200);
  const acceptanceHash = ((await acceptanceReview.json()) as { hash: string }).hash;
  const accepted = await request(`/api/contracts/${result.contractId}/accept`, 'POST', {
    idempotencyKey: randomUUID(),
    expectedVersionId: staffDetail.versionId,
    expectedReviewHash: acceptanceHash,
  });
  expect(accepted.status, http.logs()).toBe(200);
  expect((await activateReadyContracts(http.pool)).activated).toBe(1);
  const completed = await request(
    stagePath('process_completion'),
    'POST',
    await reviewedStageInput('process_completion'),
    staffHeaders
  );
  expect(completed.status, http.logs()).toBe(200);
  expect(await completed.json()).toMatchObject({ status: 'completed', nextStage: null });
  await expectSavingStatusDeliveries(http.pool, result.savingOrderId, 'saving-order-buyer', [
    'approved',
    'in_progress',
    'completed',
  ]);
  const finalReplaySnapshot = await savingOperationsSnapshot(result.savingOrderId);
  const terminalStageReplay = await request(
    stagePath('product_delivery'),
    'POST',
    deliveryInput,
    staffHeaders
  );
  expect(terminalStageReplay.status, http.logs()).toBe(200);
  expect(await terminalStageReplay.json()).toEqual({
    savingOrderId: result.savingOrderId,
    status: 'in_progress',
    stage: 'product_delivery',
    stageStatus: 'completed',
    nextStage: 'installation_and_document_upload',
  });
  const terminalApprovalReplay = await request(approvePath, 'POST', approval, staffHeaders);
  expect(terminalApprovalReplay.status, http.logs()).toBe(200);
  expect(await terminalApprovalReplay.json()).toEqual({
    savingOrderId: result.savingOrderId,
    status: 'approved',
    refundId: null,
  });
  expect(await savingOperationsSnapshot(result.savingOrderId)).toEqual(finalReplaySnapshot);
  expect(
    await (await request(`/api/contracts/${result.contractId}/cancellation-requests`, 'GET')).json()
  ).toMatchObject({ canRequest: false });
  const completedCancellationPreview = await request(
    `/api/admin/contracts/${result.contractId}/cancellation-preview`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(completedCancellationPreview.status, http.logs()).toBe(200);
  expect(await completedCancellationPreview.json()).toMatchObject({
    blockers: expect.arrayContaining(['saving_order_terminal']),
  });
  expect(
    await (
      await request(
        `/api/admin/contracts/${result.contractId}/cancellation-status`,
        'GET',
        undefined,
        staffHeaders
      )
    ).json()
  ).toMatchObject({ canCancel: false, savingTerminal: true });
  expect(
    (await request(stagePath('process_completion'), 'POST', stageInput(), staffHeaders)).status
  ).toBe(409);
  const completedPlanArchive = await request(
    `/api/admin/catalogue/products/${input.savingPlanId}`,
    'DELETE',
    undefined,
    staffHeaders
  );
  expect(completedPlanArchive.status, http.logs()).toBe(409);
  expect(
    (await http.pool.query("SELECT id FROM audit_log WHERE event='catalogue_product_archived'"))
      .rows
  ).toEqual(archiveAuditBefore);
  const customerProgress = await request(`/api/saving/orders/${result.savingOrderId}`, 'GET');
  expect(customerProgress.status, http.logs()).toBe(200);
  expect(await customerProgress.json()).toMatchObject({
    status: 'completed',
    stages: [
      { status: 'completed' },
      { status: 'completed' },
      { status: 'completed' },
      { status: 'skipped' },
      { status: 'completed' },
    ],
  });
  const history = await request(
    `/api/staff/saving/orders/${result.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(history.status, http.logs()).toBe(200);
  const staffHistory = (await history.json()) as {
    events: Array<Record<string, unknown>>;
    eventsTruncated: boolean;
  };
  expect(staffHistory.events).toHaveLength(9);
  await expectSavingStageAudits(result.savingOrderId);

  expect(staffHistory.eventsTruncated).toBe(false);
  expect(staffHistory.events.every((event) => event.actor_context === 'staff')).toBe(true);
  expect(
    staffHistory.events.every((event) => event.actorName === null && !('actor_user_id' in event))
  ).toBe(true);
  const readProgress = async () => {
    const response = await request(`/api/saving/orders/${result.savingOrderId}`, 'GET');
    expect(response.status, http.logs()).toBe(200);
    return (await response.json()) as {
      events: Array<Record<string, unknown>>;
      eventsTruncated: boolean;
    };
  };
  const publicHistory = await readProgress();
  expect(publicHistory.events).toEqual(staffHistory.events);
  expect(publicHistory.eventsTruncated).toBe(false);
  expect(publicHistory.events[0]).toMatchObject({
    stage: 'request_confirmation',
    noteKind: 'confirmed',
  });
  expect(publicHistory.events[1]).toMatchObject({ stage: 'product_delivery', noteKind: 'started' });
  expect(publicHistory.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        stage: 'equipment_handover',
        to_status: 'skipped',
        noteKind: 'recorded',
      }),
    ])
  );
  const displayName = 'کارشناس <img src=x>';
  await http.pool.query(
    "INSERT INTO conversation_identities(user_id,display_name) VALUES('saving-order-staff',$1)",
    [displayName]
  );
  expect((await readProgress()).events.every((event) => event.actorName === null)).toBe(true);
  await http.pool.query(
    "UPDATE conversation_identities SET share_in_activity=true WHERE user_id='saving-order-staff'"
  );
  const sharedHistory = await readProgress();
  expect(sharedHistory.events.every((event) => event.actorName === displayName)).toBe(true);
  expect(JSON.stringify(sharedHistory.events)).not.toContain('saving-order-staff');
  expect(JSON.stringify(sharedHistory.events)).not.toContain('username');
  expect(JSON.stringify(sharedHistory.events)).not.toContain('photo_document_id');
  await http.pool.query(
    "UPDATE conversation_identities SET share_in_activity=false WHERE user_id='saving-order-staff'"
  );
  expect((await readProgress()).events.every((event) => event.actorName === null)).toBe(true);
  await http.pool.query(
    "UPDATE conversation_identities SET share_in_activity=true WHERE user_id='saving-order-staff'"
  );
  await http.pool.query("UPDATE users SET disabled_at=NOW() WHERE user_id='saving-order-staff'");
  expect((await readProgress()).events.every((event) => event.actorName === null)).toBe(true);
  await http.pool.query("UPDATE users SET disabled_at=NULL WHERE user_id='saving-order-staff'");
  await http.pool.query("DELETE FROM conversation_identities WHERE user_id='saving-order-staff'");
  await http.pool.query(
    `INSERT INTO saving_fulfillment_events(order_id,stage,from_status,to_status,actor_user_id,explanation,created_at)
     SELECT $1,'product_delivery','in_progress','completed','saving-order-staff','Historical fixture ' || n,
       NOW()+n*INTERVAL '1 minute' FROM generate_series(1,201) n`,
    [result.savingOrderId]
  );
  const stranger = randomUUID(),
    strangerSession = randomUUID(),
    strangerCsrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'test-only')",
    [stranger, `${stranger}@example.test`]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,operating_context) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes','customer')",
    [strangerSession, stranger, strangerCsrf, randomUUID()]
  );
  const unauthorizedHistory = await request(
    `/api/saving/orders/${result.savingOrderId}`,
    'GET',
    undefined,
    { Cookie: `barghsa_session=${strangerSession}`, 'X-CSRF-Token': strangerCsrf }
  );
  expect(unauthorizedHistory.status).toBe(404);
  expect(await unauthorizedHistory.text()).not.toContain('Historical fixture');
  await http.pool.query("DELETE FROM user_roles WHERE user_id='saving-order-staff'");
  expect(
    (
      await request(
        `/api/staff/saving/orders/${result.savingOrderId}`,
        'GET',
        undefined,
        staffHeaders
      )
    ).status
  ).toBe(403);
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('saving-order-staff','saving-order-admin')"
  );
  const boundedHistory = await readProgress();
  expect(boundedHistory.eventsTruncated).toBe(true);
  expect(boundedHistory.events).toHaveLength(200);
  expect(boundedHistory.events[0]).toMatchObject({ explanation: 'Historical fixture 2' });
  expect(boundedHistory.events.at(-1)).toMatchObject({ explanation: 'Historical fixture 201' });
  expect(boundedHistory.events.some((event) => event.explanation === 'Historical fixture 1')).toBe(
    false
  );

  const rejectedDetail = await request(
    `/api/staff/saving/orders/${discountedOrder.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(rejectedDetail.status, http.logs()).toBe(200);
  const rejectedVersion = ((await rejectedDetail.json()) as { versionId: string }).versionId;
  const rejectionReview = await decisionReview(
    discountedOrder.savingOrderId,
    'reject',
    'Device unavailable'
  );
  expect(rejectionReview.data.outcome).toBe('cancel_invoice');
  const rejected = await request(
    `/api/staff/saving/orders/${discountedOrder.savingOrderId}/reject`,
    'POST',
    {
      idempotencyKey: randomUUID(),
      expectedVersionId: rejectedVersion,
      expectedReviewHash: rejectionReview.hash,
      reason: 'Device unavailable',
    },
    staffHeaders
  );
  expect(rejected.status, http.logs()).toBe(200);
  expect(await rejected.json()).toMatchObject({ status: 'rejected' });
  await expectSavingStatusDeliveries(
    http.pool,
    discountedOrder.savingOrderId,
    'saving-order-buyer',
    ['rejected']
  );
  await expectCoreAudit(http.pool, 'saving.order_review.reject', discountedOrder.savingOrderId, {
    entity: 'saving_order',
    fromState: 'awaiting_staff_review',
    toState: 'rejected',
    reason: 'Device unavailable',
    actor: 'saving-order-staff',
    context: 'staff',
  });

  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.reserved_count
  ).toBe(0);
  const rejectedState = await http.pool.query<{ invoice_state: string }>(
    'SELECT state AS invoice_state FROM invoices WHERE order_id=$1',
    [discountedOrder.orderId]
  );
  expect(rejectedState.rows[0]?.invoice_state).toBe('Cancelled');

  const paidInput = { ...input, billIdentifier: '1234567890125' };
  const paidQuoteResponse = await request('/api/saving/orders/quote', 'POST', paidInput);
  expect(paidQuoteResponse.status, http.logs()).toBe(201);
  const paidQuote = (await paidQuoteResponse.json()) as { reviewDigest: string; totalIrR: string };
  const paidSubmission = await request('/api/saving/orders', 'POST', {
    ...paidInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: paidQuote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(paidSubmission.status, http.logs()).toBe(201);
  const paidOrder = (await paidSubmission.json()) as {
    savingOrderId: string;
    orderId: string;
    invoiceId: string;
  };
  const paidReviewPath = `/api/invoices/${paidOrder.invoiceId}/wallet-payment`;
  const paidWalletReview = await request(paidReviewPath, 'GET');
  expect(paidWalletReview.status, http.logs()).toBe(200);
  const paidHash = ((await paidWalletReview.json()) as { review: { hash: string } }).review.hash;
  expect(
    (
      await request(paidReviewPath, 'POST', {
        idempotencyKey: randomUUID(),
        expectedRemainingAmount: paidQuote.totalIrR,
        expectedReviewHash: paidHash,
      })
    ).status,
    http.logs()
  ).toBe(200);
  const paidStaffDetail = await request(
    `/api/staff/saving/orders/${paidOrder.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(paidStaffDetail.status, http.logs()).toBe(200);
  const paidVersion = ((await paidStaffDetail.json()) as { versionId: string }).versionId;
  const paidReview = await decisionReview(paidOrder.savingOrderId, 'reject', 'Device unavailable');
  expect(paidReview.data).toMatchObject({
    outcome: 'refund_obligation',
    refundAmount: paidQuote.totalIrR,
  });
  const paidRejected = await request(
    `/api/staff/saving/orders/${paidOrder.savingOrderId}/reject`,
    'POST',
    {
      idempotencyKey: randomUUID(),
      expectedVersionId: paidVersion,
      expectedReviewHash: paidReview.hash,
      reason: 'Device unavailable',
    },
    staffHeaders
  );
  expect(paidRejected.status, http.logs()).toBe(200);
  expect(await paidRejected.json()).toMatchObject({
    status: 'rejected',
    refundId: expect.any(String),
  });
  const obligation = await http.pool.query<{ id: string; status: string; amount: string }>(
    `SELECT r.id,r.state AS status,r.amount::text AS amount FROM refund_obligations o
     JOIN refunds r ON r.id=o.refund_id WHERE o.order_id=$1`,
    [paidOrder.orderId]
  );
  expect(obligation.rows[0]).toMatchObject({ status: 'Processing', amount: paidQuote.totalIrR });
  expect(await runWalletRefund(http.pool, obligation.rows[0]!.id)).toBe('completed');
  const refundedState = await http.pool.query<{ financial_status: string }>(
    'SELECT financial_status FROM saving_orders WHERE id=$1',
    [paidOrder.savingOrderId]
  );
  expect(refundedState.rows[0]?.financial_status).toBe('refunded');
  const refundNotice = await http.pool.query<{ link_route: string }>(
    'SELECT link_route FROM in_app_notifications WHERE delivery_key=$1',
    [`refund:${obligation.rows[0]!.id}:Completed`]
  );
  expect(refundNotice.rows[0]?.link_route).toBe(`/savings/orders/${paidOrder.savingOrderId}`);
  expect(
    (
      await http.pool.query<{ stock_count: number; reserved_count: number }>(
        'SELECT stock_count,reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]
  ).toMatchObject({ stock_count: 2, reserved_count: 0 });
  const cancellationInput = { ...input, billIdentifier: '1234567890128' };
  const cancellationQuoteResponse = await request(
    '/api/saving/orders/quote',
    'POST',
    cancellationInput
  );
  expect(cancellationQuoteResponse.status, http.logs()).toBe(201);
  const cancellationQuote = (await cancellationQuoteResponse.json()) as {
    reviewDigest: string;
    totalIrR: string;
  };
  const cancellationSubmission = await request('/api/saving/orders', 'POST', {
    ...cancellationInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: cancellationQuote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(cancellationSubmission.status, http.logs()).toBe(201);
  const cancellationOrder = (await cancellationSubmission.json()) as {
    savingOrderId: string;
    orderId: string;
    contractId: string;
    invoiceId: string;
  };
  const cancellationDetail = await request(
    `/api/saving/orders/${cancellationOrder.savingOrderId}`,
    'GET'
  );
  expect(cancellationDetail.status, http.logs()).toBe(200);
  const cancellationVersion = ((await cancellationDetail.json()) as { contract_version_id: string })
    .contract_version_id;
  const cancellationRequestPath = `/api/contracts/${cancellationOrder.contractId}/cancellation-requests`;
  const submitCancellationRequest = () =>
    request(cancellationRequestPath, 'POST', {
      expectedVersionId: cancellationVersion,
      reason: 'Please cancel this saving order',
      preferredDestination: 'wallet',
      idempotencyKey: randomUUID(),
    });
  expect(await (await request(cancellationRequestPath, 'GET')).json()).toMatchObject({
    canRequest: true,
  });
  const firstCancellationRequest = await submitCancellationRequest();
  expect(firstCancellationRequest.status, http.logs()).toBe(201);
  const firstRequestId = ((await firstCancellationRequest.json()) as { id: string }).id;
  expect(
    await (await request(`/api/saving/orders/${cancellationOrder.savingOrderId}`, 'GET')).json()
  ).toMatchObject({ cancellation_pending: true });
  const cancellationQueue = await request(
    '/api/admin/contract-cancellation-requests?service=savings',
    'GET',
    undefined,
    staffHeaders
  );
  expect(cancellationQueue.status, http.logs()).toBe(200);
  expect(await cancellationQueue.json()).toMatchObject({
    requests: expect.arrayContaining([
      expect.objectContaining({
        id: firstRequestId,
        savingOrderId: cancellationOrder.savingOrderId,
        billIdentifier: cancellationInput.billIdentifier,
      }),
    ]),
  });
  const rejectedCancellation = await request(
    `/api/admin/contract-cancellation-requests/${firstRequestId}/reject`,
    'POST',
    { reason: 'Please verify the installation address first', idempotencyKey: randomUUID() },
    staffHeaders
  );
  expect(rejectedCancellation.status, http.logs()).toBe(201);
  expect(await rejectedCancellation.json()).toMatchObject({ status: 'Rejected' });
  expect(await (await request(cancellationRequestPath, 'GET')).json()).toMatchObject({
    canRequest: true,
    request: { status: 'Rejected' },
  });
  const cancellationPaymentPath = `/api/invoices/${cancellationOrder.invoiceId}/wallet-payment`;
  const cancellationPaymentReview = await request(cancellationPaymentPath, 'GET');
  expect(cancellationPaymentReview.status, http.logs()).toBe(200);
  const cancellationPaymentHash = (
    (await cancellationPaymentReview.json()) as { review: { hash: string } }
  ).review.hash;
  expect(
    (
      await request(cancellationPaymentPath, 'POST', {
        idempotencyKey: randomUUID(),
        expectedRemainingAmount: cancellationQuote.totalIrR,
        expectedReviewHash: cancellationPaymentHash,
      })
    ).status,
    http.logs()
  ).toBe(200);
  const secondCancellationRequest = await submitCancellationRequest();
  expect(secondCancellationRequest.status, http.logs()).toBe(201);
  const secondRequestId = ((await secondCancellationRequest.json()) as { id: string }).id;
  const cancellationPreviewResponse = await request(
    `/api/admin/contracts/${cancellationOrder.contractId}/cancellation-preview`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(cancellationPreviewResponse.status, http.logs()).toBe(200);
  const cancellationFingerprint = (
    (await cancellationPreviewResponse.json()) as { fingerprint: string }
  ).fingerprint;
  const preparedCancellation = await request(
    `/api/admin/contracts/${cancellationOrder.contractId}/cancellations`,
    'POST',
    {
      expectedVersionId: cancellationVersion,
      expectedFingerprint: cancellationFingerprint,
      reason: 'Approved customer cancellation',
      customerRequestId: secondRequestId,
      refundDecision: { mode: 'full_wallet' },
      idempotencyKey: randomUUID(),
    },
    staffHeaders
  );
  expect(preparedCancellation.status, http.logs()).toBe(201);
  const cancellationIntentId = ((await preparedCancellation.json()) as { id: string }).id;
  const cancellationCommand = { intentId: cancellationIntentId, idempotencyKey: randomUUID() };
  await expectSavingStatusRollback(
    http.pool,
    cancellationOrder.savingOrderId,
    'cancelled',
    () =>
      request(
        `/api/admin/contracts/${cancellationOrder.contractId}/cancellations/execute`,
        'POST',
        cancellationCommand,
        staffHeaders
      ),
    false,
    { raise: 500, suppress: 409 }
  );
  const executedCancellation = await request(
    `/api/admin/contracts/${cancellationOrder.contractId}/cancellations/execute`,
    'POST',
    cancellationCommand,
    staffHeaders
  );
  expect(executedCancellation.status, http.logs()).toBe(201);
  const cancellationResult = (await executedCancellation.json()) as {
    refunds: Array<{ id: string; amount: string }>;
  };
  expect(cancellationResult.refunds).toMatchObject([{ amount: cancellationQuote.totalIrR }]);
  await expectSavingStatusDeliveries(
    http.pool,
    cancellationOrder.savingOrderId,
    'saving-order-buyer',
    ['cancelled'],
    [
      `order.status_changed:saving:${cancellationOrder.savingOrderId}:contract_cancel:${cancellationVersion}:saving-order-buyer`,
    ]
  );
  const cancelledDelivery = await savingDeliverySnapshot(
    http.pool,
    cancellationOrder.savingOrderId
  );
  const cancellationReplay = await request(
    `/api/admin/contracts/${cancellationOrder.contractId}/cancellations/execute`,
    'POST',
    cancellationCommand,
    staffHeaders
  );
  expect(cancellationReplay.status, http.logs()).toBe(201);
  expect(await cancellationReplay.json()).toEqual(cancellationResult);
  expect(await savingDeliverySnapshot(http.pool, cancellationOrder.savingOrderId)).toEqual(
    cancelledDelivery
  );

  expect(
    (
      await http.pool.query(
        `SELECT s.status,s.financial_status,o.status AS order_status,c.state AS contract_state
         FROM saving_orders s JOIN orders o ON o.id=s.order_id
         JOIN contracts c ON c.order_id=o.id WHERE s.id=$1`,
        [cancellationOrder.savingOrderId]
      )
    ).rows[0]
  ).toMatchObject({
    status: 'cancelled',
    financial_status: 'refund_pending',
    order_status: 'CANCELLED',
    contract_state: 'Cancelled',
  });
  expect(await (await request(cancellationRequestPath, 'GET')).json()).toMatchObject({
    canRequest: false,
    request: { status: 'Fulfilled' },
  });
  expect(await runWalletRefund(http.pool, cancellationResult.refunds[0]!.id)).toBe('completed');
  expect(await savingDeliverySnapshot(http.pool, cancellationOrder.savingOrderId)).toEqual(
    cancelledDelivery
  );
  expect(
    (
      await http.pool.query('SELECT financial_status FROM saving_orders WHERE id=$1', [
        cancellationOrder.savingOrderId,
      ])
    ).rows[0]?.financial_status
  ).toBe('refunded');
  expect(
    (
      await http.pool.query('SELECT stock_count,reserved_count FROM products WHERE id=$1', [
        input.hardwareProductId,
      ])
    ).rows[0]
  ).toMatchObject({ stock_count: 2, reserved_count: 0 });
  const expiryInput = { ...input, billIdentifier: '1234567890127' };
  const expiryQuoteResponse = await request('/api/saving/orders/quote', 'POST', expiryInput);
  expect(expiryQuoteResponse.status, http.logs()).toBe(201);
  const expiryDigest = ((await expiryQuoteResponse.json()) as { reviewDigest: string })
    .reviewDigest;
  const expirySubmission = await request('/api/saving/orders', 'POST', {
    ...expiryInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: expiryDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(expirySubmission.status, http.logs()).toBe(201);
  const expiryOrder = (await expirySubmission.json()) as { savingOrderId: string };
  await http.pool.query(
    "UPDATE saving_inventory_reservations SET expires_at=NOW()-INTERVAL '1 minute' WHERE order_id=$1",
    [expiryOrder.savingOrderId]
  );
  await expectSavingSystemFailure(
    expiryOrder.savingOrderId,
    'saving.inventory.expired',
    async () => {
      await expect(expireSavingInventory(http.pool)).rejects.toThrow(
        'saving system audit unavailable'
      );
    }
  );
  expect(await expireSavingInventory(http.pool)).toMatchObject({ expired: 1 });
  expect(await expireSavingInventory(http.pool)).toMatchObject({ expired: 0 });
  expect(
    (
      await http.pool.query<{ reserved_count: number }>(
        'SELECT reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]?.reserved_count
  ).toBe(0);
  const expiryDetail = await request(
    `/api/staff/saving/orders/${expiryOrder.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(expiryDetail.status, http.logs()).toBe(200);
  const expiryVersion = ((await expiryDetail.json()) as { versionId: string }).versionId;
  const expiryReview = await decisionReview(expiryOrder.savingOrderId, 'approve');
  const expiryApproval = await request(
    `/api/staff/saving/orders/${expiryOrder.savingOrderId}/approve`,
    'POST',
    {
      idempotencyKey: randomUUID(),
      expectedVersionId: expiryVersion,
      expectedReviewHash: expiryReview.hash,
    },
    staffHeaders
  );
  expect(expiryApproval.status, http.logs()).toBe(200);
  await expectSavingInventoryHistory(expiryOrder.savingOrderId, [
    [null, 'reserved'],
    ['reserved', 'expired'],
    ['expired', 'allocated'],
  ]);
  await expectSavingInventoryHistory(cancellationOrder.savingOrderId, [
    [null, 'reserved'],
    ['reserved', 'allocated'],
    ['allocated', 'released'],
  ]);
  await expectSavingInventoryHistory(discountedOrder.savingOrderId, [
    [null, 'reserved'],
    ['reserved', 'released'],
  ]);
  expect(
    (
      await http.pool.query<{ stock_count: number; reserved_count: number }>(
        'SELECT stock_count,reserved_count FROM products WHERE id=$1',
        [input.hardwareProductId]
      )
    ).rows[0]
  ).toMatchObject({ stock_count: 1, reserved_count: 0 });
}, 150000);

it('keeps the accepted agreement text and flags a newer published version', async () => {
  const hardwareResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه دوم', en: 'Second device' },
      price: '100000',
      status: 'active',
    },
    staffHeaders
  );
  expect(hardwareResponse.status, http.logs()).toBe(201);
  const hardware = (await hardwareResponse.json()) as { id: string };
  const planResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'saving_plan',
      title: { fa: 'طرح دوم', en: 'Second plan' },
      price: '100000',
      status: 'inactive',
      hardwareIds: [hardware.id],
    },
    staffHeaders
  );
  expect(planResponse.status, http.logs()).toBe(201);
  const plan = (await planResponse.json()) as { id: string };
  const agreementPath = `/api/admin/catalogue/saving-plans/${plan.id}/agreements`;
  const originalDraft = await request(
    `${agreementPath}/draft`,
    'POST',
    { title: 'Accepted terms', body: 'Original body.' },
    staffHeaders
  );
  expect(originalDraft.status, http.logs()).toBe(201);
  const original = (await originalDraft.json()) as { id: string };
  expect(
    (await request(`${agreementPath}/${original.id}/activate`, 'POST', undefined, staffHeaders))
      .status
  ).toBe(201);
  expect(
    (
      await request(
        `/api/admin/catalogue/products/${plan.id}`,
        'PUT',
        { status: 'active' },
        staffHeaders
      )
    ).status
  ).toBe(200);
  const orderInput = {
    ...input,
    savingPlanId: plan.id,
    hardwareProductId: hardware.id,
    agreementVersionId: original.id,
    billIdentifier: '9876543210987',
  };
  const quoteResponse = await request('/api/saving/orders/quote', 'POST', orderInput);
  expect(quoteResponse.status, http.logs()).toBe(201);
  const quote = (await quoteResponse.json()) as { reviewDigest: string };
  expect(
    (
      await request('/api/saving/orders/verify-bill', 'POST', {
        profileId: input.profileId,
        billIdentifier: orderInput.billIdentifier,
      })
    ).status
  ).toBe(201);
  const submitted = await request('/api/saving/orders', 'POST', {
    ...orderInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(submitted.status, http.logs()).toBe(201);
  const { savingOrderId } = (await submitted.json()) as { savingOrderId: string };
  const detailPath = `/api/saving/orders/${savingOrderId}`;
  expect(await (await request(detailPath, 'GET')).json()).toMatchObject({
    agreement_snapshot: 'Accepted terms\nOriginal body.',
    agreement_updated: false,
  });
  const stored = await http.pool.query<{ agreement_snapshot: string }>(
    'SELECT agreement_snapshot FROM saving_orders WHERE id=$1',
    [savingOrderId]
  );
  expect(stored.rows[0]?.agreement_snapshot).toBe('Accepted terms\nOriginal body.');
  const newerDraft = await request(
    `${agreementPath}/draft`,
    'POST',
    { title: 'New terms', body: 'New body.' },
    staffHeaders
  );
  expect(newerDraft.status, http.logs()).toBe(201);
  const newer = (await newerDraft.json()) as { id: string };
  expect(
    (await request(`${agreementPath}/${newer.id}/activate`, 'POST', undefined, staffHeaders)).status
  ).toBe(201);
  expect(await (await request(detailPath, 'GET')).json()).toMatchObject({
    agreement_snapshot: 'Accepted terms\nOriginal body.',
    agreement_updated: true,
  });
  await http.pool.query('UPDATE saving_orders SET agreement_snapshot=$2 WHERE id=$1', [
    savingOrderId,
    'Original body.',
  ]);
  expect(await (await request(detailPath, 'GET')).json()).toMatchObject({
    agreement_snapshot: 'Accepted terms\nOriginal body.',
    agreement_updated: true,
  });
});

it('revises an unpaid order address and equipment with one invoice, a new contract version, and moved stock', async () => {
  const secondAddress = (
    await http.pool.query<{ id: string }>(
      `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
       SELECT profile_id,province_id,city_id,'Second installation address','9876543210',false
       FROM addresses WHERE id=$1 RETURNING id`,
      [input.installationAddressId]
    )
  ).rows[0]!.id;
  const firstHardwareResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه اولیه', en: 'Initial device' },
      description: { fa: 'تجهیز اولیه', en: 'Initial equipment' },
      price: '200000',
      status: 'active',
    },
    staffHeaders
  );
  expect(firstHardwareResponse.status, http.logs()).toBe(201);
  const firstHardwareId = ((await firstHardwareResponse.json()) as { id: string }).id;
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${firstHardwareId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  const alternateResponse = await request(
    '/api/admin/catalogue/products',
    'POST',
    {
      type: 'hardware',
      title: { fa: 'دستگاه دوم', en: 'Second device' },
      description: { fa: 'تجهیز دوم', en: 'Second equipment' },
      price: '300000',
      status: 'active',
    },
    staffHeaders
  );
  expect(alternateResponse.status, http.logs()).toBe(201);
  const alternateId = ((await alternateResponse.json()) as { id: string }).id;
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${alternateId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
        staffHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  await http.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
    input.savingPlanId,
    alternateId,
  ]);
  await http.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
    input.savingPlanId,
    firstHardwareId,
  ]);
  const orderInput = {
    ...input,
    hardwareProductId: firstHardwareId,
    billIdentifier: '1234567890991',
    giftCode: 'SAVING30',
  };
  const initialQuote = await request('/api/saving/orders/quote', 'POST', orderInput);
  expect(initialQuote.status, http.logs()).toBe(201);
  const initialTerms = (await initialQuote.json()) as { reviewDigest: string; totalIrR: string };
  const submitted = await request('/api/saving/orders', 'POST', {
    ...orderInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: initialTerms.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(submitted.status, http.logs()).toBe(201);
  const order = (await submitted.json()) as {
    savingOrderId: string;
    invoiceId: string;
    contractId: string;
  };
  await http.pool.query("UPDATE gift_codes SET status='inactive' WHERE code='SAVING30'");
  const path = `/api/saving/orders/${order.savingOrderId}`;
  const detailBefore = await request(path, 'GET');
  expect(await detailBefore.json()).toMatchObject({ can_edit: true });
  const addressChange = {
    hardwareProductId: firstHardwareId,
    installationAddressId: secondAddress,
  };
  for (const [route, body] of [
    [`${path}/change-quote`, addressChange],
    [
      `${path}/change`,
      { ...addressChange, idempotencyKey: randomUUID(), expectedQuoteDigest: 'a'.repeat(64) },
    ],
  ] as const) {
    for (const [invalid, fields] of [
      [{ ...body, hardwareProductId: 'PRIVATE' }, ['hardwareProductId']],
      [{ ...body, installationAddressId: '' }, ['installationAddressId']],
      [
        { ...body, hardwareProductId: null, installationAddressId: '' },
        ['hardwareProductId', 'installationAddressId'],
      ],
    ] as const)
      await rejectedSavingChange(order.savingOrderId, route, invalid, customerHeaders, [...fields]);
    for (const invalid of [
      { ...body, hardwareProductId: '', expectedQuoteDigest: 'PRIVATE' },
      { ...body, installationAddressId: '', idempotencyKey: 'PRIVATE' },
      { ...body, hardwareProductId: '', extra: 'PRIVATE' },
      null,
    ])
      await rejectedSavingChange(order.savingOrderId, route, invalid, customerHeaders);
    await rejectedSavingChange(
      order.savingOrderId,
      route,
      { ...body, hardwareProductId: '' },
      staffHeaders,
      undefined,
      403
    );
    await rejectedSavingChange(
      order.savingOrderId,
      route,
      { ...body, hardwareProductId: '' },
      changeOutsiderHeaders,
      undefined,
      404
    );
    await rejectedSavingChange(
      order.savingOrderId,
      route.replace(order.savingOrderId, randomUUID()),
      { ...body, hardwareProductId: '' },
      customerHeaders,
      undefined,
      404
    );
  }
  // Feedback probes consume a separate disposable-fixture request budget.
  // Keep the unchanged revision/payment journey within its real ten-request limit.
  await http.pool.query("SELECT rate_limit_rolling_reset(false,'saving:change:user:127.0.0.1')");
  const addressQuoteResponse = await request(`${path}/change-quote`, 'POST', addressChange);
  expect(addressQuoteResponse.status, http.logs()).toBe(201);
  const addressQuote = (await addressQuoteResponse.json()) as {
    reviewDigest: string;
    totalIrR: string;
    discountIrR: string;
  };
  expect(addressQuote).toMatchObject({ totalIrR: '278100', discountIrR: '30000' });
  const stale = await request(`${path}/change`, 'POST', {
    ...addressChange,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: '0'.repeat(64),
  });
  expect(stale.status, http.logs()).toBe(409);
  const addressSubmission = {
    ...addressChange,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: addressQuote.reviewDigest,
  };
  const addressResult = await request(`${path}/change`, 'POST', addressSubmission);
  expect(addressResult.status, http.logs()).toBe(201);
  await expectSavingStatusDeliveries(http.pool, order.savingOrderId, 'saving-order-buyer', []);
  const firstRevision = (await addressResult.json()) as { contractVersionId: string };
  const priorVersionId = (
    await http.pool.query<{ previous_version_id: string }>(
      'SELECT previous_version_id FROM saving_order_revisions WHERE order_id=$1 AND idempotency_key=$2',
      [order.savingOrderId, addressSubmission.idempotencyKey]
    )
  ).rows[0]!.previous_version_id;
  expect(firstRevision).toEqual({
    savingOrderId: order.savingOrderId,
    contractVersionId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    invoiceId: order.invoiceId,
    ...addressQuote,
  });
  expect(firstRevision.contractVersionId).not.toBe(priorVersionId);
  await expectCoreAudit(http.pool, 'saving.order.changed', order.savingOrderId, {
    entity: 'saving_order',
    fromState: 'awaiting_staff_review',
    toState: 'awaiting_staff_review',
    reason: null,
    actor: 'saving-order-buyer',
    context: 'customer',
  });

  const beforeRevisionReplay = await savingChangeSnapshot(order.savingOrderId);
  const retry = await request(`${path}/change`, 'POST', addressSubmission);
  expect(retry.status, http.logs()).toBe(201);
  expect(await retry.json()).toEqual(firstRevision);
  expect(await savingChangeSnapshot(order.savingOrderId)).toEqual(beforeRevisionReplay);
  const equipmentChange = { hardwareProductId: alternateId, installationAddressId: secondAddress };
  const equipmentQuoteResponse = await request(`${path}/change-quote`, 'POST', equipmentChange);
  expect(equipmentQuoteResponse.status, http.logs()).toBe(201);
  const equipmentQuote = (await equipmentQuoteResponse.json()) as {
    reviewDigest: string;
    totalIrR: string;
    discountIrR: string;
  };
  expect(equipmentQuote).toMatchObject({ totalIrR: '378325', discountIrR: '30000' });
  const equipmentResult = await request(`${path}/change`, 'POST', {
    ...equipmentChange,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: equipmentQuote.reviewDigest,
  });
  expect(equipmentResult.status, http.logs()).toBe(201);
  const persisted = await http.pool.query<{
    hardware_product_id: string;
    installation_address_id: string;
    total_amount: string;
    versions: string;
    revisions: string;
    invoices: string;
    old_reserved: number;
    new_reserved: number;
  }>(
    `SELECT s.hardware_product_id,s.installation_address_id,i.total_amount::text,
      (SELECT COUNT(*)::text FROM contract_versions WHERE contract_id=$2) AS versions,
      (SELECT COUNT(*)::text FROM saving_order_revisions WHERE order_id=s.id) AS revisions,
      (SELECT COUNT(*)::text FROM invoices WHERE order_id=s.order_id) AS invoices,
      (SELECT reserved_count FROM products WHERE id=$3) AS old_reserved,
      (SELECT reserved_count FROM products WHERE id=$4) AS new_reserved
     FROM saving_orders s JOIN invoices i ON i.order_id=s.order_id WHERE s.id=$1`,
    [order.savingOrderId, order.contractId, firstHardwareId, alternateId]
  );
  expect(persisted.rows[0]).toMatchObject({
    hardware_product_id: alternateId,
    installation_address_id: secondAddress,
    total_amount: '378325',
    versions: '3',
    revisions: '2',
    invoices: '1',
    old_reserved: 0,
    new_reserved: 1,
  });
  expect(
    (
      await http.pool.query(
        "SELECT content->'commercialValue'->>'amountIrr' AS amount FROM contract_versions WHERE contract_id=$1 ORDER BY version_number",
        [order.contractId]
      )
    ).rows.map((row) => row.amount)
  ).toEqual([initialTerms.totalIrR, addressQuote.totalIrR, equipmentQuote.totalIrR]);
  await expect(
    http.pool.query("UPDATE saving_order_revisions SET request_hash='tampered' WHERE order_id=$1", [
      order.savingOrderId,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  const detailAfter = await request(path, 'GET');
  expect(await detailAfter.json()).toMatchObject({
    can_edit: true,
    invoice_id: order.invoiceId,
    pricing_snapshot: { totalIrR: '378325', discountIrR: '30000' },
    address_snapshot: { full_address: 'Second installation address' },
    revisions: [
      {
        previousAddress: 'Test installation address',
        address: 'Second installation address',
        previousTotalIrR: '278100',
        totalIrR: '278100',
      },
      {
        previousHardwareTitle: { en: 'Initial device' },
        hardwareTitle: { en: 'Second device' },
        previousTotalIrR: '278100',
        totalIrR: '378325',
      },
    ],
  });
  const staffDetail = await request(
    `/api/staff/saving/orders/${order.savingOrderId}`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(staffDetail.status, http.logs()).toBe(200);
  const staffOrder = (await staffDetail.json()) as {
    versionId: string;
    revisions: Array<Record<string, unknown>>;
  };
  expect(staffOrder.revisions).toHaveLength(2);
  expect(staffOrder.revisions[1]).toMatchObject({
    previousHardwareTitle: { en: 'Initial device' },
    hardwareTitle: { en: 'Second device' },
  });
  expect(staffOrder.revisions[0]).not.toHaveProperty('request_hash');
  const currentVersion = staffOrder.versionId;
  const currentReview = await decisionReview(order.savingOrderId, 'approve');
  const approval = await request(
    `/api/staff/saving/orders/${order.savingOrderId}/approve`,
    'POST',
    {
      idempotencyKey: randomUUID(),
      expectedVersionId: currentVersion,
      expectedReviewHash: currentReview.hash,
    },
    staffHeaders
  );
  expect(approval.status, http.logs()).toBe(200);
  const acceptancePreview = await request(
    `/api/contracts/${order.contractId}/acceptance-review?versionId=${currentVersion}`,
    'GET'
  );
  expect(acceptancePreview.status, http.logs()).toBe(200);
  const acceptanceHash = ((await acceptancePreview.json()) as { hash: string }).hash;
  const accepted = await request(`/api/contracts/${order.contractId}/accept`, 'POST', {
    idempotencyKey: randomUUID(),
    expectedVersionId: currentVersion,
    expectedReviewHash: acceptanceHash,
  });
  expect(accepted.status, http.logs()).toBe(200);
  expect(await (await request(path, 'GET')).json()).toMatchObject({ can_edit: true });
  const approvedQuoteResponse = await request(`${path}/change-quote`, 'POST', {
    hardwareProductId: alternateId,
    installationAddressId: input.installationAddressId,
  });
  expect(approvedQuoteResponse.status, http.logs()).toBe(201);
  const approvedQuote = (await approvedQuoteResponse.json()) as { reviewDigest: string };
  const revisionStagesBefore = (
    await http.pool.query<{ id: string; stage: string; status: string }>(
      "SELECT id,stage,status FROM saving_fulfillment_stages WHERE order_id=$1 AND stage IN ('request_confirmation','product_delivery') ORDER BY id",
      [order.savingOrderId]
    )
  ).rows;
  await expectSavingStageWriteRollback(order.savingOrderId, 'request_confirmation', () =>
    request(`${path}/change`, 'POST', {
      hardwareProductId: alternateId,
      installationAddressId: input.installationAddressId,
      idempotencyKey: randomUUID(),
      expectedQuoteDigest: approvedQuote.reviewDigest,
    })
  );
  await expectSavingRevisionStageAuditRollback(order.savingOrderId, () =>
    request(`${path}/change`, 'POST', {
      hardwareProductId: alternateId,
      installationAddressId: input.installationAddressId,
      idempotencyKey: randomUUID(),
      expectedQuoteDigest: approvedQuote.reviewDigest,
    })
  );

  const reopened = await request(`${path}/change`, 'POST', {
    hardwareProductId: alternateId,
    installationAddressId: input.installationAddressId,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: approvedQuote.reviewDigest,
  });
  expect(reopened.status, http.logs()).toBe(201);
  await expectSavingStatusDeliveries(http.pool, order.savingOrderId, 'saving-order-buyer', [
    'approved',
    'awaiting_staff_review',
  ]);
  await expectSavingStageResetAudits(
    order.savingOrderId,
    revisionStagesBefore,
    ((await reopened.clone().json()) as { contractVersionId: string }).contractVersionId,
    currentVersion
  );

  expect(await (await request(path, 'GET')).json()).toMatchObject({
    can_edit: true,
    status: 'awaiting_staff_review',
  });
  expect(
    (
      await http.pool.query<{
        status: string;
        stock_count: number;
        reserved_count: number;
      }>(
        `SELECT r.status,p.stock_count,p.reserved_count
         FROM saving_inventory_reservations r JOIN products p ON p.id=r.hardware_product_id
         WHERE r.order_id=$1`,
        [order.savingOrderId]
      )
    ).rows[0]
  ).toMatchObject({ status: 'allocated', stock_count: 1, reserved_count: 0 });
  const secondApprovedQuoteResponse = await request(`${path}/change-quote`, 'POST', {
    hardwareProductId: firstHardwareId,
    installationAddressId: secondAddress,
  });
  expect(secondApprovedQuoteResponse.status, http.logs()).toBe(201);
  const secondApprovedQuote = (await secondApprovedQuoteResponse.json()) as {
    reviewDigest: string;
  };
  const secondReopened = await request(`${path}/change`, 'POST', {
    hardwareProductId: firstHardwareId,
    installationAddressId: secondAddress,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: secondApprovedQuote.reviewDigest,
  });
  expect(secondReopened.status, http.logs()).toBe(201);
  await expectSavingStatusDeliveries(http.pool, order.savingOrderId, 'saving-order-buyer', [
    'approved',
    'awaiting_staff_review',
  ]);
  const reopenedVersion = ((await secondReopened.json()) as { contractVersionId: string })
    .contractVersionId;
  expect(await (await request(path, 'GET')).json()).toMatchObject({
    can_edit: true,
    status: 'awaiting_staff_review',
    invoice_id: order.invoiceId,
    contract_version_id: reopenedVersion,
    pricing_snapshot: { totalIrR: '278100' },
  });
  const reopenedState = await http.pool.query<{
    status: string;
    contract_state: string;
    accepted_at: Date | null;
    invoice_total: string;
    publications: string;
    first_reserved: number;
    alternate_stock: number;
    alternate_reserved: number;
  }>(
    `SELECT o.status,c.state AS contract_state,c.accepted_at,i.total_amount::text AS invoice_total,
      (SELECT COUNT(*)::text FROM contract_publications WHERE contract_id=c.id) AS publications,
      (SELECT reserved_count FROM products WHERE id=$2) AS first_reserved,
      (SELECT stock_count FROM products WHERE id=$3) AS alternate_stock,
      (SELECT reserved_count FROM products WHERE id=$3) AS alternate_reserved
     FROM saving_orders s JOIN orders o ON o.id=s.order_id
     JOIN contracts c ON c.order_id=o.id JOIN invoices i ON i.order_id=o.id
     WHERE s.id=$1`,
    [order.savingOrderId, firstHardwareId, alternateId]
  );
  expect(reopenedState.rows[0]).toMatchObject({
    status: 'PENDING',
    contract_state: 'AwaitingStaffReview',
    accepted_at: null,
    invoice_total: '278100',
    publications: '1',
    first_reserved: 1,
    alternate_stock: 2,
    alternate_reserved: 0,
  });
  const reapproval = await request(
    `/api/staff/saving/orders/${order.savingOrderId}/approve`,
    'POST',
    {
      idempotencyKey: randomUUID(),
      expectedVersionId: reopenedVersion,
      expectedReviewHash: (await decisionReview(order.savingOrderId, 'approve')).hash,
    },
    staffHeaders
  );
  expect(reapproval.status, http.logs()).toBe(200);
  await expectSavingStatusDeliveries(http.pool, order.savingOrderId, 'saving-order-buyer', [
    'approved',
    'awaiting_staff_review',
    'approved',
  ]);
  await expectSavingInventoryHistory(order.savingOrderId);
  expect(await (await request(path, 'GET')).json()).toMatchObject({ can_edit: true });
  expect(
    (
      await http.pool.query<{
        state: string;
        accepted_at: Date | null;
        publications: string;
        current_acceptances: string;
        historical_acceptances: string;
      }>(
        `SELECT c.state,c.accepted_at,
          (SELECT COUNT(*)::text FROM contract_publications WHERE contract_id=c.id) AS publications,
          (SELECT COUNT(*)::text FROM contract_acceptances
            WHERE version_id=c.current_version_id) AS current_acceptances,
          (SELECT COUNT(*)::text FROM contract_acceptances
            WHERE contract_id=c.id) AS historical_acceptances
         FROM contracts c WHERE c.id=$1`,
        [order.contractId]
      )
    ).rows[0]
  ).toMatchObject({
    state: 'AwaitingCustomerAcceptance',
    accepted_at: null,
    publications: '2',
    current_acceptances: '0',
    historical_acceptances: '1',
  });
  await http.pool.query(
    `INSERT INTO bank_receipts(invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key)
     VALUES($1,$2,10,'2026-09-23','saving-change-payment',$3)`,
    [order.invoiceId, input.profileId, randomUUID()]
  );
  expect(await (await request(path, 'GET')).json()).toMatchObject({ can_edit: false });
  expect((await request(`${path}/change-quote`, 'POST', addressChange)).status).toBe(409);
}, 60000);

it('credits a cheaper paid hardware swap and preserves the revised price basis for another swap', async () => {
  await http.pool.query("DELETE FROM rate_limit_windows WHERE key LIKE 'saving:submit:user:%'");
  const createHardware = async (englishTitle: string) => {
    const created = await request(
      '/api/admin/catalogue/products',
      'POST',
      {
        type: 'hardware',
        title: { fa: englishTitle, en: englishTitle },
        description: { fa: 'تجهیز', en: 'Equipment' },
        price: '150000',
        status: 'active',
      },
      staffHeaders
    );
    expect(created.status, http.logs()).toBe(201);
    const id = ((await created.json()) as { id: string }).id;
    await http.pool.query('INSERT INTO saving_plan_hardware(plan_id,hardware_id) VALUES($1,$2)', [
      input.savingPlanId,
      id,
    ]);
    expect(
      (
        await request(
          `/api/admin/catalogue/hardware/${id}/inventory`,
          'PUT',
          { stockTracking: true, stockCount: 2, reservationMinutes: 30 },
          staffHeaders
        )
      ).status
    ).toBe(200);
    return id;
  };
  const cheaperId = await createHardware('Cheaper device');
  const twinId = await createHardware('Equivalent cheaper device');
  expect(
    (
      await request(
        `/api/admin/catalogue/hardware/${input.hardwareProductId}/inventory`,
        'PUT',
        { stockTracking: true, stockCount: 5, reservationMinutes: 30 },
        staffHeaders
      )
    ).status
  ).toBe(200);
  const orderInput = { ...input, billIdentifier: '1234567890139' };
  const quoteResponse = await request('/api/saving/orders/quote', 'POST', orderInput);
  expect(quoteResponse.status, http.logs()).toBe(201);
  const quote = (await quoteResponse.json()) as { reviewDigest: string; totalIrR: string };
  const submitted = await request('/api/saving/orders', 'POST', {
    ...orderInput,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(submitted.status, http.logs()).toBe(201);
  const order = (await submitted.json()) as {
    savingOrderId: string;
    invoiceId: string;
    contractId: string;
  };
  const staffPath = `/api/staff/saving/orders/${order.savingOrderId}`;
  const versionId = (
    (await (await request(staffPath, 'GET', undefined, staffHeaders)).json()) as {
      versionId: string;
    }
  ).versionId;
  expect(
    (
      await request(
        `${staffPath}/approve`,
        'POST',
        {
          idempotencyKey: randomUUID(),
          expectedVersionId: versionId,
          expectedReviewHash: (await decisionReview(order.savingOrderId, 'approve')).hash,
        },
        staffHeaders
      )
    ).status
  ).toBe(200);
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance)
     VALUES($1,1000000,0) ON CONFLICT(profile_id)
     DO UPDATE SET posted_balance=1000000,reserved_balance=0`,
    [input.profileId]
  );
  const walletPath = `/api/invoices/${order.invoiceId}/wallet-payment`;
  const review = await request(walletPath, 'GET');
  expect(review.status, http.logs()).toBe(200);
  const walletHash = ((await review.json()) as { review: { hash: string } }).review.hash;
  expect(
    (
      await request(walletPath, 'POST', {
        idempotencyKey: randomUUID(),
        expectedRemainingAmount: quote.totalIrR,
        expectedReviewHash: walletHash,
      })
    ).status,
    http.logs()
  ).toBe(200);
  const before = (
    await http.pool.query<{
      invoice_snapshot: string;
      contract_content: string;
      pricing_snapshot: string;
      old_stock: number;
    }>(
      `SELECT i.invoice_calculation_snapshot::text AS invoice_snapshot,
        v.content::text AS contract_content,s.pricing_snapshot::text AS pricing_snapshot,
        p.stock_count AS old_stock
       FROM saving_orders s JOIN invoices i ON i.order_id=s.order_id AND i.type='auto'
       JOIN contracts c ON c.order_id=s.order_id
       JOIN contract_versions v ON v.id=c.current_version_id
       JOIN products p ON p.id=s.hardware_product_id WHERE s.id=$1`,
      [order.savingOrderId]
    )
  ).rows[0]!;
  const stalePreview = await request(
    `/api/admin/contracts/${order.contractId}/cancellation-preview`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(stalePreview.status, http.logs()).toBe(200);
  const staleFingerprint = ((await stalePreview.json()) as { fingerprint: string }).fingerprint;
  const stalePrepare = await request(
    `/api/admin/contracts/${order.contractId}/cancellations`,
    'POST',
    {
      expectedVersionId: versionId,
      expectedFingerprint: staleFingerprint,
      reason: 'Prepared before the device credit',
      refundDecision: { mode: 'full_wallet' },
      idempotencyKey: randomUUID(),
    },
    staffHeaders
  );
  expect(stalePrepare.status, http.logs()).toBe(201);
  const staleIntentId = ((await stalePrepare.json()) as { id: string }).id;
  const staffDetail = (await (await request(staffPath, 'GET', undefined, staffHeaders)).json()) as {
    hardwareOptions: Array<{ id: string; priceDeltaIrR: string }>;
  };
  const cheaperOption = staffDetail.hardwareOptions.find((option) => option.id === cheaperId);
  expect(cheaperOption).toBeDefined();
  expect(BigInt(cheaperOption!.priceDeltaIrR) < 0n).toBe(true);
  const amendPath = `${staffPath}/amend-hardware`;
  const creditInput = {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
    expectedHardwareId: input.hardwareProductId,
    hardwareProductId: cheaperId,
    reason: 'Customer accepted a lower-priced device',
    expectedReviewHash: '',
  };
  const creditReview = await hardwareAmendmentReview(order.savingOrderId, creditInput);
  expect(creditReview.data).toMatchObject({
    outcome: 'credit_note',
    priceDeltaIrR: cheaperOption!.priceDeltaIrR,
  });
  creditInput.expectedReviewHash = creditReview.hash;
  const credited = await request(amendPath, 'POST', creditInput, staffHeaders);
  expect(credited.status, http.logs()).toBe(201);
  const result = (await credited.json()) as {
    amendmentId: string;
    adjustmentInvoiceId: string;
    priceDeltaIrR: string;
  };
  expect(result.adjustmentInvoiceId).toBeTruthy();
  expect(result.priceDeltaIrR).toBe(cheaperOption!.priceDeltaIrR);
  expect(await (await request(amendPath, 'POST', creditInput, staffHeaders)).json()).toEqual(
    result
  );
  expect(
    (
      await http.pool.query<{
        state: string;
        adjustment_kind: string;
        payable_from: Date | null;
        accounting_amount: string;
      }>(
        `SELECT state,adjustment_kind,payable_from,accounting_amount::text
         FROM invoices WHERE id=$1`,
        [result.adjustmentInvoiceId]
      )
    ).rows[0]
  ).toMatchObject({
    state: 'Unpaid',
    adjustment_kind: 'credit',
    payable_from: null,
    accounting_amount: result.priceDeltaIrR,
  });
  expect(
    (
      await http.pool.query<{ status: string; hardware_product_id: string }>(
        'SELECT status,hardware_product_id FROM saving_inventory_reservations WHERE order_id=$1',
        [order.savingOrderId]
      )
    ).rows[0]
  ).toMatchObject({ status: 'allocated', hardware_product_id: cheaperId });
  const after = (
    await http.pool.query<typeof before>(
      `SELECT i.invoice_calculation_snapshot::text AS invoice_snapshot,
        v.content::text AS contract_content,s.pricing_snapshot::text AS pricing_snapshot,
        p.stock_count AS old_stock
       FROM saving_orders s JOIN invoices i ON i.order_id=s.order_id AND i.type='auto'
       JOIN contracts c ON c.order_id=s.order_id
       JOIN contract_versions v ON v.id=c.current_version_id
       JOIN products p ON p.id=$2 WHERE s.id=$1`,
      [order.savingOrderId, input.hardwareProductId]
    )
  ).rows[0]!;
  expect(after).toMatchObject({
    invoice_snapshot: before.invoice_snapshot,
    contract_content: before.contract_content,
    pricing_snapshot: before.pricing_snapshot,
    old_stock: before.old_stock + 1,
  });
  expect(
    await (await request(`/api/saving/orders/${order.savingOrderId}`, 'GET')).json()
  ).toMatchObject({
    hardware_product_id: cheaperId,
    current_hardware_title: { en: 'Cheaper device' },
    hardwareAmendments: [
      {
        id: result.amendmentId,
        priceDeltaIrR: result.priceDeltaIrR,
        adjustmentInvoiceId: result.adjustmentInvoiceId,
      },
    ],
  });
  expect(
    (
      await request(
        `/api/admin/contracts/${order.contractId}/cancellations/execute`,
        'POST',
        { intentId: staleIntentId, idempotencyKey: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(409);
  const zeroSwapInput = {
    idempotencyKey: randomUUID(),
    expectedVersionId: versionId,
    expectedHardwareId: cheaperId,
    hardwareProductId: twinId,
    reason: 'The equivalent device is available sooner',
  };
  const zeroSwap = await request(
    amendPath,
    'POST',
    {
      ...zeroSwapInput,
      expectedReviewHash: (await hardwareAmendmentReview(order.savingOrderId, zeroSwapInput)).hash,
    },
    staffHeaders
  );
  expect(zeroSwap.status, http.logs()).toBe(201);
  expect(await zeroSwap.json()).toMatchObject({ priceDeltaIrR: '0', adjustmentInvoiceId: null });
  expect(
    (
      await http.pool.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM invoices WHERE order_id=(SELECT order_id FROM saving_orders WHERE id=$1)',
        [order.savingOrderId]
      )
    ).rows[0]?.count
  ).toBe('2');
  const previewResponse = await request(
    `/api/admin/contracts/${order.contractId}/cancellation-preview`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(previewResponse.status, http.logs()).toBe(200);
  const preview = (await previewResponse.json()) as { fingerprint: string };
  const prepared = await request(
    `/api/admin/contracts/${order.contractId}/cancellations`,
    'POST',
    {
      expectedVersionId: versionId,
      expectedFingerprint: preview.fingerprint,
      reason: 'Customer cancelled after the device credit',
      refundDecision: { mode: 'full_wallet' },
      idempotencyKey: randomUUID(),
    },
    staffHeaders
  );
  expect(prepared.status, http.logs()).toBe(201);
  const intentId = ((await prepared.json()) as { id: string }).id;
  const cancelled = await request(
    `/api/admin/contracts/${order.contractId}/cancellations/execute`,
    'POST',
    { intentId, idempotencyKey: randomUUID() },
    staffHeaders
  );
  expect(cancelled.status, http.logs()).toBe(201);
  expect(await cancelled.json()).toMatchObject({ refunds: [{ amount: quote.totalIrR }] });
  expect(
    (await http.pool.query('SELECT state FROM invoices WHERE id=$1', [result.adjustmentInvoiceId]))
      .rows[0]?.state
  ).toBe('Cancelled');
}, 60000);

it('lets staff change the duplicate rule while requiring customer acknowledgement', async () => {
  // This scenario needs two units regardless of which earlier scenarios were selected.
  const reserved = (
    await http.pool.query<{ reserved_count: number }>(
      'SELECT reserved_count FROM products WHERE id=$1',
      [input.hardwareProductId]
    )
  ).rows[0]!.reserved_count;
  const inventory = await request(
    `/api/admin/catalogue/hardware/${input.hardwareProductId}/inventory`,
    'PUT',
    { stockTracking: true, stockCount: reserved + 2, reservationMinutes: 30 },
    staffHeaders
  );
  expect(inventory.status, http.logs()).toBe(200);
  const policyPath = `/api/admin/catalogue/saving-plans/${input.savingPlanId}/duplicate-policy`;
  const configurationPath = `/api/admin/catalogue/saving-plans/${input.savingPlanId}/configuration`;
  expect((await request(policyPath, 'PUT', { preventActiveDuplicates: false })).status).toBe(403);
  expect(
    (await request(policyPath, 'PUT', { preventActiveDuplicates: 'false' }, staffHeaders)).status
  ).toBe(400);
  const changed = await request(
    policyPath,
    'PUT',
    { preventActiveDuplicates: false },
    staffHeaders
  );
  expect(changed.status, http.logs()).toBe(200);
  expect(await changed.json()).toEqual({ preventActiveDuplicates: false });
  expect(
    await (await request(configurationPath, 'GET', undefined, staffHeaders)).json()
  ).toMatchObject({
    preventActiveDuplicates: false,
  });

  const orderInput = { ...input, billIdentifier: '1234567890555' };
  const quote = await request('/api/saving/orders/quote', 'POST', orderInput);
  expect(quote.status, http.logs()).toBe(201);
  const reviewDigest = ((await quote.json()) as { reviewDigest: string }).reviewDigest;
  const submission = {
    ...orderInput,
    expectedQuoteDigest: reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  };
  const first = await request('/api/saving/orders', 'POST', {
    ...submission,
    idempotencyKey: randomUUID(),
  });
  expect(first.status, http.logs()).toBe(201);
  const duplicate = await request('/api/saving/orders/duplicate', 'POST', {
    profileId: input.profileId,
    savingPlanId: input.savingPlanId,
    billIdentifier: orderInput.billIdentifier,
  });
  expect(await duplicate.json()).toMatchObject({ duplicate: true, preventActiveDuplicates: false });
  const unacknowledged = await request('/api/saving/orders', 'POST', {
    ...submission,
    idempotencyKey: randomUUID(),
  });
  expect(unacknowledged.status, http.logs()).toBe(409);
  const second = await request('/api/saving/orders', 'POST', {
    ...submission,
    duplicateAcknowledged: true,
    idempotencyKey: randomUUID(),
  });
  expect(second.status, http.logs()).toBe(201);
  expect(
    (
      await http.pool.query(
        `SELECT COUNT(*)::int AS count FROM saving_orders
       WHERE saving_plan_id=$1 AND bill_identifier=$2 AND status='awaiting_staff_review'`,
        [input.savingPlanId, orderInput.billIdentifier]
      )
    ).rows[0]?.count
  ).toBe(2);
  expect(
    (await request(policyPath, 'PUT', { preventActiveDuplicates: true }, staffHeaders)).status
  ).toBe(200);
  const third = await request('/api/saving/orders', 'POST', {
    ...submission,
    duplicateAcknowledged: true,
    idempotencyKey: randomUUID(),
  });
  expect(third.status, http.logs()).toBe(409);
  expect(
    (
      await http.pool.query(
        "SELECT COUNT(*)::int AS count FROM audit_log WHERE event='saving_plan_duplicate_policy_changed'"
      )
    ).rows[0]?.count
  ).toBe(2);
}, 60000);

it('limits gift-code guesses across saving and electricity quotes without blocking ordinary quotes', async () => {
  await http.pool.query(
    "DELETE FROM rate_limit_windows WHERE key IN ('gift-code:validate:user:saving-order-buyer','saving:quote:user:saving-order-buyer')"
  );
  for (let index = 0; index < 12; index++) {
    const guessed = await request('/api/saving/orders/quote', 'POST', {
      ...input,
      giftCode: `INVALID-${index}`,
    });
    expect(guessed.status, http.logs()).toBe(400);
  }
  const blocked = await request('/api/electricity/preview/simple', 'POST', {
    profileId: legalProfileId,
    period: 'next_week',
    totalKwh: '10',
    giftCode: 'INVALID-NEXT',
  });
  expect(blocked.status, http.logs()).toBe(429);
  expect(await blocked.json()).toMatchObject({ error: { code: 'RATE_LIMIT:EXCEEDED' } });
  const ordinary = await request('/api/saving/orders/quote', 'POST', input);
  expect(ordinary.status, http.logs()).toBe(201);
}, 60000);

it('binds specified saving cancellation routes to customer requests, approved decisions and completed partial returns', async () => {
  const reserved = (
    await http.pool.query<{ reserved_count: number }>(
      'SELECT reserved_count FROM products WHERE id=$1',
      [input.hardwareProductId]
    )
  ).rows[0]!.reserved_count;
  const stock = await request(
    `/api/admin/catalogue/hardware/${input.hardwareProductId}/inventory`,
    'PUT',
    { stockTracking: true, stockCount: reserved + 1, reservationMinutes: 30 },
    staffHeaders
  );
  expect(stock.status, http.logs()).toBe(200);
  const agreement = (
    await http.pool.query<{ id: string }>(
      "SELECT id FROM saving_plan_agreement_versions WHERE plan_id=$1 AND status='active'",
      [input.savingPlanId]
    )
  ).rows[0]!.id;
  const body = { ...input, agreementVersionId: agreement, billIdentifier: '1234567890992' };
  const quoteResponse = await request('/api/saving/orders/quote', 'POST', body);
  expect(quoteResponse.status, http.logs()).toBe(201);
  const quote = (await quoteResponse.json()) as { reviewDigest: string; totalIrR: string };
  const submitted = await request('/api/saving/orders', 'POST', {
    ...body,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: quote.reviewDigest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(submitted.status, await submitted.clone().text()).toBe(201);
  const order = (await submitted.json()) as {
    savingOrderId: string;
    contractId: string;
    invoiceId: string;
    orderId: string;
  };
  const detail = (await (
    await request(`/api/saving/orders/${order.savingOrderId}`, 'GET')
  ).json()) as { contract_version_id: string };
  const base = `/api/staff/saving/orders/${order.savingOrderId}`;
  const requestPath = `/api/contracts/${order.contractId}/cancellation-requests`;
  const submitRequest = async () => {
    const response = await request(requestPath, 'POST', {
      expectedVersionId: detail.contract_version_id,
      reason: 'Please cancel the device installation',
      preferredDestination: 'wallet',
      idempotencyKey: randomUUID(),
    });
    expect(response.status, http.logs()).toBe(201);
    return (await response.json()) as { id: string };
  };
  const first = await submitRequest();
  await expectCancellationRequestDelivery(
    http.pool,
    order.contractId,
    first.id,
    'saving-order-buyer',
    order.savingOrderId,
    `/savings/orders/${order.savingOrderId}`
  );
  const rejection = {
    requestId: first.id,
    reason: 'Confirm the installation address first',
    idempotencyKey: randomUUID(),
  };
  const beforeReject = await savingOperationsSnapshot(order.savingOrderId);
  expect((await request(base + '/reject-cancellation', 'POST', rejection)).status).toBe(403);
  expect(
    (
      await request(
        base + '/reject-cancellation',
        'POST',
        { ...rejection, requestId: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(404);
  expect(await savingOperationsSnapshot(order.savingOrderId)).toEqual(beforeReject);
  const rejected = await request(base + '/reject-cancellation', 'POST', rejection, staffHeaders);
  expect(rejected.status, http.logs()).toBe(201);
  expect(await rejected.json()).toMatchObject({ status: 'Rejected' });
  expect(
    (await http.pool.query('SELECT state FROM contracts WHERE id=$1', [order.contractId])).rows[0]
      .state
  ).toBe('AwaitingStaffReview');
  const afterRejected = await savingOperationsSnapshot(order.savingOrderId);
  expect(
    (await request(base + '/reject-cancellation', 'POST', rejection, staffHeaders)).status
  ).toBe(201);
  expect(await savingOperationsSnapshot(order.savingOrderId)).toEqual(afterRejected);
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES($1,1000000,0)
    ON CONFLICT(profile_id) DO UPDATE SET posted_balance=wallets.posted_balance+1000000`,
    [input.profileId]
  );
  const paymentPath = `/api/invoices/${order.invoiceId}/wallet-payment`;
  const paymentReview = (await (await request(paymentPath, 'GET')).json()) as {
    review: { hash: string };
  };
  expect(
    (
      await request(paymentPath, 'POST', {
        idempotencyKey: randomUUID(),
        expectedRemainingAmount: quote.totalIrR,
        expectedReviewHash: paymentReview.review.hash,
      })
    ).status,
    http.logs()
  ).toBe(200);
  const second = await submitRequest();
  const previewResponse = await request(
    `/api/admin/contracts/${order.contractId}/cancellation-preview`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(previewResponse.status, http.logs()).toBe(200);
  const preview = (await previewResponse.json()) as { fingerprint: string };
  const amount = (BigInt(quote.totalIrR) / 2n).toString();
  await http.pool
    .query(`INSERT INTO app_config(key,value) VALUES('finance.dual_approval_threshold','{"threshold_irr":1}')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`);
  const prepared = await request(
    `/api/admin/contracts/${order.contractId}/cancellations`,
    'POST',
    {
      expectedVersionId: detail.contract_version_id,
      expectedFingerprint: preview.fingerprint,
      reason: 'Return half of the paid price; retain the agreed installation fee',
      customerRequestId: second.id,
      refundDecision: {
        mode: 'custom',
        refunds: [{ invoiceId: order.invoiceId, amount, destination: 'wallet' }],
      },
      idempotencyKey: randomUUID(),
    },
    staffHeaders
  );
  expect(prepared.status, http.logs()).toBe(201);
  const intent = (await prepared.json()) as {
    id: string;
    approvalRequestId: string;
    status: string;
  };
  expect(intent.status).toBe('awaiting_approval');
  const command = { intentId: intent.id, idempotencyKey: randomUUID() };
  const beforeApproval = await savingSystemSnapshot(order.savingOrderId);
  expect((await request(base + '/approve-cancellation', 'POST', command)).status).toBe(403);
  expect(
    (
      await request(
        base + '/approve-cancellation',
        'POST',
        { ...command, intentId: randomUUID() },
        staffHeaders
      )
    ).status
  ).toBe(404);
  expect(
    (await request(base + '/approve-cancellation', 'POST', command, staffHeaders)).status
  ).toBe(409);
  expect(await savingSystemSnapshot(order.savingOrderId)).toEqual(beforeApproval);
  const reviewer = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test-only',true)",
    [reviewer]
  );
  await http.pool.query("INSERT INTO user_roles(user_id,role_id) VALUES($1,'role-finance')", [
    reviewer,
  ]);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, reviewer, csrf, randomUUID()]
  );
  const reviewerHeaders = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
  expect(
    (
      await request(
        `/api/admin/approval-requests/${intent.approvalRequestId}/approve`,
        'POST',
        {},
        reviewerHeaders
      )
    ).status,
    http.logs()
  ).toBe(200);
  const executed = await request(base + '/approve-cancellation', 'POST', command, staffHeaders);
  expect(executed.status, http.logs()).toBe(201);
  const receipt = (await executed.json()) as { refunds: Array<{ id: string; amount: string }> };
  expect(receipt.refunds).toMatchObject([{ amount }]);
  const after = await savingSystemSnapshot(order.savingOrderId);
  expect(
    (await request(base + '/approve-cancellation', 'POST', command, staffHeaders)).status
  ).toBe(201);
  expect(await savingSystemSnapshot(order.savingOrderId)).toEqual(after);
  expect(
    (
      await http.pool.query(
        `SELECT s.status,s.financial_status,c.state AS contract_state,o.status AS order_status
    FROM saving_orders s JOIN contracts c ON c.order_id=s.order_id JOIN orders o ON o.id=s.order_id WHERE s.id=$1`,
        [order.savingOrderId]
      )
    ).rows[0]
  ).toMatchObject({
    status: 'cancelled',
    financial_status: 'refund_pending',
    contract_state: 'Cancelled',
    order_status: 'CANCELLED',
  });
  expect(await runWalletRefund(http.pool, receipt.refunds[0]!.id)).toBe('completed');
  const closure = await request(
    `/api/admin/contracts/${order.contractId}/cancellation-status`,
    'GET',
    undefined,
    staffHeaders
  );
  expect(closure.status, http.logs()).toBe(200);
  expect(await closure.json()).toMatchObject({
    financiallyClosed: true,
    financialStatus: 'closed',
    returnedAmount: amount,
  });
  expect(
    (
      await http.pool.query('SELECT state,paid_amount,refunded_amount FROM invoices WHERE id=$1', [
        order.invoiceId,
      ])
    ).rows[0]
  ).toMatchObject({
    state: 'PartiallyRefunded',
    paid_amount: quote.totalIrR,
    refunded_amount: amount,
  });
  expect(
    (
      await http.pool.query('SELECT financial_status FROM saving_orders WHERE id=$1', [
        order.savingOrderId,
      ])
    ).rows[0].financial_status
  ).toBe('refunded');
  const financialHistory = async () => {
    const result = [];
    for (const [table, key] of [
      ['wallets', 'profile_id'],
      ['wallet_transactions', 'id'],
      ['invoices', 'id'],
      ['refunds', 'id'],
      ['refund_transactions', 'id'],
      ['contract_cancellations', 'contract_id'],
      ['contract_cancellation_intents', 'id'],
      ['contract_refund_obligations', 'refund_id'],
      ['audit_log', 'id'],
    ] as const)
      result.push(
        (await http.pool.query(`SELECT to_jsonb(row) AS value FROM ${table} row ORDER BY ${key}`))
          .rows
      );
    return result;
  };
  const historyBefore = await financialHistory();
  // Reproduce the stale derived flag left by the pre-upgrade partial-return mapping.
  await http.pool.query("UPDATE saving_orders SET financial_status='refund_pending' WHERE id=$1", [
    order.savingOrderId,
  ]);
  const migration = readFileSync(
    resolve(
      __dirname,
      '../../../../packages/db/drizzle/production/0260_saving_cancellation_financial_closure.sql'
    ),
    'utf8'
  );
  const backfill = migration.split('--> statement-breakpoint').at(-1)!;
  await http.pool.query(backfill);
  expect(
    (
      await http.pool.query('SELECT financial_status FROM saving_orders WHERE id=$1', [
        order.savingOrderId,
      ])
    ).rows[0].financial_status
  ).toBe('refunded');
  expect(await financialHistory()).toEqual(historyBefore);
  await http.pool.query(backfill);
  expect(await financialHistory()).toEqual(historyBefore);
  const prior = readFileSync(
    resolve(__dirname, '../../../../packages/db/drizzle/production/0161_saving_orders.sql'),
    'utf8'
  );
  const start = prior.indexOf('CREATE FUNCTION sync_saving_order_financial_status');
  const restore = prior
    .slice(start, prior.indexOf('--> statement-breakpoint', start))
    .replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
  const rollbackClient = await http.pool.connect();
  try {
    await rollbackClient.query('BEGIN');
    await rollbackClient.query(`DROP TRIGGER saving_cancellation_financial_sync ON contract_cancellations;
      DROP TRIGGER saving_cancellation_obligation_sync ON contract_refund_obligations;
      DROP TRIGGER saving_cancellation_refund_sync ON refunds;
      DROP TRIGGER saving_cancellation_transaction_sync ON refund_transactions;`);
    await rollbackClient.query(restore);
    await rollbackClient.query(
      'DROP FUNCTION sync_saving_cancellation_return();DROP FUNCTION refresh_saving_cancellation_financial_status(uuid)'
    );
    expect(
      (
        await rollbackClient.query(
          "SELECT to_regprocedure('refresh_saving_cancellation_financial_status(uuid)') AS fn"
        )
      ).rows[0].fn
    ).toBeNull();
  } finally {
    await rollbackClient.query('ROLLBACK');
    rollbackClient.release();
  }
  expect(
    (
      await http.pool.query(
        "SELECT to_regprocedure('refresh_saving_cancellation_financial_status(uuid)') AS fn"
      )
    ).rows[0].fn
  ).not.toBeNull();
  expect(await financialHistory()).toEqual(historyBefore);
}, 90000);

it('holds the current private owner and rejects mismatched saving status notices', async () => {
  await http.pool.query('UPDATE products SET stock_count=stock_count+2 WHERE id=$1', [
    input.hardwareProductId,
  ]);
  const fresh = { ...input, billIdentifier: '9988776655443' };
  const quote = await request('/api/saving/orders/quote', 'POST', fresh);
  expect(quote.status, http.logs()).toBe(201);
  const digest = ((await quote.json()) as { reviewDigest: string }).reviewDigest;
  const submitted = await request('/api/saving/orders', 'POST', {
    ...fresh,
    idempotencyKey: randomUUID(),
    expectedQuoteDigest: digest,
    agreementAccepted: true,
    hardwareConfirmed: true,
    submitForStaffReview: true,
  });
  expect(submitted.status, http.logs()).toBe(201);
  const id = ((await submitted.json()) as { savingOrderId: string }).savingOrderId;
  const next = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'fixture')",
    [next, next + '@example.test']
  );
  const content = {
    title: 'Saving order',
    localizedContent: {
      fa: { title: 'سفارش صرفه‌جویی', body: 'وضعیت سفارش تغییر کرد.' },
      en: { title: 'Saving order', body: 'Order status changed.' },
    },
  };
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await expect(
      notifySavingStatus(client, id, 'awaiting_staff_review', 'approved', content)
    ).rejects.toThrow('saved status');
    await client.query('ROLLBACK');
    await expectSavingStatusDeliveries(http.pool, id, 'saving-order-buyer', []);
    await client.query('BEGIN');
    await client.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [input.profileId, next]);
    // Same-state information must use the owner at the time of the guarded transaction.
    await notifySavingStatus(client, id, 'awaiting_staff_review', 'awaiting_staff_review', content);
    const notices = (
      await client.query(
        "SELECT recipient_user_id,type FROM in_app_notifications WHERE link_route=$1 AND type='general'",
        ['/savings/orders/' + id]
      )
    ).rows;
    expect(notices).toEqual([{ recipient_user_id: next, type: 'general' }]);
    expect(
      (
        await client.query(
          "SELECT * FROM notification_outbox WHERE payload->>'orderNumber'=$1 AND event_key='order.status_changed'",
          [id]
        )
      ).rows
    ).toEqual([]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
