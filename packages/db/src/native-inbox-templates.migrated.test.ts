import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { buildSeedTemplates } from './seed/notification-templates';
import { renderTemplate, buildTemplateSampleData } from '@barghsa/shared/notifications';
import { runWalletRefund } from './refund-processing';
import { postWalletCredit } from './wallet-credit';
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
const cases: Array<[string, string[], Record<string, unknown>]> = [
  ['{{amount}}', ['amount'], { amount: '9007199254740993' }],
  ['{{a}} / {{b}} / {{a}}', ['a', 'b'], { a: '{{b}}', b: 'PRIVATE_NOT_RECURSIVE' }],
  ['😀 {{\t amount\u00a0}}', ['amount'], { amount: '<script>text</script>' }],
  ['{{nested.value}}', ['nested.value'], { nested: { value: 'safe' } }],
  ['{{items.0.value}}', ['items.0.value'], { items: [{ value: 'safe' }] }],
  ['{{items.00.value}}', ['items.00.value'], { items: [{ value: 'unsafe' }] }],
  ['{{nested.constructor}}', ['nested.constructor'], { nested: { constructor: 'PRIVATE' } }],
  ['{{__proto__.value}}', ['__proto__.value'], {}],
  ['{{prototype}}', ['prototype'], { prototype: 'PRIVATE' }],
  ['{{hasOwnProperty}}', ['hasOwnProperty'], { hasOwnProperty: 'PRIVATE' }],
  ['{{secret}}', [], { secret: 'PRIVATE' }],
  ['{{missing}}', ['missing'], {}],
  ['{{missing}}', ['missing'], { missing: null }],
  ['{{value}}', ['value'], { value: { secret: 'PRIVATE' } }],
  ['{{value}}', ['value'], { value: ['PRIVATE'] }],
  ['{{}}', [], {}],
  ['literal {{ unclosed', [], {}],
  ...[
    0,
    -0,
    42,
    true,
    false,
    0.000001,
    0.0000001,
    1e20,
    1e21,
    1.2345678901234567,
    9007199254740992,
  ].map((value): [string, string[], Record<string, unknown>] => [
    '{{value}}',
    ['value'],
    { value },
  ]),
];
it.each(cases)('matches the existing one-pass safe renderer for %#', async (text, names, data) => {
  const expected = renderTemplate(text, names, { data, escapeValues: false });
  const query = db.pool.query('SELECT render_native_inbox_text($1,$2::jsonb,$3::jsonb) AS value', [
    text,
    JSON.stringify(names),
    JSON.stringify(data),
  ]);
  if (expected.missing.length || expected.unknown.length)
    await expect(query).rejects.toMatchObject({ code: '23514' });
  else expect((await query).rows[0].value).toBe(expected.output);
});
it.each(buildSeedTemplates().filter((t) => t.channel === 'in_app'))(
  'renders the actual $eventKey/$locale seed with the original engine contract',
  async (seed) => {
    const names = seed.variables.map((v) => v.name),
      data = buildTemplateSampleData(names);
    const expected = renderTemplate(seed.bodyTemplate, names, { data, escapeValues: false });
    expect(expected.missing).toEqual([]);
    expect(expected.unknown).toEqual([]);
    expect(
      (
        await db.pool.query('SELECT render_native_inbox_text($1,$2::jsonb,$3::jsonb) AS value', [
          seed.bodyTemplate,
          JSON.stringify(seed.variables),
          JSON.stringify(data),
        ])
      ).rows[0].value
    ).toBe(expected.output);
  }
);
async function template(
  event: string,
  body: string,
  variables: unknown = ['amount'],
  locale = 'en'
) {
  await db.pool.query(
    `INSERT INTO notification_templates(event_key,channel,locale,body_template,variables,status,is_active,version)
 SELECT $1,'in_app',$2,$3,$4,'active',true,COALESCE(MAX(version),0)+1 FROM notification_templates WHERE event_key=$1 AND channel='in_app' AND locale=$2`,
    [event, locale, body, JSON.stringify(variables)]
  );
}
async function fixture() {
  const user = randomUUID(),
    profile = randomUUID();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES($1,$1,'fixture',true)",
    [user]
  );
  await db.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  await db.pool.query('INSERT INTO wallets(profile_id) VALUES($1)', [profile]);
  return { user, profile };
}
async function rows() {
  const tables = (
    await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )
  ).rows;
  const r: Record<string, unknown> = {};
  for (const { tablename } of tables)
    r[tablename] = (
      await db.pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS value FROM "${tablename}" t`
      )
    ).rows[0].value;
  return r;
}
async function credit(f: Awaited<ReturnType<typeof fixture>>, amount = '40', key = randomUUID()) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [f.profile]);
    const result = (await postWalletCredit(
      c,
      { id: f.profile, archived: false },
      f.profile,
      BigInt(amount),
      { type: 'compensating', refId: 'native-template-test', metadata: {} },
      key
    )) as { id: string };
    await c.query('COMMIT');
    return result.id;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
it('renders a future actual wallet credit once,keeps inactive locale native,and preserves original read/history on replay', async () => {
  const f = await fixture();
  await template('wallet.credit_received', 'Credit {{amount}}');
  const id = await credit(f, '9007199254740993');
  const outbox = (
    await db.pool.query("SELECT * FROM notification_outbox WHERE payload->>'transactionId'=$1", [
      id,
    ])
  ).rows[0];
  const notice = (
    await db.pool.query(
      "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
      [outbox.id]
    )
  ).rows[0];
  expect(notice.localized_content.en.body).toBe('Credit 9007199254740993');
  expect(notice.localized_content.fa.body).toContain('9007199254740993');
  await db.pool.query('UPDATE in_app_notifications SET is_read=true,read_at=now() WHERE id=$1', [
    notice.id,
  ]);
  await db.pool.query(
    "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key='wallet.credit_received' AND is_active"
  );
  await template('wallet.credit_received', 'Missing {{unavailable}}', ['unavailable']);
  const before = await rows();
  await db.pool.query(
    `INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,localized_content,delivery_key)
 VALUES($1,$2,'customer','wallet.credit_received','notifications.legacy.title','notifications.legacy.body','{}','outbox:'||$3::text) ON CONFLICT(delivery_key) DO NOTHING`,
    [f.profile, f.user, outbox.id]
  );
  expect(await rows()).toEqual(before);
});
it('rolls every business/public row back on invalid active data and recovers the exact credit command', async () => {
  const f = await fixture(),
    id = randomUUID();
  await template('wallet.credit_received', 'Missing {{unavailable}}', ['unavailable']);
  const before = await rows();
  await expect(credit(f, '40', id)).rejects.toMatchObject({ code: '23514' });
  expect(await rows()).toEqual(before);
  await db.pool.query(
    "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key='wallet.credit_received' AND is_active"
  );
  await template('wallet.credit_received', 'Credit {{amount}}');
  const transactionId = await credit(f, '40', id);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS count FROM notification_outbox WHERE payload->>'transactionId'=$1",
        [transactionId]
      )
    ).rows[0].count
  ).toBe(1);
});
it.each(['user', 'profile', 'event'])(
  'rejects a mismatched active canonical %s before storing the inbox',
  async (kind) => {
    const f = await fixture(),
      other = await fixture(),
      id = randomUUID();
    await template('wallet.credit_received', 'Credit {{amount}}');
    await db.pool.query(
      "INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,status,idempotency_key) VALUES($1,$2,$3,$4,'{\"amount\":\"40\"}',ARRAY['in_app'],'queued',$5)",
      [
        id,
        f.profile,
        f.user,
        kind === 'event' ? 'wallet.low_balance' : 'wallet.credit_received',
        randomUUID(),
      ]
    );
    const before = await rows();
    await expect(
      db.pool.query(
        `INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,localized_content,delivery_key) VALUES($1,$2,'customer','wallet.credit_received','notifications.legacy.title','notifications.legacy.body','{}','outbox:'||$3::text)`,
        [kind === 'profile' ? other.profile : f.profile, kind === 'user' ? other.user : f.user, id]
      )
    ).rejects.toMatchObject({ code: '23514' });
    expect(await rows()).toEqual(before);
  }
);
it('renders a late completed-refund native receipt from the actual refund without changing the credit or original IDs', async () => {
  const f = await fixture(),
    invoice = randomUUID();
  await template('payment.refund_completed', 'Refund {{refundId}} / {{amount}}', [
    'refundId',
    'amount',
  ]);
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,'Paid',100,100)",
    [invoice, f.profile]
  );
  const refund = (
    await db.pool.query(
      "INSERT INTO refunds(invoice_id,profile_id,amount,destination,staff_id,idempotency_key) VALUES($1,$2,40,'wallet',$3,$4) RETURNING *",
      [invoice, f.profile, f.user, randomUUID()]
    )
  ).rows[0];
  await db.pool.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refund.id]);
  await db.pool.query('INSERT INTO refund_retry_jobs(refund_id,executor_user_id) VALUES($1,$2)', [
    refund.id,
    f.user,
  ]);
  expect(await runWalletRefund(db.pool, refund.id)).toBe('completed');
  const n = (
    await db.pool.query('SELECT * FROM in_app_notifications WHERE delivery_key=$1', [
      `refund:${refund.id}:Completed`,
    ])
  ).rows[0];
  expect(n.localized_content.en.body).toBe(`Refund ${refund.id} / 40`);
  const o = (
    await db.pool.query(
      "SELECT * FROM notification_outbox WHERE event_key='payment.refund_completed' AND payload->>'refundId'=$1",
      [refund.id]
    )
  ).rows;
  expect(o).toHaveLength(1);
  expect(o[0].payload.inboxId).toBe(n.id);
  expect(
    (
      await db.pool.query(
        "SELECT provider_ref FROM notification_job WHERE outbox_id=$1 AND channel='in_app'",
        [o[0].id]
      )
    ).rows
  ).toEqual([{ provider_ref: n.id }]);
});
it('renders a private revoked-family warning before its late outbox attachment', async () => {
  const f = await fixture(),
    family = randomUUID();
  await template('auth.refresh_token_reused', 'Reviewed reuse warning', []);
  await db.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,revoked_at) VALUES($1,$2,'fixture',$3,now()+interval '1 day',now()+interval '1 day',now())",
    [randomUUID(), f.user, family]
  );
  const n = (
    await db.pool.query(
      "INSERT INTO in_app_notifications(recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,localized_content,delivery_key) VALUES($1,'account','auth.refresh_token_reused','notifications.legacy.title','notifications.legacy.body',$2,$3) RETURNING *",
      [
        f.user,
        { fa: { title: 'اصلی', body: 'اصلی' }, en: { title: 'Native', body: 'Native' } },
        `session-reuse:${family}`,
      ]
    )
  ).rows[0];
  expect(n.localized_content.en.body).toBe('Reviewed reuse warning');
  expect(n.localized_content.fa.body).toBe('اصلی');
});

it.each(['Paid', 'Overdue'] as const)(
  'renders the actual %s invoice transition once from its private committed outcome',
  async (state) => {
    const f = await fixture(),
      invoice = randomUUID(),
      event = state === 'Paid' ? 'payment.invoice_paid' : 'payment.invoice_overdue';
    await db.pool.query(
      "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,due_at) VALUES($1,$2,'Unpaid',100,0,now()-interval '1 day')",
      [invoice, f.profile]
    );
    await template(event, 'Invoice {{invoiceNumber}} / amount {{amount}}', [
      'invoiceNumber',
      'amount',
    ]);
    await db.pool.query(
      "UPDATE invoices SET state=$2,paid_amount=CASE WHEN $2::invoice_state='Paid' THEN total_amount ELSE paid_amount END WHERE id=$1",
      [invoice, state]
    );
    const outbox = (
      await db.pool.query(
        'SELECT * FROM notification_outbox WHERE profile_id=$1 AND event_key=$2',
        [f.profile, event]
      )
    ).rows;
    expect(outbox).toHaveLength(1);
    const inbox = (
      await db.pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [outbox[0].id]
      )
    ).rows;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      profile_id: f.profile,
      recipient_user_id: f.user,
      operating_context: 'customer',
      type: event,
    });
    expect(inbox[0].localized_content.en.body).toBe(`Invoice ${invoice} / amount 100`);
    await db.pool.query('UPDATE invoices SET state=state WHERE id=$1', [invoice]);
    expect(
      (
        await db.pool.query(
          'SELECT id FROM notification_outbox WHERE profile_id=$1 AND event_key=$2',
          [f.profile, event]
        )
      ).rows
    ).toEqual([{ id: outbox[0].id }]);
  }
);

it('renders an audited internal refund failure with a safe generic reason instead of provider diagnostics', async () => {
  const f = await fixture(),
    invoice = randomUUID();
  await template('payment.refund_failed', 'Finance {{reason}}', ['reason']);
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,'Paid',100,100)",
    [invoice, f.profile]
  );
  const refund = (
    await db.pool.query(
      "INSERT INTO refunds(invoice_id,profile_id,amount,destination,staff_id,idempotency_key) VALUES($1,$2,40,'wallet',$3,$4) RETURNING *",
      [invoice, f.profile, f.user, randomUUID()]
    )
  ).rows[0];
  await db.pool.query("UPDATE refunds SET state='Processing' WHERE id=$1", [refund.id]);
  await db.pool.query('INSERT INTO refund_retry_jobs(refund_id,executor_user_id) VALUES($1,$2)', [
    refund.id,
    f.user,
  ]);
  await db.pool.query(
    "CREATE FUNCTION fail_native_refund() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type='refund' THEN RAISE EXCEPTION 'PRIVATE_GATEWAY_AUTHORITY'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_native_refund BEFORE INSERT ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION fail_native_refund()"
  );
  try {
    expect(await runWalletRefund(db.pool, refund.id)).toBe('failed');
  } finally {
    await db.pool.query(
      'DROP TRIGGER fail_native_refund ON wallet_transactions;DROP FUNCTION fail_native_refund()'
    );
  }
  const notices = (
    await db.pool.query(
      "SELECT o.payload,n.localized_content,n.operating_context,o.channels FROM notification_outbox o JOIN in_app_notifications n ON n.delivery_key='outbox:'||o.id::text WHERE o.event_key='payment.refund_failed' AND o.payload->>'refundId'=$1",
      [refund.id]
    )
  ).rows;
  expect(notices.length).toBeGreaterThan(0);
  for (const n of notices) {
    expect(n.operating_context).toBe('staff');
    expect(n.channels).toEqual(['in_app']);
    expect(n.localized_content.en.body).toBe('Finance ' + n.payload.reason);
    expect(n.payload.reason).toContain('finance workspace');
    expect(JSON.stringify(n)).not.toContain('PRIVATE_GATEWAY_AUTHORITY');
  }
  expect(
    (await db.pool.query('SELECT posted_balance FROM wallets WHERE profile_id=$1', [f.profile]))
      .rows[0].posted_balance
  ).toBe('0');
});
