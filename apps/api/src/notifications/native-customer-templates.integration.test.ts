import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { createMigratedTestDb } from '../../../../packages/db/dist/test/migrated-db.js';
import { buildSeedTemplates } from '../../../../packages/db/dist/seed/notification-templates.js';
import { NotificationsService, type CustomerBusinessEvent } from './notifications.service.js';
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  db = await createMigratedTestDb();
}, 40000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query(
    "UPDATE notification_templates SET status='archived',is_active=false WHERE channel='in_app' AND is_active"
  );
});
const service = new NotificationsService();
async function fixture(eventKey: CustomerBusinessEvent = 'order.status_changed') {
  const user = randomUUID(),
    profile = randomUUID();
  await db.pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  await db.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  return {
    userId: user,
    profileId: profile,
    operatingContext: 'customer' as const,
    type: 'general' as const,
    eventKey,
    occurrenceKey: `native-template:${randomUUID()}`,
    title: 'Native title',
    link: '/wallet',
    localizedContent: {
      fa: { title: 'عنوان اصلی', body: 'پیام اصلی' },
      en: { title: 'Native title', body: 'Native message' },
    },
    payload: {
      orderNumber: '9007199254740993',
      newStatus: 'Review <script>alert(1)</script>',
      submittedAt: '2026-10-08T00:00:00.000Z',
      contractNumber: '9007199254740993',
      contractType: 'Electricity',
      acceptedAt: '2026-10-08T00:00:00.000Z',
      signedAt: '2026-10-08T00:00:00.000Z',
      changesDescription: 'Please revise',
      documentName: 'customer.pdf',
      reviewResult: 'approved',
    },
  };
}
async function template(
  event: string,
  locale = 'en',
  body = 'Custom {{orderNumber}} / {{newStatus}}',
  variables: unknown = ['orderNumber', 'newStatus'],
  status = 'active',
  channel = 'in_app',
  subject: string | null = null
) {
  await db.pool.query(
    `INSERT INTO notification_templates(event_key,channel,locale,body_template,variables,status,is_active,version,subject)
    SELECT $1,$2,$3,$4,$5,$6,$6='active',COALESCE(MAX(version),0)+1,$7 FROM notification_templates WHERE event_key=$1 AND channel=$2 AND locale=$3`,
    [event, channel, locale, body, JSON.stringify(variables), status, subject]
  );
}
async function transaction(work: (client: PoolClient) => Promise<unknown>) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function allRows() {
  const tables = (
    await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )
  ).rows;
  const result: Record<string, unknown> = {};
  for (const { tablename } of tables)
    result[tablename] = (
      await db.pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename}" t`
      )
    ).rows[0].rows;
  return result;
}
async function inbox(input: Awaited<ReturnType<typeof fixture>>) {
  const outbox = (
    await db.pool.query('SELECT * FROM notification_outbox WHERE idempotency_key=$1', [
      input.occurrenceKey,
    ])
  ).rows[0];
  const rows = (
    await db.pool.query(
      "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
      [outbox.id]
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    profile_id: input.profileId,
    recipient_user_id: input.userId,
    operating_context: 'customer',
    type: input.eventKey,
  });
  expect(
    (
      await db.pool.query(
        'SELECT channel,status,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [outbox.id]
      )
    ).rows
  ).toEqual([
    { channel: 'email', status: 'queued', provider_ref: null },
    { channel: 'in_app', status: 'done', provider_ref: rows[0].id },
  ]);
  expect(
    (
      await db.pool.query(
        "SELECT provider_ref FROM notification_delivery_log WHERE notification_id=$1 AND channel='in_app' AND status='delivered'",
        [outbox.id]
      )
    ).rows
  ).toEqual([{ provider_ref: rows[0].id }]);
  return rows[0];
}
it.each([
  'order.submitted',
  'order.status_changed',
  'order.cancellation_requested',
  'contract.created',
  'contract.awaiting_acceptance',
  'contract.accepted',
  'contract.signed',
  'contract.active',
  'contract.cancelled',
  'contract.changes_requested',
  'document.review_completed',
] as const)(
  'renders both actual seeded in-app templates before native %s is acknowledged',
  async (eventKey) => {
    const input = await fixture(eventKey);
    const rows = buildSeedTemplates().filter(
      (r) => r.eventKey === eventKey && r.channel === 'in_app'
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) await template(eventKey, row.locale, row.bodyTemplate, row.variables);
    await transaction((client) => service.createCustomerBusinessEvent(input, client));
    const saved = await inbox(input);
    expect(saved.localized_content.fa.body).not.toContain('{{');
    expect(saved.localized_content.en.body).not.toContain('{{');
    expect(saved.localized_content.fa.body).not.toBe(input.localizedContent.fa.body);
    expect(saved.localized_content.en.body).not.toBe(input.localizedContent.en.body);
    expect(saved.localized_content.fa.title).toBe(input.localizedContent.fa.title);
    expect(saved.localized_content.en.title).toBe(input.localizedContent.en.title);
  }
);
it('selects only the active event/channel/locale and keeps the other locale native', async () => {
  const input = await fixture();
  await template(input.eventKey, 'en');
  await template(input.eventKey, 'fa', 'Draft', [], 'draft');
  await template(input.eventKey, 'fa', 'Email', [], 'active', 'email');
  await template('order.submitted', 'fa', 'Foreign event', []);
  await transaction((client) => service.createCustomerBusinessEvent(input, client));
  const saved = await inbox(input);
  expect(saved.localized_content).toEqual({
    fa: input.localizedContent.fa,
    en: {
      title: 'Native title',
      body: `Custom ${input.payload.orderNumber} / ${input.payload.newStatus}`,
    },
  });
});
it('snapshots active versions and keeps read state,receipt IDs and history immutable on replay', async () => {
  const input = await fixture();
  await template(input.eventKey);
  await transaction((client) => service.createCustomerBusinessEvent(input, client));
  const first = await inbox(input);
  await db.pool.query('UPDATE in_app_notifications SET is_read=true,read_at=NOW() WHERE id=$1', [
    first.id,
  ]);
  await db.pool.query(
    "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key=$1 AND is_active",
    [input.eventKey]
  );
  await template(input.eventKey, 'en', 'Missing {{unavailable}}', ['unavailable']);
  const before = await allRows();
  expect(await transaction((client) => service.createCustomerBusinessEvent(input, client))).toBe(
    false
  );
  expect(await allRows()).toEqual(before);
  const next = { ...input, occurrenceKey: `native-template:${randomUUID()}` };
  await expect(
    transaction((client) => service.createCustomerBusinessEvent(next, client))
  ).rejects.toThrow('Inbox template data incomplete');
  expect(await allRows()).toEqual(before);
});
it.each([
  ['missing', 'Missing {{unavailable}}', ['unavailable']],
  ['unknown', 'Unknown {{secret}}', []],
  ['prototype', 'Blocked {{constructor}}', ['constructor']],
  ['malformed variables', 'Body', [{ description: 'invalid' }]],
] as const)(
  'rolls back the whole business transaction after %s template data',
  async (_name, body, variables) => {
    const input = await fixture();
    await template(input.eventKey, 'en', body, variables);
    const before = await allRows();
    await expect(
      transaction(async (client) => {
        await client.query('UPDATE profiles SET archived=true WHERE id=$1', [input.profileId]);
        await service.createCustomerBusinessEvent(input, client);
      })
    ).rejects.toThrow(/Inbox template data incomplete|Invalid inbox template variables/);
    expect(await allRows()).toEqual(before);
  }
);
it('keeps payload extras and internal business rows out of allowlisted content', async () => {
  const input = await fixture();
  await template(
    input.eventKey,
    'en',
    'Public {{orderNumber}}',
    ['orderNumber'],
    'active',
    'in_app',
    'Order {{orderNumber}}'
  );
  await transaction((client) =>
    service.createCustomerBusinessEvent(
      { ...input, payload: { ...input.payload, internalSecret: 'DO_NOT_RENDER' } },
      client
    )
  );
  const saved = await inbox(input);
  expect(saved.localized_content.en).toEqual({
    title: `Order ${input.payload.orderNumber}`,
    body: `Public ${input.payload.orderNumber}`,
  });
  expect(JSON.stringify(saved.localized_content)).not.toContain('DO_NOT_RENDER');
});
it('keeps direct informational inboxes outside business template rendering', async () => {
  const input = await fixture();
  await template(input.eventKey, 'en', 'Missing {{unavailable}}', ['unavailable']);
  const direct = await transaction((client) => service.create(input, client));
  expect(direct).toMatchObject({ type: 'general' });
  expect(
    (
      await db.pool.query('SELECT localized_content FROM in_app_notifications WHERE id=$1', [
        (direct as { id: string }).id,
      ])
    ).rows[0].localized_content
  ).toEqual(input.localizedContent);
});

it('rolls business and schema changes back when the active catalogue cannot be read', async () => {
  const input = await fixture();
  const before = await allRows();
  await expect(
    transaction(async (client) => {
      await client.query('UPDATE profiles SET archived=true WHERE id=$1', [input.profileId]);
      await client.query(
        'ALTER TABLE notification_templates RENAME TO unavailable_template_fixture'
      );
      await service.createCustomerBusinessEvent(input, client);
    })
  ).rejects.toThrow('relation "notification_templates" does not exist');
  expect(await allRows()).toEqual(before);
});
