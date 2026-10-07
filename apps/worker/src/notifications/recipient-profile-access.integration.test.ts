import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { enqueueOutbox } from './outbox-writer.js';
import { EmailNotificationTransport } from './email-transport.js';
import { SmsNotificationTransport } from './sms-transport.js';
import { durableDelivery, DeliveryOutcomeUnknown } from './send-receipt.js';
import {
  loadNotificationRecipient,
  assertNotificationRecipientAvailable,
} from './channel-availability-loader.js';
const name = `test_recipient_access_${randomUUID().replaceAll('-', '')}`;
let management: Pool, pool: Pool;
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  pool = new Pool({ connectionString: url.toString() });
  const folder = resolve(__dirname, '../../../../packages/db/drizzle/production');
  const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'));
  for (const entry of journal.entries)
    await pool.query(readFileSync(resolve(folder, entry.tag + '.sql'), 'utf8'));
}, 30000);
afterAll(async () => {
  await pool?.end();
  try {
    await management?.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
  }
});
async function fixture(eventKey = 'contract.awaiting_acceptance', context = 'customer') {
  const owner = randomUUID(),
    next = randomUUID();
  for (const user of [owner, next])
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash,notification_preferences) VALUES($1,$2,'fixture','IN_APP,EMAIL,SMS')",
      [user, `${user}@example.test`]
    );
  const profile = (
    await pool.query('INSERT INTO profiles(user_id) VALUES($1) RETURNING id', [owner])
  ).rows[0].id;
  const client = await pool.connect();
  let id: string;
  try {
    await client.query('BEGIN');
    const result = await enqueueOutbox(client, {
      userId: owner,
      profileId: profile,
      eventKey,
      channels: ['in_app', 'email'],
      payload: { contractNumber: 'private' },
      idempotencyKey: randomUUID(),
    });
    id = result.outboxId!;
    await client.query(
      "INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,delivery_key,localized_content) VALUES($1,$2,$3,$4,'notifications.legacy.title','notifications.legacy.body','outbox:'||$5::text,$6)",
      [
        profile,
        owner,
        context,
        eventKey,
        id,
        { fa: { title: 'قرارداد', body: 'خصوصی' }, en: { title: 'Contract', body: 'Private' } },
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { owner, next, profile, id };
}
const events = [
  'contract.created',
  'contract.awaiting_acceptance',
  'contract.accepted',
  'contract.signed',
  'contract.active',
  'contract.cancelled',
  'contract.changes_requested',
  'order.submitted',
  'order.status_changed',
  'order.cancellation_requested',
];
it.each(events.flatMap((event) => ['owner', 'archived'].map((change) => [event, change] as const)))(
  'denies private %s delivery after its profile %s changes',
  async (event, change) => {
    const f = await fixture(event),
      before = await loadNotificationRecipient(pool, f.id);
    expect(before).toMatchObject({
      userId: f.owner,
      profileId: f.profile,
      email: `${f.owner}@example.test`,
    });
    if (change === 'owner')
      await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, f.next]);
    else await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
    await expect(
      assertNotificationRecipientAvailable(pool, f.id, event, 'email', before!)
    ).rejects.toThrow('recipient changed');
    expect(
      (await pool.query('SELECT user_id FROM notification_outbox WHERE id=$1', [f.id])).rows[0]
        .user_id
    ).toBe(f.owner);
  }
);
it.each(['email', 'sms'] as const)(
  'rechecks ownership before the %s provider call and preserves the saved message',
  async (channel) => {
    const f = await fixture();
    const mobile = channel === 'email' ? '+989121000001' : '+989121000002';
    await pool.query('UPDATE users SET mobile=$2 WHERE user_id=$1', [f.owner, mobile]);
    await pool.query(
      "INSERT INTO account_login_identifiers(user_id,kind,destination,verified_at) VALUES($1,'mobile',$2,NOW())",
      [f.owner, mobile]
    );
    if (channel === 'sms')
      await pool.query("INSERT INTO notification_job(outbox_id,channel) VALUES($1,'sms')", [f.id]);
    const snapshot = {
      version: 1,
      userId: f.owner,
      profileId: f.profile,
      idempotencyKey: 'saved-key',
      destination: `${f.owner}@example.test`,
      subject: 'Private contract',
      html: '<p>Private</p>',
      providerId: randomUUID(),
      message: {
        destination: mobile,
        providerId: randomUUID(),
        templateId: '42',
        parameters: [{ name: 'VALUE', value: '1' }],
      },
    };
    await pool.query(
      'UPDATE notification_job SET delivery_payload=$3 WHERE outbox_id=$1 AND channel=$2',
      [f.id, channel, snapshot]
    );
    const deliveryPool = {
      async query(sql: string, params?: unknown[]) {
        const result = await pool.query(sql, params);
        if (sql.startsWith('SELECT delivery_payload'))
          await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, f.next]);
        return result;
      },
    };
    const request = vi.fn<typeof fetch>();
    const transport =
      channel === 'email'
        ? new EmailNotificationTransport(deliveryPool, request)
        : new SmsNotificationTransport(deliveryPool, request);
    await expect(
      transport.send({
        outboxId: f.id,
        profileId: f.profile,
        recipientId: f.owner,
        channel,
        eventKey: 'contract.awaiting_acceptance',
        payload: {},
        idempotencyKey: 'saved-key',
      })
    ).rejects.toThrow('recipient changed');
    expect(request).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT delivery_payload FROM notification_job WHERE outbox_id=$1 AND channel=$2',
          [f.id, channel]
        )
      ).rows[0].delivery_payload
    ).toEqual(snapshot);
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM notification_send_receipts WHERE outbox_id=$1',
          [f.id]
        )
      ).rows[0].count
    ).toBe(0);
  }
);
it.each(['accepted', 'unknown'] as const)(
  'preserves the %s receipt boundary after access is lost',
  async (status) => {
    const f = await fixture();
    const execute = durableDelivery(pool, f.id, 'email', 'saved-key');
    const provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'saved-receipt')).toBe('saved-receipt');
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, f.next]);
    const request = vi.fn<typeof fetch>();
    const promise = new EmailNotificationTransport(pool, request).send({
      outboxId: f.id,
      profileId: f.profile,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'contract.awaiting_acceptance',
      payload: {},
      idempotencyKey: 'saved-key',
    });
    if (status === 'accepted')
      await expect(promise).resolves.toEqual({ status: 'delivered', providerRef: 'saved-receipt' });
    else await expect(promise).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);
it('preserves explicit non-owner recipients for unrelated customer events', async () => {
  const f = await fixture('wallet.topup_completed');
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: f.profile,
  });
});
it('does not bypass private recipient access when the immediate inbox row is absent', async () => {
  const f = await fixture('order.submitted');
  await pool.query("DELETE FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
    f.id,
  ]);
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: f.profile,
  });
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
});
it('keeps the existing explicit staff recipient boundary separate from a private customer notice', async () => {
  const f = await fixture('contract.awaiting_acceptance', 'staff');
  await pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [f.profile, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: f.profile,
  });
});

async function ticketFixture(context: 'customer' | 'staff' = 'customer') {
  const owner = randomUUID(),
    next = randomUUID();
  for (const user of [owner, next])
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash,notification_preferences) VALUES($1,$2,'fixture','IN_APP,EMAIL')",
      [user, `${user}@example.test`]
    );
  const role = randomUUID();
  if (context === 'staff') {
    await pool.query(
      `INSERT INTO staff_roles(role_id,name,description,permissions) VALUES($1,$1,'Fixture','["tickets:assigned"]')`,
      [role]
    );
    await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [owner, role]);
  }
  const ticket = (
    await pool.query(
      "INSERT INTO tickets(user_id,subject,body,assigned_to) VALUES($1,'Private subject','Private conversation',$2) RETURNING id",
      [context === 'customer' ? owner : next, context === 'staff' ? owner : null]
    )
  ).rows[0].id;
  const client = await pool.connect();
  let id: string;
  try {
    await client.query('BEGIN');
    const result = await enqueueOutbox(client, {
      userId: owner,
      profileId: null,
      eventKey: 'ticket.new_reply',
      channels: ['in_app', 'email'],
      payload: { ticketNumber: ticket },
      idempotencyKey: randomUUID(),
    });
    id = result.outboxId!;
    await client.query(
      "INSERT INTO in_app_notifications(recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,delivery_key,localized_content) VALUES($1,$2,'ticket.new_reply','notifications.legacy.title','notifications.legacy.body','outbox:'||$3::text,$4)",
      [
        owner,
        context,
        id,
        { fa: { title: 'تیکت', body: 'پاسخ جدید' }, en: { title: 'Ticket', body: 'New reply' } },
      ]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { owner, next, ticket, role, id };
}
it('keeps profile-less ticket customer delivery private to its original ticket owner and inbox', async () => {
  const f = await ticketFixture();
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: null,
    email: `${f.owner}@example.test`,
  });
  await pool.query('UPDATE tickets SET user_id=$2 WHERE id=$1', [f.ticket, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  expect(
    (await pool.query('SELECT user_id FROM notification_outbox WHERE id=$1', [f.id])).rows[0]
      .user_id
  ).toBe(f.owner);
  await pool.query('UPDATE tickets SET user_id=$2 WHERE id=$1', [f.ticket, f.owner]);
  await pool.query("DELETE FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
    f.id,
  ]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
});
it('requires current ticket staff grants and assigned-only scope without retargeting old reply delivery', async () => {
  const f = await ticketFixture('staff');
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: null,
  });
  await pool.query('UPDATE tickets SET assigned_to=$2 WHERE id=$1', [f.ticket, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  await pool.query('UPDATE staff_roles SET permissions=\'["tickets:read"]\' WHERE role_id=$1', [
    f.role,
  ]);
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({ userId: f.owner });
  await pool.query(
    'UPDATE staff_roles SET permissions=\'"tickets:read"\'::jsonb WHERE role_id=$1',
    [f.role]
  );
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  await pool.query('UPDATE staff_roles SET permissions=\'["tickets:read"]\' WHERE role_id=$1', [
    f.role,
  ]);
  await pool.query("UPDATE staff_roles SET permissions='garbled roles' WHERE role_id=$1", [f.role]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  await pool.query('UPDATE staff_roles SET permissions=\'["tickets:read"]\' WHERE role_id=$1', [
    f.role,
  ]);
  await pool.query('DELETE FROM user_roles WHERE user_id=$1', [f.owner]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  expect(
    (await pool.query('SELECT user_id FROM notification_outbox WHERE id=$1', [f.id])).rows[0]
      .user_id
  ).toBe(f.owner);
});
it('rechecks ticket reassignment before provider delivery and preserves its saved snapshot', async () => {
  const f = await ticketFixture('staff');
  const snapshot = {
    version: 1,
    userId: f.owner,
    profileId: null,
    idempotencyKey: 'saved-ticket-key',
    destination: `${f.owner}@example.test`,
    subject: 'Private ticket',
    html: '<p>New reply</p>',
    providerId: randomUUID(),
  };
  await pool.query(
    "UPDATE notification_job SET delivery_payload=$2 WHERE outbox_id=$1 AND channel='email'",
    [f.id, snapshot]
  );
  const deliveryPool = {
    async query(sql: string, params?: unknown[]) {
      const result = await pool.query(sql, params);
      if (sql.startsWith('SELECT delivery_payload'))
        await pool.query('UPDATE tickets SET assigned_to=$2 WHERE id=$1', [f.ticket, f.next]);
      return result;
    },
  };
  const request = vi.fn<typeof fetch>();
  const transport = new EmailNotificationTransport(deliveryPool, request);
  await expect(
    transport.send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'ticket.new_reply',
      payload: { ticketNumber: f.ticket },
      idempotencyKey: 'saved-ticket-key',
    })
  ).rejects.toThrow('recipient changed');
  expect(request).not.toHaveBeenCalled();
  expect(
    (
      await pool.query(
        "SELECT delivery_payload FROM notification_job WHERE outbox_id=$1 AND channel='email'",
        [f.id]
      )
    ).rows[0].delivery_payload
  ).toEqual(snapshot);
});

it.each(['accepted', 'unknown'] as const)(
  'preserves a profile-less ticket %s receipt after staff access is lost',
  async (status) => {
    const f = await ticketFixture('staff');
    const execute = durableDelivery(pool, f.id, 'email', 'saved-ticket-receipt-key');
    const provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'saved-ticket-receipt')).toBe(
        'saved-ticket-receipt'
      );
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query('UPDATE tickets SET assigned_to=$2 WHERE id=$1', [f.ticket, f.next]);
    const request = vi.fn<typeof fetch>();
    const promise = new EmailNotificationTransport(pool, request).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'ticket.new_reply',
      payload: { ticketNumber: f.ticket },
      idempotencyKey: 'saved-ticket-receipt-key',
    });
    if (status === 'accepted')
      await expect(promise).resolves.toEqual({
        status: 'delivered',
        providerRef: 'saved-ticket-receipt',
      });
    else await expect(promise).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);

it.each(['customer', 'staff'] as const)(
  'delivers a profile-less %s ticket email once with its active template and durable provider receipt',
  async (context) => {
    const f = await ticketFixture(context);
    await pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.owner]);
    await pool.query("UPDATE email_provider_configs SET status='disabled' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Controlled ticket test','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' }), f.owner]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
 VALUES('ticket.new_reply','email','en','Ticket {{ticketNumber}}','<p>New reply for {{ticketNumber}}</p>','["ticketNumber"]','active',true,$1) ON CONFLICT DO NOTHING`,
      [f.owner]
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'ticket-email-receipt' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const transport = new EmailNotificationTransport(pool, request);
    const payload = {
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email' as const,
      eventKey: 'ticket.new_reply',
      payload: { ticketNumber: f.ticket },
      idempotencyKey: `ticket-provider:${f.id}`,
    };
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'ticket-email-receipt',
    });
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'ticket-email-receipt',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({
      to: [`${f.owner}@example.test`],
      subject: `Ticket ${f.ticket}`,
      html: expect.stringContaining(`<p>New reply for ${f.ticket}</p>`),
    });
    expect(JSON.stringify(sent)).not.toContain('Private conversation');
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref FROM notification_send_receipts WHERE outbox_id=$1',
          [f.id]
        )
      ).rows
    ).toEqual([{ status: 'accepted', provider_ref: 'ticket-email-receipt' }]);
    expect(
      (
        await pool.query(
          "SELECT delivery_payload FROM notification_job WHERE outbox_id=$1 AND channel='email'",
          [f.id]
        )
      ).rows[0].delivery_payload
    ).toMatchObject({
      profileId: null,
      userId: f.owner,
      templateVersion: 1,
      destination: `${f.owner}@example.test`,
      idempotencyKey: payload.idempotencyKey,
    });
    await expect(
      transport.send({ ...payload, eventKey: 'wallet.topup_completed' })
    ).rejects.toThrow('durable queued recipient');
    expect(request).toHaveBeenCalledTimes(1);
  }
);
