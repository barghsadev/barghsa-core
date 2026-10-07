import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { enqueueOutbox } from './outbox-writer.js';
import { InAppNotificationTransport } from './in-app-transport.js';
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
  'document.review_completed',
  'profile.verification_status',
  'payment.wallet_topup_completed',
  'payment.wallet_topup_failed',
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

async function invitationFixture() {
  const f = await fixture('profile.invitation_received');
  await pool.query("UPDATE profiles SET profile_type='LEGAL' WHERE id=$1", [f.profile]);
  const invitation = randomUUID();
  await pool.query(
    "INSERT INTO profile_invitations(id,profile_id,username,role,invited_by,expires_at) VALUES($1,$2,$3,'Finance',$4,NOW()+INTERVAL '7 days')",
    [invitation, f.profile, `${f.owner}@example.test`, f.next]
  );
  await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
    f.id,
    { invitationId: invitation, entityName: 'Example entity', inviteLink: '/dashboard' },
  ]);
  await pool.query(
    "UPDATE in_app_notifications SET profile_id=NULL,link_route='/dashboard' WHERE delivery_key='outbox:'||$1::text",
    [f.id]
  );
  return { ...f, invitation };
}
it.each([
  'Accepted',
  'Declined',
  'Withdrawn',
  'expiry',
  'archive',
  'identifier',
  'inbox',
  'disabled',
])('requires a current private pending invitation after %s changes', async (change) => {
  const f = await invitationFixture(),
    before = await loadNotificationRecipient(pool, f.id);
  expect(before).toMatchObject({
    userId: f.owner,
    profileId: null,
    email: `${f.owner}@example.test`,
  });
  if (['Accepted', 'Declined', 'Withdrawn'].includes(change))
    await pool.query('UPDATE profile_invitations SET status=$2 WHERE id=$1', [
      f.invitation,
      change,
    ]);
  else if (change === 'expiry')
    await pool.query(
      "UPDATE profile_invitations SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
      [f.invitation]
    );
  else if (change === 'archive')
    await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
  else if (change === 'identifier') {
    await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
      f.owner,
      `${randomUUID()}@example.test`,
    ]);
    await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
      f.next,
      `${f.owner}@example.test`,
    ]);
    expect(
      (
        await pool.query('SELECT user_id FROM account_login_identifiers WHERE destination=$1', [
          `${f.owner}@example.test`,
        ])
      ).rows
    ).toEqual([{ user_id: f.next }]);
  } else if (change === 'inbox')
    await pool.query("DELETE FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
      f.id,
    ]);
  else await pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.owner]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  await expect(
    assertNotificationRecipientAvailable(
      pool,
      f.id,
      'profile.invitation_received',
      'email',
      before!
    )
  ).rejects.toThrow('recipient changed');
  expect(
    (await pool.query('SELECT user_id FROM notification_outbox WHERE id=$1', [f.id])).rows[0]
      .user_id
  ).toBe(f.owner);
});
it('rechecks invitation withdrawal after rendering before the provider call', async () => {
  const f = await invitationFixture(),
    snapshot = {
      version: 1,
      userId: f.owner,
      profileId: null,
      idempotencyKey: 'invite-key',
      destination: `${f.owner}@example.test`,
      subject: 'Invitation',
      html: '<p>Invite</p>',
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
        await pool.query("UPDATE profile_invitations SET status='Withdrawn' WHERE id=$1", [
          f.invitation,
        ]);
      return result;
    },
  };
  const request = vi.fn<typeof fetch>();
  await expect(
    new EmailNotificationTransport(deliveryPool, request).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'profile.invitation_received',
      payload: {},
      idempotencyKey: 'invite-key',
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
  'preserves an invitation %s provider receipt after withdrawal',
  async (status) => {
    const f = await invitationFixture(),
      execute = durableDelivery(pool, f.id, 'email', 'invite-receipt-key'),
      provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'invite-receipt')).toBe('invite-receipt');
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query("UPDATE profile_invitations SET status='Withdrawn' WHERE id=$1", [
      f.invitation,
    ]);
    const request = vi.fn<typeof fetch>(),
      result = new EmailNotificationTransport(pool, request).send({
        outboxId: f.id,
        profileId: null,
        recipientId: f.owner,
        channel: 'email',
        eventKey: 'profile.invitation_received',
        payload: {},
        idempotencyKey: 'invite-receipt-key',
      });
    if (status === 'accepted')
      await expect(result).resolves.toEqual({ status: 'delivered', providerRef: 'invite-receipt' });
    else await expect(result).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);
it.each(['customer'] as const)(
  'delivers a profile-less %s ticket email once with its active template and durable provider receipt',
  async () => {
    const f = await invitationFixture();
    await pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.owner]);
    await pool.query("UPDATE email_provider_configs SET status='disabled' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Controlled ticket test','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' }), f.owner]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
 VALUES('profile.invitation_received','email','en','Invitation {{entityName}}','<p>Invite for {{entityName}}</p>','["entityName"]','active',true,$1) ON CONFLICT DO NOTHING`,
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
      eventKey: 'profile.invitation_received',
      payload: { entityName: 'Example entity' },
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
      subject: 'Invitation Example entity',
      html: expect.stringContaining(`<p>Invite for ${'Example entity'}</p>`),
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

async function roleFixture() {
  const f = await fixture('profile.agent_role_changed'),
    audit = randomUUID();
  await pool.query("UPDATE profiles SET user_id=$2,profile_type='LEGAL' WHERE id=$1", [
    f.profile,
    f.next,
  ]);
  await pool.query(
    "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,'agent_removed',$3,$1)",
    [
      audit,
      f.next,
      JSON.stringify({
        profileId: f.profile,
        targetUserId: f.owner,
        before: ['Manager'],
        after: [],
      }),
    ]
  );
  await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
    f.id,
    { auditId: audit, entityName: 'Example entity', newRole: '—' },
  ]);
  await pool.query(
    "UPDATE in_app_notifications SET profile_id=NULL,link_route='/dashboard' WHERE delivery_key='outbox:'||$1::text",
    [f.id]
  );
  return { ...f, audit };
}
it('keeps role-removal delivery private after membership and credentials are gone', async () => {
  const f = await roleFixture();
  expect(
    (
      await pool.query('SELECT * FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
        f.profile,
        f.owner,
      ])
    ).rows
  ).toEqual([]);
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: null,
    email: `${f.owner}@example.test`,
  });
  await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.owner]);
  await pool.query("DELETE FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
    f.id,
  ]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
});
it.each(['archive', 'disabled', 'activation'] as const)(
  'checks current role notice recipient after %s',
  async (change) => {
    const f = await roleFixture(),
      before = await loadNotificationRecipient(pool, f.id);
    expect(before).toMatchObject({ userId: f.owner, profileId: null });
    if (change === 'archive')
      await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
    else if (change === 'disabled')
      await pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.owner]);
    else
      await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
        f.owner,
        randomUUID(),
      ]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
    await expect(
      assertNotificationRecipientAvailable(
        pool,
        f.id,
        'profile.agent_role_changed',
        'email',
        before!
      )
    ).rejects.toThrow('recipient changed');
  }
);
it.each(['customer'] as const)(
  'delivers a account-private role-removal email (%s) once with its active template and durable provider receipt',
  async () => {
    const f = await roleFixture();
    await pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.owner]);
    await pool.query("UPDATE email_provider_configs SET status='disabled' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Controlled role test','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' }), f.owner]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
 VALUES('profile.agent_role_changed','email','en','Roles {{entityName}}','<p>Roles {{newRole}} at {{entityName}}</p>','["entityName","newRole"]','active',true,$1) ON CONFLICT DO NOTHING`,
      [f.owner]
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'role-email-receipt' }), {
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
      eventKey: 'profile.agent_role_changed',
      payload: { entityName: 'Example entity', newRole: '—' },
      idempotencyKey: `role-provider:${f.id}`,
    };
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'role-email-receipt',
    });
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'role-email-receipt',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({
      to: [`${f.owner}@example.test`],
      subject: 'Roles Example entity',
      html: expect.stringContaining('<p>Roles — at Example entity</p>'),
    });
    expect(JSON.stringify(sent)).not.toContain('Private conversation');
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref FROM notification_send_receipts WHERE outbox_id=$1',
          [f.id]
        )
      ).rows
    ).toEqual([{ status: 'accepted', provider_ref: 'role-email-receipt' }]);
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
it.each(['accepted', 'unknown'] as const)(
  'preserves a role-change %s provider receipt after archive',
  async (status) => {
    const f = await roleFixture(),
      execute = durableDelivery(pool, f.id, 'email', 'role-receipt-key'),
      provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'role-receipt')).toBe('role-receipt');
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
    const request = vi.fn<typeof fetch>(),
      result = new EmailNotificationTransport(pool, request).send({
        outboxId: f.id,
        profileId: null,
        recipientId: f.owner,
        channel: 'email',
        eventKey: 'profile.agent_role_changed',
        payload: {},
        idempotencyKey: 'role-receipt-key',
      });
    if (status === 'accepted')
      await expect(result).resolves.toEqual({ status: 'delivered', providerRef: 'role-receipt' });
    else await expect(result).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);
it('rechecks role profile archive after rendering before the provider call', async () => {
  const f = await roleFixture(),
    snapshot = {
      version: 1,
      userId: f.owner,
      profileId: null,
      idempotencyKey: 'invite-key',
      destination: `${f.owner}@example.test`,
      subject: 'Invitation',
      html: '<p>Invite</p>',
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
        await pool.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profile]);
      return result;
    },
  };
  const request = vi.fn<typeof fetch>();
  await expect(
    new EmailNotificationTransport(deliveryPool, request).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'profile.agent_role_changed',
      payload: {},
      idempotencyKey: 'invite-key',
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

async function passwordFixture(event = 'password_changed') {
  const f = await fixture('auth.password_changed', 'account'),
    audit = randomUUID();
  await pool.query('INSERT INTO audit_log(id,user_id,event,correlation_id) VALUES($1,$2,$3,$1)', [
    audit,
    f.owner,
    event,
  ]);
  await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
    f.id,
    { auditId: audit, link_route: '/settings/security' },
  ]);
  await pool.query(
    "UPDATE in_app_notifications SET profile_id=NULL,link_route='/settings/security' WHERE delivery_key='outbox:'||$1::text",
    [f.id]
  );
  return { ...f, audit };
}
it.each(['password_changed', 'password_reset'])(
  'resolves %s confirmations privately at account scope without profile membership',
  async (event) => {
    const f = await passwordFixture(event);
    await pool.query('UPDATE profiles SET user_id=$2,archived=true WHERE id=$1', [
      f.profile,
      f.next,
    ]);
    expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
      userId: f.owner,
      profileId: null,
      email: `${f.owner}@example.test`,
    });
    await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.next]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
    await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.owner]);
    await pool.query(
      "UPDATE in_app_notifications SET operating_context='customer' WHERE delivery_key='outbox:'||$1::text",
      [f.id]
    );
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  }
);
it.each(['disabled', 'activation', 'inbox', 'contact'] as const)(
  'checks password confirmation privacy after %s changes',
  async (change) => {
    const f = await passwordFixture(),
      before = await loadNotificationRecipient(pool, f.id);
    expect(before).toMatchObject({ userId: f.owner, profileId: null });
    if (change === 'disabled')
      await pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.owner]);
    else if (change === 'activation')
      await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
        f.owner,
        randomUUID(),
      ]);
    else if (change === 'inbox')
      await pool.query("DELETE FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
        f.id,
      ]);
    else
      await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
        f.owner,
        `${randomUUID()}@example.test`,
      ]);
    await expect(
      assertNotificationRecipientAvailable(pool, f.id, 'auth.password_changed', 'email', before!)
    ).rejects.toThrow('recipient changed');
  }
);
it('preserves the password inbox content/read receipt after account activation changes', async () => {
  const f = await passwordFixture();
  await pool.query(
    "UPDATE in_app_notifications SET is_read=true,read_at=NOW() WHERE delivery_key='outbox:'||$1::text",
    [f.id]
  );
  const before = (
    await pool.query("SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
      f.id,
    ])
  ).rows;
  await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
    f.owner,
    randomUUID(),
  ]);
  await expect(
    new InAppNotificationTransport(pool).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      eventKey: 'auth.password_changed',
      channel: 'in_app',
      payload: { auditId: f.audit, link_route: '/settings/security' },
      idempotencyKey: 'retained-password',
    })
  ).resolves.toEqual({ status: 'delivered', providerRef: before[0].id });
  expect(
    (
      await pool.query(
        "SELECT * FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text",
        [f.id]
      )
    ).rows
  ).toEqual(before);
});
it.each(['customer'] as const)(
  'delivers a account-private password confirmation email (%s) once with its active template and durable provider receipt',
  async () => {
    const f = await passwordFixture();
    await pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.owner]);
    await pool.query("UPDATE email_provider_configs SET status='disabled' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Controlled password test','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' }), f.owner]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
 VALUES('auth.password_changed','email','en','Password changed','<p>Your password changed</p>','[]','active',true,$1) ON CONFLICT DO NOTHING`,
      [f.owner]
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'password-email-receipt' }), {
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
      eventKey: 'auth.password_changed',
      payload: { auditId: f.audit },
      idempotencyKey: `password-provider:${f.id}`,
    };
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'password-email-receipt',
    });
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'password-email-receipt',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({
      to: [`${f.owner}@example.test`],
      subject: 'Password changed',
      html: expect.stringContaining('<p>Your password changed</p>'),
    });
    expect(JSON.stringify(sent)).not.toContain('Private conversation');
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref FROM notification_send_receipts WHERE outbox_id=$1',
          [f.id]
        )
      ).rows
    ).toEqual([{ status: 'accepted', provider_ref: 'password-email-receipt' }]);
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
it.each(['accepted', 'unknown'] as const)(
  'preserves a password confirmation %s provider receipt after activation',
  async (status) => {
    const f = await passwordFixture(),
      execute = durableDelivery(pool, f.id, 'email', 'role-receipt-key'),
      provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'role-receipt')).toBe('role-receipt');
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
      f.owner,
      randomUUID(),
    ]);
    const request = vi.fn<typeof fetch>(),
      result = new EmailNotificationTransport(pool, request).send({
        outboxId: f.id,
        profileId: null,
        recipientId: f.owner,
        channel: 'email',
        eventKey: 'auth.password_changed',
        payload: {},
        idempotencyKey: 'role-receipt-key',
      });
    if (status === 'accepted')
      await expect(result).resolves.toEqual({ status: 'delivered', providerRef: 'role-receipt' });
    else await expect(result).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);
it('rechecks password contact change after rendering before the provider call', async () => {
  const f = await passwordFixture(),
    snapshot = {
      version: 1,
      userId: f.owner,
      profileId: null,
      idempotencyKey: 'invite-key',
      destination: `${f.owner}@example.test`,
      subject: 'Invitation',
      html: '<p>Invite</p>',
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
        await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
          f.owner,
          `${randomUUID()}@example.test`,
        ]);
      return result;
    },
  };
  const request = vi.fn<typeof fetch>();
  await expect(
    new EmailNotificationTransport(deliveryPool, request).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'auth.password_changed',
      payload: {},
      idempotencyKey: 'invite-key',
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

async function sessionFixture(staff = false, count = 1) {
  const f = await fixture('auth.session_revoked', 'account'),
    audit = randomUUID();
  await pool.query(
    'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,$3,$4,$1)',
    [
      audit,
      staff ? f.next : f.owner,
      staff ? 'expire_sessions' : 'sessions_revoked',
      JSON.stringify(staff ? { targetUserId: f.owner } : { changedSessionCount: count }),
    ]
  );
  await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
    f.id,
    { auditId: audit, link_route: '/settings/security' },
  ]);
  await pool.query(
    "UPDATE in_app_notifications SET profile_id=NULL,link_route='/settings/security' WHERE delivery_key='outbox:'||$1::text",
    [f.id]
  );
  return { ...f, audit };
}
it.each([false, true])(
  'binds private session revocation to its actual audit target,staff=%s',
  async (staff) => {
    const f = await sessionFixture(staff);
    await pool.query('UPDATE profiles SET user_id=$2,archived=true WHERE id=$1', [
      f.profile,
      f.next,
    ]);
    expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
      userId: f.owner,
      profileId: null,
      email: `${f.owner}@example.test`,
    });
    await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.next]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  }
);
it('rejects a no-op self revocation audit as a new security delivery', async () => {
  const f = await sessionFixture(false, 0);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
});
it.each(['disabled', 'activation', 'inbox', 'contact'] as const)(
  'checks session confirmation privacy after %s changes',
  async (change) => {
    const f = await sessionFixture(),
      before = await loadNotificationRecipient(pool, f.id);
    expect(before).toMatchObject({ userId: f.owner, profileId: null });
    if (change === 'disabled')
      await pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.owner]);
    else if (change === 'activation')
      await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
        f.owner,
        randomUUID(),
      ]);
    else if (change === 'inbox')
      await pool.query("DELETE FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
        f.id,
      ]);
    else
      await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
        f.owner,
        `${randomUUID()}@example.test`,
      ]);
    await expect(
      assertNotificationRecipientAvailable(pool, f.id, 'auth.session_revoked', 'email', before!)
    ).rejects.toThrow('recipient changed');
  }
);
it.each(['customer'] as const)(
  'delivers a account-private session confirmation email (%s) once with its active template and durable provider receipt',
  async () => {
    const f = await sessionFixture();
    await pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.owner]);
    await pool.query("UPDATE email_provider_configs SET status='disabled' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Controlled session test','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' }), f.owner]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
 VALUES('auth.session_revoked','email','en','Sessions revoked','<p>Your sessions were revoked</p>','[]','active',true,$1) ON CONFLICT DO NOTHING`,
      [f.owner]
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'session-email-receipt' }), {
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
      eventKey: 'auth.session_revoked',
      payload: { auditId: f.audit },
      idempotencyKey: `session-provider:${f.id}`,
    };
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'session-email-receipt',
    });
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'session-email-receipt',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({
      to: [`${f.owner}@example.test`],
      subject: 'Sessions revoked',
      html: expect.stringContaining('<p>Your sessions were revoked</p>'),
    });
    expect(JSON.stringify(sent)).not.toContain('Private conversation');
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref FROM notification_send_receipts WHERE outbox_id=$1',
          [f.id]
        )
      ).rows
    ).toEqual([{ status: 'accepted', provider_ref: 'session-email-receipt' }]);
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
it.each(['accepted', 'unknown'] as const)(
  'preserves a session confirmation %s provider receipt after activation',
  async (status) => {
    const f = await sessionFixture(),
      execute = durableDelivery(pool, f.id, 'email', 'role-receipt-key'),
      provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'role-receipt')).toBe('role-receipt');
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
      f.owner,
      randomUUID(),
    ]);
    const request = vi.fn<typeof fetch>(),
      result = new EmailNotificationTransport(pool, request).send({
        outboxId: f.id,
        profileId: null,
        recipientId: f.owner,
        channel: 'email',
        eventKey: 'auth.session_revoked',
        payload: {},
        idempotencyKey: 'role-receipt-key',
      });
    if (status === 'accepted')
      await expect(result).resolves.toEqual({ status: 'delivered', providerRef: 'role-receipt' });
    else await expect(result).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);
it('rechecks session contact change after rendering before the provider call', async () => {
  const f = await sessionFixture(),
    snapshot = {
      version: 1,
      userId: f.owner,
      profileId: null,
      idempotencyKey: 'invite-key',
      destination: `${f.owner}@example.test`,
      subject: 'Invitation',
      html: '<p>Invite</p>',
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
        await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
          f.owner,
          `${randomUUID()}@example.test`,
        ]);
      return result;
    },
  };
  const request = vi.fn<typeof fetch>();
  await expect(
    new EmailNotificationTransport(deliveryPool, request).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'auth.session_revoked',
      payload: {},
      idempotencyKey: 'invite-key',
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

it.each(['logout', 'session_cap', 'family'])(
  'resolves the %s lifecycle audit privately and rejects foreign/zero-transition recipients',
  async (reason) => {
    const f = await fixture('auth.session_revoked', 'account'),
      audit = randomUUID();
    await pool.query(
      "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,'session_lifecycle_revoked',$3,$1)",
      [audit, f.owner, JSON.stringify({ reason, changedSessionCount: 1 })]
    );
    await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
      f.id,
      { auditId: audit, link_route: '/settings/security' },
    ]);
    await pool.query(
      "UPDATE in_app_notifications SET profile_id=NULL,link_route='/settings/security' WHERE delivery_key='outbox:'||$1::text",
      [f.id]
    );
    expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
      userId: f.owner,
      profileId: null,
      email: `${f.owner}@example.test`,
    });
    await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.next]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
    const zero = randomUUID();
    await pool.query(
      "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,'session_lifecycle_revoked',$3,$1)",
      [zero, f.owner, JSON.stringify({ reason, changedSessionCount: 0 })]
    );
    await pool.query('UPDATE notification_outbox SET user_id=$2,payload=$3 WHERE id=$1', [
      f.id,
      f.owner,
      { auditId: zero, link_route: '/settings/security' },
    ]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  }
);

it.each(['force_password_change', 'invitation_accepted', 'profile_closure_executed'])(
  'binds the %s bulk parent audit to its actual private recipient',
  async (event) => {
    const f = await fixture('auth.session_revoked', 'account'),
      audit = randomUUID(),
      metadata =
        event === 'force_password_change'
          ? { targetUserId: f.owner }
          : event === 'profile_closure_executed'
            ? { ownerUserId: f.owner }
            : {};
    await pool.query(
      'INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,$3,$4,$1)',
      [audit, event === 'invitation_accepted' ? f.owner : f.next, event, JSON.stringify(metadata)]
    );
    await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
      f.id,
      { auditId: audit, link_route: '/settings/security' },
    ]);
    await pool.query(
      "UPDATE in_app_notifications SET profile_id=NULL,link_route='/settings/security' WHERE delivery_key='outbox:'||$1::text",
      [f.id]
    );
    await pool.query('UPDATE profiles SET user_id=$2,archived=true WHERE id=$1', [
      f.profile,
      f.next,
    ]);
    expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
      userId: f.owner,
      profileId: null,
      email: `${f.owner}@example.test`,
    });
    await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.next]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  }
);

async function refreshReuseFixture() {
  const f = await fixture('auth.refresh_token_reused', 'account');
  const inbox = (
    await pool.query(
      "UPDATE in_app_notifications SET profile_id=NULL,delivery_key=$2,link_route='/settings/security' WHERE delivery_key='outbox:'||$1::text RETURNING id",
      [f.id, `session-reuse:${randomUUID()}`]
    )
  ).rows[0].id;
  await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
    f.id,
    { inboxId: inbox, link_route: '/settings/security' },
  ]);
  await pool.query(
    "UPDATE notification_job SET status='done',attempts=1,provider_ref=$2 WHERE outbox_id=$1 AND channel='in_app'",
    [f.id, inbox]
  );
  await pool.query(
    "INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref) VALUES($1,'in_app','delivered',1,$2)",
    [f.id, inbox]
  );
  return { ...f, inbox };
}
it('binds refresh reuse delivery to the original private warning despite incidental profile changes', async () => {
  const f = await refreshReuseFixture();
  await pool.query('UPDATE profiles SET user_id=$2,archived=true WHERE id=$1', [f.profile, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: null,
    email: `${f.owner}@example.test`,
  });
  await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
});
it.each(['disabled', 'activation', 'inbox', 'context', 'key', 'job', 'history'] as const)(
  'denies new refresh warning delivery after %s changes',
  async (change) => {
    const f = await refreshReuseFixture();
    expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
      userId: f.owner,
      profileId: null,
    });
    if (change === 'disabled')
      await pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.owner]);
    else if (change === 'activation')
      await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
        f.owner,
        randomUUID(),
      ]);
    else if (change === 'inbox')
      await pool.query('DELETE FROM in_app_notifications WHERE id=$1', [f.inbox]);
    else if (change === 'context')
      await pool.query("UPDATE in_app_notifications SET operating_context='customer' WHERE id=$1", [
        f.inbox,
      ]);
    else if (change === 'key')
      await pool.query('UPDATE in_app_notifications SET delivery_key=$2 WHERE id=$1', [
        f.inbox,
        randomUUID(),
      ]);
    else if (change === 'job')
      await pool.query(
        "UPDATE notification_job SET provider_ref=$2 WHERE outbox_id=$1 AND channel='in_app'",
        [f.id, randomUUID()]
      );
    else await pool.query('DELETE FROM notification_delivery_log WHERE notification_id=$1', [f.id]);
    expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
  }
);
it.each(['customer'] as const)(
  'delivers a account-private refresh reuse warning email (%s) once with its active template and durable provider receipt',
  async () => {
    const f = await refreshReuseFixture();
    await pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.owner]);
    await pool.query("UPDATE email_provider_configs SET status='disabled' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Controlled session test','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' }), f.owner]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
 VALUES('auth.refresh_token_reused','email','en','Refresh token reused','<p>Review your sessions</p>','[]','active',true,$1) ON CONFLICT DO NOTHING`,
      [f.owner]
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'session-email-receipt' }), {
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
      eventKey: 'auth.refresh_token_reused',
      payload: { inboxId: f.inbox },
      idempotencyKey: `session-provider:${f.id}`,
    };
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'session-email-receipt',
    });
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'session-email-receipt',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({
      to: [`${f.owner}@example.test`],
      subject: 'Refresh token reused',
      html: expect.stringContaining('<p>Review your sessions</p>'),
    });
    expect(JSON.stringify(sent)).not.toContain('Private conversation');
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref FROM notification_send_receipts WHERE outbox_id=$1',
          [f.id]
        )
      ).rows
    ).toEqual([{ status: 'accepted', provider_ref: 'session-email-receipt' }]);
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
it.each(['accepted', 'unknown'] as const)(
  'preserves a refresh reuse warning %s provider receipt after activation',
  async (status) => {
    const f = await refreshReuseFixture(),
      execute = durableDelivery(pool, f.id, 'email', 'role-receipt-key'),
      provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'role-receipt')).toBe('role-receipt');
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
      f.owner,
      randomUUID(),
    ]);
    const request = vi.fn<typeof fetch>(),
      result = new EmailNotificationTransport(pool, request).send({
        outboxId: f.id,
        profileId: null,
        recipientId: f.owner,
        channel: 'email',
        eventKey: 'auth.refresh_token_reused',
        payload: {},
        idempotencyKey: 'role-receipt-key',
      });
    if (status === 'accepted')
      await expect(result).resolves.toEqual({ status: 'delivered', providerRef: 'role-receipt' });
    else await expect(result).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);
it('rechecks refresh warning contact change after rendering before the provider call', async () => {
  const f = await refreshReuseFixture(),
    snapshot = {
      version: 1,
      userId: f.owner,
      profileId: null,
      idempotencyKey: 'invite-key',
      destination: `${f.owner}@example.test`,
      subject: 'Invitation',
      html: '<p>Invite</p>',
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
        await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
          f.owner,
          `${randomUUID()}@example.test`,
        ]);
      return result;
    },
  };
  const request = vi.fn<typeof fetch>();
  await expect(
    new EmailNotificationTransport(deliveryPool, request).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'auth.refresh_token_reused',
      payload: {},
      idempotencyKey: 'invite-key',
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

async function newDeviceFixture(valid = true) {
  const f = await fixture('auth.new_device_login', 'account'),
    audit = randomUUID();
  await pool.query(
    "INSERT INTO audit_log(id,user_id,event,metadata,correlation_id) VALUES($1,$2,'new_device_login',$3,$1)",
    [audit, f.owner, JSON.stringify({ unrecognizedDevice: valid })]
  );
  await pool.query('UPDATE notification_outbox SET profile_id=NULL,payload=$2 WHERE id=$1', [
    f.id,
    { auditId: audit, link_route: '/settings/security' },
  ]);
  await pool.query(
    "UPDATE in_app_notifications SET profile_id=NULL,link_route='/settings/security' WHERE delivery_key='outbox:'||$1::text",
    [f.id]
  );
  return { ...f, audit };
}
it('keeps new device warnings bound to the original account across profile changes', async () => {
  const f = await newDeviceFixture();
  await pool.query('UPDATE profiles SET user_id=$2,archived=true WHERE id=$1', [f.profile, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toMatchObject({
    userId: f.owner,
    profileId: null,
  });
  await pool.query('UPDATE notification_outbox SET user_id=$2 WHERE id=$1', [f.id, f.next]);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
});
it('rejects a recognized device audit as a new device security notice', async () => {
  const f = await newDeviceFixture(false);
  expect(await loadNotificationRecipient(pool, f.id)).toBeNull();
});
it.each(['disabled', 'activation', 'inbox', 'contact'] as const)(
  'checks new device login privacy after %s changes',
  async (change) => {
    const f = await newDeviceFixture(),
      before = await loadNotificationRecipient(pool, f.id);
    expect(before).toMatchObject({ userId: f.owner, profileId: null });
    if (change === 'disabled')
      await pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [f.owner]);
    else if (change === 'activation')
      await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
        f.owner,
        randomUUID(),
      ]);
    else if (change === 'inbox')
      await pool.query("DELETE FROM in_app_notifications WHERE delivery_key='outbox:'||$1::text", [
        f.id,
      ]);
    else
      await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
        f.owner,
        `${randomUUID()}@example.test`,
      ]);
    await expect(
      assertNotificationRecipientAvailable(pool, f.id, 'auth.new_device_login', 'email', before!)
    ).rejects.toThrow('recipient changed');
  }
);
it.each(['customer'] as const)(
  'delivers a account-private new device login email (%s) once with its active template and durable provider receipt',
  async () => {
    const f = await newDeviceFixture();
    await pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.owner]);
    await pool.query("UPDATE email_provider_configs SET status='disabled' WHERE status='active'");
    await pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
 VALUES('resend','Controlled session test','active',$1,$2,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'local-test-only', from_email: 'sender@example.test' }), f.owner]
    );
    await pool.query(
      `INSERT INTO notification_templates(event_key,channel,locale,subject,body_template,variables,status,is_active,created_by)
 VALUES('auth.new_device_login','email','en','New device sign-in','<p>Review your sign-in</p>','[]','active',true,$1) ON CONFLICT DO NOTHING`,
      [f.owner]
    );
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'session-email-receipt' }), {
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
      eventKey: 'auth.new_device_login',
      payload: { auditId: f.audit },
      idempotencyKey: `session-provider:${f.id}`,
    };
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'session-email-receipt',
    });
    await expect(transport.send(payload)).resolves.toEqual({
      status: 'delivered',
      providerRef: 'session-email-receipt',
    });
    expect(request).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(sent).toMatchObject({
      to: [`${f.owner}@example.test`],
      subject: 'New device sign-in',
      html: expect.stringContaining('<p>Review your sign-in</p>'),
    });
    expect(JSON.stringify(sent)).not.toContain('Private conversation');
    expect(
      (
        await pool.query(
          'SELECT status,provider_ref FROM notification_send_receipts WHERE outbox_id=$1',
          [f.id]
        )
      ).rows
    ).toEqual([{ status: 'accepted', provider_ref: 'session-email-receipt' }]);
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
it.each(['accepted', 'unknown'] as const)(
  'preserves a new device login %s provider receipt after activation',
  async (status) => {
    const f = await newDeviceFixture(),
      execute = durableDelivery(pool, f.id, 'email', 'role-receipt-key'),
      provider = { id: randomUUID(), transport: 'smtp' as const };
    if (status === 'accepted')
      expect(await execute(provider, async () => 'role-receipt')).toBe('role-receipt');
    else
      await expect(
        execute(provider, async () => {
          throw new Error('timeout');
        })
      ).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    const before = (
      await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])
    ).rows;
    await pool.query('UPDATE users SET activation_token=$2 WHERE user_id=$1', [
      f.owner,
      randomUUID(),
    ]);
    const request = vi.fn<typeof fetch>(),
      result = new EmailNotificationTransport(pool, request).send({
        outboxId: f.id,
        profileId: null,
        recipientId: f.owner,
        channel: 'email',
        eventKey: 'auth.new_device_login',
        payload: {},
        idempotencyKey: 'role-receipt-key',
      });
    if (status === 'accepted')
      await expect(result).resolves.toEqual({ status: 'delivered', providerRef: 'role-receipt' });
    else await expect(result).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [f.id])).rows
    ).toEqual(before);
  }
);
it('rechecks new device login contact change after rendering before the provider call', async () => {
  const f = await newDeviceFixture(),
    snapshot = {
      version: 1,
      userId: f.owner,
      profileId: null,
      idempotencyKey: 'invite-key',
      destination: `${f.owner}@example.test`,
      subject: 'Invitation',
      html: '<p>Invite</p>',
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
        await pool.query('UPDATE users SET username=$2 WHERE user_id=$1', [
          f.owner,
          `${randomUUID()}@example.test`,
        ]);
      return result;
    },
  };
  const request = vi.fn<typeof fetch>();
  await expect(
    new EmailNotificationTransport(deliveryPool, request).send({
      outboxId: f.id,
      profileId: null,
      recipientId: f.owner,
      channel: 'email',
      eventKey: 'auth.new_device_login',
      payload: {},
      idempotencyKey: 'invite-key',
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
