import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedTestDb } from '../../../../packages/db/dist/test/migrated-db.js';
import { evaluateWalletLowBalanceSignals } from './low-balance-notifications.js';
import { EmailNotificationTransport } from '../notifications/email-transport.js';
import { DeliveryOutcomeUnknown } from '../notifications/send-receipt.js';
import { loadNotificationRecipient } from '../notifications/channel-availability-loader.js';
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  db = await createMigratedTestDb();
}, 40000);
afterAll(async () => {
  await db?.close();
});
async function fixture(balance = '40', amount = '100') {
  const user = randomUUID(),
    profile = randomUUID(),
    invoice = randomUUID();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash,notification_preferences) VALUES($1,$2,'fixture','IN_APP,EMAIL')",
    [user, `${user}@example.test`]
  );
  await db.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  await db.pool.query('INSERT INTO wallets(profile_id,posted_balance) VALUES($1,$2)', [
    profile,
    balance,
  ]);
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount) VALUES($1,$2,'Unpaid',$3,0)",
    [invoice, profile, amount]
  );
  return { user, profile, invoice };
}
async function notices(profile: string) {
  return (
    await db.pool.query(
      "SELECT * FROM notification_outbox WHERE profile_id=$1 AND event_key='wallet.low_balance' ORDER BY created_at,id",
      [profile]
    )
  ).rows;
}
async function snapshot() {
  const tables = (
    await db.pool.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
    )
  ).rows;
  const rows: Record<string, unknown> = {};
  for (const { tablename } of tables)
    rows[tablename] = (
      await db.pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename}" t`
      )
    ).rows[0].rows;
  return rows;
}
async function manifest(f: Awaited<ReturnType<typeof fixture>>) {
  const rows = await notices(f.profile);
  expect(rows).toHaveLength(1);
  const o = rows[0];
  expect(o).toMatchObject({
    user_id: f.user,
    profile_id: f.profile,
    event_key: 'wallet.low_balance',
    channels: ['in_app', 'email'],
    status: 'queued',
    payload: { balance: '40', threshold: '100', link_route: '/wallet' },
  });
  expect(o.idempotency_key).toBe(`wallet.low_balance:${o.payload.episodeId}:${f.user}`);
  const inbox = (
    await db.pool.query(
      "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
      [o.id]
    )
  ).rows;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    recipient_user_id: f.user,
    profile_id: f.profile,
    operating_context: 'customer',
    type: 'wallet.low_balance',
    link_route: '/wallet',
  });
  expect(inbox[0].localized_content.en.body).toContain('when this alert was recorded');
  expect(inbox[0].localized_content.fa.body).toContain('هنگام ثبت');
  expect(
    (
      await db.pool.query(
        'SELECT channel,status,priority,attempts,provider_ref FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
        [o.id]
      )
    ).rows
  ).toEqual([
    { channel: 'email', status: 'queued', priority: 'urgent', attempts: 0, provider_ref: null },
    {
      channel: 'in_app',
      status: 'done',
      priority: 'urgent',
      attempts: 1,
      provider_ref: inbox[0].id,
    },
  ]);
  expect(
    (
      await db.pool.query(
        'SELECT channel,status,attempt_number,provider_ref FROM notification_delivery_log WHERE notification_id=$1',
        [o.id]
      )
    ).rows
  ).toEqual([
    { channel: 'in_app', status: 'delivered', attempt_number: 1, provider_ref: inbox[0].id },
  ]);
  expect(await loadNotificationRecipient(db.pool, o.id)).toMatchObject({
    userId: f.user,
    profileId: f.profile,
  });
  return { outbox: o, inbox: inbox[0] };
}
it('coalesces committed signals into one private immediate episode with native receipt and no repeated alert while still low', async () => {
  const f = await fixture();
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({
    evaluated: 1,
    notified: 1,
    busy: 0,
    errors: [],
  });
  const first = await manifest(f);
  await db.pool.query('UPDATE in_app_notifications SET is_read=true,read_at=now() WHERE id=$1', [
    first.inbox.id,
  ]);
  const old = (
    await db.pool.query('SELECT * FROM in_app_notifications WHERE id=$1', [first.inbox.id])
  ).rows;
  await db.pool.query('UPDATE wallets SET posted_balance=30 WHERE profile_id=$1', [f.profile]);
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({
    evaluated: 1,
    notified: 0,
    errors: [],
  });
  expect(await notices(f.profile)).toEqual([first.outbox]);
  expect(
    (await db.pool.query('SELECT * FROM in_app_notifications WHERE id=$1', [first.inbox.id])).rows
  ).toEqual(old);
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({
    evaluated: 0,
    notified: 0,
    errors: [],
  });
});
it('rearms after sufficient funds and denies old episode emails without rewriting read history', async () => {
  const f = await fixture();
  await evaluateWalletLowBalanceSignals(db.pool);
  const first = await manifest(f);
  await db.pool.query('UPDATE wallets SET posted_balance=100 WHERE profile_id=$1', [f.profile]);
  expect(await loadNotificationRecipient(db.pool, first.outbox.id)).toBeNull();
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({ notified: 0, errors: [] });
  expect(
    (
      await db.pool.query('SELECT active FROM wallet_low_balance_states WHERE profile_id=$1', [
        f.profile,
      ])
    ).rows
  ).toEqual([{ active: false }]);
  await db.pool.query('UPDATE invoices SET total_amount=120 WHERE id=$1', [f.invoice]);
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({ notified: 1, errors: [] });
  const current = await notices(f.profile);
  expect(current).toHaveLength(2);
  expect(current[0]).toEqual(first.outbox);
  expect(current[1].payload).toMatchObject({ balance: '100', threshold: '120' });
  expect(current[1].payload.episodeId).not.toBe(first.outbox.payload.episodeId);
  expect(await loadNotificationRecipient(db.pool, first.outbox.id)).toBeNull();
  expect(await loadNotificationRecipient(db.pool, current[1].id)).toMatchObject({ userId: f.user });
});
it('uses available posted-minus-reserved funds and exact unpaid totals beyond Number precision', async () => {
  const f = await fixture('9007199254740993', '9007199254740993');
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({ notified: 0, errors: [] });
  await db.pool.query('UPDATE wallets SET reserved_balance=1 WHERE profile_id=$1', [f.profile]);
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({ notified: 1, errors: [] });
  expect((await notices(f.profile))[0].payload).toMatchObject({
    balance: '9007199254740992',
    threshold: '9007199254740993',
  });
});
it.each(['owner', 'archived', 'paid', 'cancelled'] as const)(
  'suppresses obsolete pending low-balance email after %s changes',
  async (change) => {
    const f = await fixture();
    await evaluateWalletLowBalanceSignals(db.pool);
    const first = await manifest(f);
    if (change === 'owner') {
      const next = randomUUID();
      await db.pool.query(
        "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')",
        [next]
      );
      await db.pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, next]);
    } else if (change === 'archived')
      await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
    else
      await db.pool.query(
        "UPDATE invoices SET state=$2,paid_amount=CASE WHEN $2::invoice_state='Paid' THEN total_amount ELSE paid_amount END WHERE id=$1",
        [f.invoice, change === 'paid' ? 'Paid' : 'Cancelled']
      );
    expect(await loadNotificationRecipient(db.pool, first.outbox.id)).toBeNull();
    const outcome = await evaluateWalletLowBalanceSignals(db.pool);
    expect(outcome.errors).toEqual([]);
    expect(outcome.notified).toBe(change === 'owner' ? 1 : 0);
  }
);
it.each(['profile', 'recipient'] as const)(
  'leaves signals and history intact behind a busy %s lock,then resumes without waiting',
  async (kind) => {
    const f = await fixture(),
      before = await snapshot(),
      held = await db.pool.connect();
    try {
      await held.query('BEGIN');
      if (kind === 'profile')
        await held.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [f.profile]);
      else await held.query('SELECT user_id FROM users WHERE user_id=$1 FOR UPDATE', [f.user]);
      expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({
        evaluated: 0,
        notified: 0,
        busy: 1,
        errors: [],
      });
      expect(await snapshot()).toEqual(before);
    } finally {
      await held.query('ROLLBACK');
      held.release();
    }
    expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({
      notified: 1,
      errors: [],
    });
    await manifest(f);
  }
);
it('serializes two evaluators into one committed episode', async () => {
  const f = await fixture();
  const result = await Promise.all([
    evaluateWalletLowBalanceSignals(db.pool),
    evaluateWalletLowBalanceSignals(db.pool),
  ]);
  expect(result.flatMap((r) => r.errors)).toEqual([]);
  expect(result.reduce((n, r) => n + r.notified, 0)).toBe(1);
  await manifest(f);
});
it.each(
  [
    ['notification_outbox', 'INSERT', "NEW.event_key='wallet.low_balance'"],
    [
      'notification_job',
      'INSERT',
      "EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.outbox_id AND o.event_key='wallet.low_balance')",
    ],
    ['in_app_notifications', 'INSERT', "NEW.type='wallet.low_balance'"],
    [
      'notification_job',
      'UPDATE',
      "EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.outbox_id AND o.event_key='wallet.low_balance')",
    ],
    [
      'notification_delivery_log',
      'INSERT',
      "EXISTS(SELECT 1 FROM notification_outbox o WHERE o.id=NEW.notification_id AND o.event_key='wallet.low_balance')",
    ],
    ['wallet_low_balance_states', 'INSERT', 'true'],
    ['wallet_alert_signals', 'DELETE', 'true'],
  ].flatMap(([table, operation, guard]) =>
    ['raise', 'silent'].map((mode) => ({ table, operation, guard, mode }))
  )
)(
  'rolls evaluation back after $mode in $table $operation,preserving committed money and signals for recovery',
  async ({ table, operation, guard, mode }) => {
    const f = await fixture(),
      before = await snapshot();
    await db.pool.query(
      `CREATE FUNCTION fail_low_balance_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${guard} THEN ${mode === 'raise' ? "RAISE EXCEPTION 'low balance storage unavailable';" : 'RETURN NULL;'} END IF; RETURN ${operation === 'DELETE' ? 'OLD' : 'NEW'}; END $$; CREATE TRIGGER fail_low_balance_delivery BEFORE ${operation} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_low_balance_delivery()`
    );
    try {
      const result = await evaluateWalletLowBalanceSignals(db.pool);
      expect(result.notified).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(await snapshot()).toEqual(before);
    } finally {
      await db.pool.query(
        `DROP TRIGGER fail_low_balance_delivery ON ${table};DROP FUNCTION fail_low_balance_delivery()`
      );
    }
    expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({
      notified: 1,
      errors: [],
    });
    await manifest(f);
  }
);

it('appends independent invoice/wallet signals without adding a shared financial-row lock', async () => {
  const f = await fixture(),
    invoiceClient = await db.pool.connect(),
    walletClient = await db.pool.connect();
  let waiting: Promise<unknown> | undefined;
  try {
    await invoiceClient.query('BEGIN');
    await walletClient.query('BEGIN');
    await invoiceClient.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [f.profile]);
    await walletClient.query('SELECT id FROM profiles WHERE id=$1 FOR SHARE', [f.profile]);
    await walletClient.query('UPDATE wallets SET posted_balance=50 WHERE profile_id=$1', [
      f.profile,
    ]);
    await invoiceClient.query("SET LOCAL lock_timeout='1s'");
    await invoiceClient.query('UPDATE invoices SET total_amount=200 WHERE id=$1', [f.invoice]);
    waiting = invoiceClient.query('UPDATE wallets SET posted_balance=80 WHERE profile_id=$1', [
      f.profile,
    ]);
    await expect
      .poll(async () =>
        Number(
          (
            await db.pool.query(
              "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'UPDATE wallets SET posted_balance=80%' AND cardinality(pg_blocking_pids(pid))>0"
            )
          ).rows[0].count
        )
      )
      .toBe(1);
    await walletClient.query('COMMIT');
    await waiting;
    await invoiceClient.query('COMMIT');
  } finally {
    await walletClient.query('ROLLBACK');
    await waiting?.catch(() => {});
    await invoiceClient.query('ROLLBACK');
    walletClient.release();
    invoiceClient.release();
  }
  expect(await evaluateWalletLowBalanceSignals(db.pool)).toMatchObject({ notified: 1, errors: [] });
  expect((await notices(f.profile))[0].payload).toMatchObject({ balance: '80', threshold: '200' });
});
it.each(['wallet', 'invoice', 'profile'] as const)(
  'rolls back a $name business write when its mandatory signal cannot be captured',
  async (name) => {
    const f = await fixture();
    await evaluateWalletLowBalanceSignals(db.pool);
    for (const mode of ['raise', 'silent']) {
      const before = await snapshot();
      await db.pool.query(
        `CREATE FUNCTION fail_wallet_signal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${mode === 'raise' ? "RAISE EXCEPTION 'signal unavailable';" : 'RETURN NULL;'} END $$; CREATE TRIGGER fail_wallet_signal BEFORE INSERT ON wallet_alert_signals FOR EACH ROW EXECUTE FUNCTION fail_wallet_signal()`
      );
      try {
        const write =
          name === 'wallet'
            ? db.pool.query('UPDATE wallets SET posted_balance=30 WHERE profile_id=$1', [f.profile])
            : name === 'invoice'
              ? db.pool.query('UPDATE invoices SET total_amount=200 WHERE id=$1', [f.invoice])
              : db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
        await expect(write).rejects.toMatchObject({ code: mode === 'raise' ? 'P0001' : '23514' });
        expect(await snapshot()).toEqual(before);
      } finally {
        await db.pool.query(
          'DROP TRIGGER fail_wallet_signal ON wallet_alert_signals;DROP FUNCTION fail_wallet_signal()'
        );
      }
    }
  }
);
it.each(['accepted', 'unknown'] as const)(
  'preserves a %s provider receipt after the episode resolves without resending',
  async (status) => {
    const f = await fixture();
    await evaluateWalletLowBalanceSignals(db.pool);
    const first = await manifest(f);
    await db.pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.user]);
    await db.pool.query(
      "UPDATE email_provider_configs SET status='disabled' WHERE status='active'"
    );
    await db.pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash) VALUES('resend','Low balance test','active',$1,$2,'passed',now(),now(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'test-only', from_email: 'sender@example.test' }), f.user]
    );
    await db.pool.query(
      "INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by) VALUES('wallet.low_balance','email','en','Low wallet balance','<p>Balance {{balance}}</p>','[\"balance\"]','active',true,$1) ON CONFLICT DO NOTHING",
      [f.user]
    );
    const request = vi.fn<typeof fetch>();
    if (status === 'accepted')
      request.mockResolvedValue(
        new Response(JSON.stringify({ id: 'low-balance-receipt' }), { status: 200 })
      );
    else request.mockRejectedValue(new Error('timeout'));
    const transport = new EmailNotificationTransport(db.pool, request),
      payload = {
        outboxId: first.outbox.id,
        profileId: f.profile,
        recipientId: f.user,
        eventKey: 'wallet.low_balance',
        channel: 'email' as const,
        payload: first.outbox.payload,
        idempotencyKey: `low-balance:${first.outbox.id}`,
      };
    if (status === 'accepted')
      await expect(transport.send(payload)).resolves.toEqual({
        status: 'delivered',
        providerRef: 'low-balance-receipt',
      });
    else await expect(transport.send(payload)).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const receipt = (
      await db.pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [
        first.outbox.id,
      ])
    ).rows;
    await db.pool.query('UPDATE wallets SET posted_balance=100 WHERE profile_id=$1', [f.profile]);
    await evaluateWalletLowBalanceSignals(db.pool);
    expect(await loadNotificationRecipient(db.pool, first.outbox.id)).toBeNull();
    if (status === 'accepted')
      await expect(transport.send(payload)).resolves.toEqual({
        status: 'delivered',
        providerRef: 'low-balance-receipt',
      });
    else await expect(transport.send(payload)).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [
          first.outbox.id,
        ])
      ).rows
    ).toEqual(receipt);
  }
);
