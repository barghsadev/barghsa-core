import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { createMigratedTestDb } from '../../../../packages/db/dist/test/migrated-db.js';
import { buildSeedTemplates } from '../../../../packages/db/dist/seed/notification-templates.js';
import { NotificationsService } from './notifications.service.js';
import { notifyNewDeviceLogin } from '../auth/session-notifications.js';
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  db = await createMigratedTestDb();
}, 40000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.pool.query(
    "UPDATE notification_templates SET status='archived',is_active=false WHERE is_active"
  );
});
const service = new NotificationsService();
const events = [
  'auth.password_changed',
  'auth.session_revoked',
  'auth.new_device_login',
  'profile.agent_role_changed',
  'profile.invitation_received',
  'ticket.new_reply',
  'ticket.assigned',
  'document.uploaded',
  'document.quarantined',
  'profile.verification_status',
  'payment.wallet_topup_completed',
  'payment.wallet_topup_failed',
] as const;
type Event = (typeof events)[number];
async function fixture(event: Event) {
  const user = randomUUID(),
    profile = randomUUID(),
    auditId = randomUUID(),
    invitationId = randomUUID();
  await db.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff,is_admin,notification_preferences) VALUES($1,$2,'fixture',true,true,'IN_APP,EMAIL')",
    [user, user + '@example.test']
  );
  await db.pool.query("INSERT INTO profiles(id,user_id,profile_type) VALUES($1,$2,'LEGAL')", [
    profile,
    user,
  ]);
  if (event === 'profile.invitation_received')
    await db.pool.query(
      "INSERT INTO profile_invitations(id,profile_id,username,role,invited_by,status,expires_at) VALUES($1,$2,$3,'Manager',$4,'Pending',now()+interval '1 day')",
      [invitationId, profile, user + '@example.test', user]
    );
  if (
    event === 'auth.password_changed' ||
    event === 'auth.session_revoked' ||
    event === 'profile.agent_role_changed'
  )
    await db.pool.query('INSERT INTO audit_log(id,user_id,event,metadata) VALUES($1,$2,$3,$4)', [
      auditId,
      user,
      event === 'auth.password_changed'
        ? 'password_changed'
        : event === 'auth.session_revoked'
          ? 'sessions_revoked'
          : 'agent_roles_changed',
      JSON.stringify({ changedSessionCount: 1, profileId: profile, targetUserId: user }),
    ]);
  const params = {
    userId: user,
    ...(event === 'document.uploaded' ? { profileId: profile } : {}),
    operatingContext: event.startsWith('auth.')
      ? ('account' as const)
      : event === 'ticket.assigned' || event === 'document.quarantined'
        ? ('staff' as const)
        : ('customer' as const),
    type: 'general' as const,
    title: 'Native title',
    localizedContent: {
      fa: { title: 'عنوان اصلی', body: 'پیام اصلی' },
      en: { title: 'Native title', body: 'Native message' },
    },
    link: '/wallet',
    occurrenceKey: `private-template:${randomUUID()}`,
  };
  const payload = {
    auditId,
    invitationId,
    entityName: 'Legal entity',
    newRole: 'Manager',
    inviteLink: '/settings/profile',
    ticketNumber: '9007199254740993',
    documentId: randomUUID(),
    documentName: 'customer.pdf',
    reason: 'Review required',
    amount: '9007199254740993',
    transactionId: randomUUID(),
  };
  const write = async (client: PoolClient) => {
    switch (event) {
      case 'auth.new_device_login':
        return notifyNewDeviceLogin(client, user);
      case 'auth.password_changed':
      case 'auth.session_revoked':
      case 'profile.agent_role_changed':
        return service.createAccountBusinessEvent({ ...params, eventKey: event, payload }, client);
      case 'profile.invitation_received':
        return service.createInvitationEvent({ ...params, eventKey: event, payload }, client);
      case 'ticket.new_reply':
      case 'ticket.assigned':
        return service.createTicketBusinessEvent({ ...params, eventKey: event, payload }, client);
      case 'document.uploaded':
      case 'document.quarantined':
        return service.createPrivateDocumentEvent({ ...params, eventKey: event, payload }, client);
      case 'profile.verification_status':
        return service.createVerification(
          {
            ...params,
            type: 'profile_verified',
            profileId: profile,
            profileName: 'Customer',
            status: 'Verified',
          },
          client
        );
      case 'payment.wallet_topup_completed':
      case 'payment.wallet_topup_failed': {
        const id = randomUUID();
        await client.query(
          "INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,status,idempotency_key) VALUES($1,$2,$3,$4,$5,ARRAY['in_app','email'],'queued',$6)",
          [id, profile, user, event, payload, params.occurrenceKey]
        );
        return service.create(
          { ...params, profileId: profile, operatingContext: 'customer' },
          client,
          { outboxId: id, eventKey: event }
        );
      }
    }
  };
  return { user, profile, event, params, payload, write };
}
async function template(
  event: Event,
  locale: string,
  body: string,
  variables: unknown,
  channel = 'in_app',
  subject: string | null = null
) {
  await db.pool.query(
    `INSERT INTO notification_templates(event_key,channel,locale,body_template,variables,status,is_active,version,subject)
    SELECT $1,$2,$3,$4,$5,'active',true,COALESCE(MAX(version),0)+1,$6 FROM notification_templates WHERE event_key=$1 AND channel=$2 AND locale=$3`,
    [event, channel, locale, body, JSON.stringify(variables), subject]
  );
}
async function transaction(work: (client: PoolClient) => Promise<unknown>) {
  const c = await db.pool.connect();
  try {
    await c.query('BEGIN');
    const r = await work(c);
    await c.query('COMMIT');
    return r;
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
}
async function allRows() {
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
  const outbox = (
    await db.pool.query('SELECT * FROM notification_outbox WHERE user_id=$1 AND event_key=$2', [
      f.user,
      f.event,
    ])
  ).rows;
  expect(outbox).toHaveLength(1);
  const o = outbox[0];
  const notices = (
    await db.pool.query(
      "SELECT * FROM in_app_notifications WHERE recipient_user_id=$1 AND (delivery_key='outbox:'||$2::text OR delivery_key='direct:'||split_part($3,':',2))",
      [f.user, o.id, o.idempotency_key]
    )
  ).rows;
  expect(notices).toHaveLength(1);
  const n = notices[0];
  expect(n.operating_context).toBe(
    f.event === 'profile.verification_status' || f.event.startsWith('payment.')
      ? 'customer'
      : f.params.operatingContext
  );
  expect(n.recipient_user_id).toBe(f.user);
  if (!f.event.startsWith('payment.') && f.event !== 'profile.verification_status') {
    expect(
      (
        await db.pool.query(
          "SELECT provider_ref,status,attempts FROM notification_job WHERE outbox_id=$1 AND channel='in_app'",
          [o.id]
        )
      ).rows
    ).toEqual([{ provider_ref: n.id, status: 'done', attempts: 1 }]);
    expect(
      (
        await db.pool.query(
          "SELECT provider_ref FROM notification_delivery_log WHERE notification_id=$1 AND channel='in_app' AND status='delivered'",
          [o.id]
        )
      ).rows
    ).toEqual([{ provider_ref: n.id }]);
  }
  return { outbox: o, inbox: n };
}
it.each(events)(
  'renders actual seeded fa/en in-app templates before private %s receipt',
  async (event) => {
    const f = await fixture(event),
      seeds = buildSeedTemplates().filter((t) => t.eventKey === event && t.channel === 'in_app');
    expect(seeds).toHaveLength(2);
    for (const seed of seeds) await template(event, seed.locale, seed.bodyTemplate, seed.variables);
    await transaction(f.write);
    const { outbox, inbox } = await manifest(f);
    expect(inbox.localized_content.fa.body).not.toContain('{{');
    expect(inbox.localized_content.en.body).not.toContain('{{');
    if (event === 'profile.verification_status') {
      // The verification seed intentionally preserves the native correction guidance.
      expect(inbox.localized_content).toEqual(f.params.localizedContent);
      expect(outbox.payload).toEqual({
        profileName: 'Customer',
        status: 'Verified',
        messageFa: f.params.localizedContent.fa.body,
        messageEn: f.params.localizedContent.en.body,
      });
    } else {
      expect(inbox.localized_content.fa.body).not.toBe(f.params.localizedContent.fa.body);
      expect(inbox.localized_content.en.body).not.toBe(f.params.localizedContent.en.body);
    }
    expect(JSON.stringify(inbox.localized_content)).not.toContain('password_hash');
    expect(JSON.stringify(inbox.localized_content)).not.toContain('auditId');
    if (event === 'auth.new_device_login') {
      const audit = (
        await db.pool.query('SELECT * FROM audit_log WHERE id=$1', [outbox.payload.auditId])
      ).rows[0];
      expect(outbox.payload.loginTime).toBe(audit.created_at.toISOString());
      expect(outbox.payload.device).toBe('دستگاه ناشناس / Unrecognized device');
      expect(Object.keys(outbox.payload).sort()).toEqual([
        'auditId',
        'device',
        'link_route',
        'loginTime',
      ]);
    }
  }
);
it.each([
  'auth.password_changed',
  'profile.invitation_received',
  'ticket.assigned',
  'document.quarantined',
] as const)(
  'retains private %s content/read/job/history on replay after template replacement',
  async (event) => {
    const f = await fixture(event);
    await template(event, 'en', 'First snapshot', []);
    await transaction(f.write);
    const first = await manifest(f);
    await db.pool.query('UPDATE in_app_notifications SET is_read=true,read_at=now() WHERE id=$1', [
      first.inbox.id,
    ]);
    await db.pool.query(
      "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key=$1 AND is_active",
      [event]
    );
    await template(event, 'en', 'Missing {{unavailable}}', ['unavailable']);
    const before = await allRows();
    expect(await transaction(f.write)).toBe(false);
    expect(await allRows()).toEqual(before);
  }
);
it.each([
  'auth.password_changed',
  'profile.invitation_received',
  'ticket.assigned',
  'document.quarantined',
  'profile.verification_status',
] as const)(
  'rolls the whole private %s business write back on incomplete template',
  async (event) => {
    const f = await fixture(event);
    await template(event, 'en', 'Missing {{unavailable}}', ['unavailable']);
    const before = await allRows();
    await expect(
      transaction(async (c) => {
        await c.query("UPDATE users SET notification_preferences='IN_APP' WHERE user_id=$1", [
          f.user,
        ]);
        await f.write(c);
      })
    ).rejects.toThrow('Inbox template data incomplete');
    expect(await allRows()).toEqual(before);
  }
);
it.each(['user', 'profile', 'event'] as const)(
  'rejects a foreign %s canonical payload before inbox storage',
  async (field) => {
    const f = await fixture('payment.wallet_topup_completed'),
      id = randomUUID();
    await db.pool.query(
      "INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,status,idempotency_key) VALUES($1,$2,$3,'payment.wallet_topup_completed',$4,ARRAY['in_app'],'queued',$5)",
      [id, f.profile, f.user, f.payload, randomUUID()]
    );
    const before = await allRows();
    const params = {
      ...f.params,
      operatingContext: 'customer' as const,
      userId: field === 'user' ? 'foreign-account' : f.user,
      profileId: field === 'profile' ? randomUUID() : f.profile,
    };
    await expect(
      transaction((c) =>
        service.create(params, c, {
          outboxId: id,
          eventKey:
            field === 'event' ? 'payment.wallet_topup_failed' : 'payment.wallet_topup_completed',
        })
      )
    ).rejects.toThrow('Native inbox requires its private canonical payload');
    expect(await allRows()).toEqual(before);
  }
);
it.each(['accepted', 'unknown'] as const)(
  'renders actual new-device email seed and preserves %s provider receipt after offboarding',
  async (status) => {
    const f = await fixture('auth.new_device_login');
    await db.pool.query("UPDATE users SET locale='en' WHERE user_id=$1", [f.user]);
    await transaction(f.write);
    const saved = await manifest(f),
      seed = buildSeedTemplates().find(
        (t) => t.eventKey === f.event && t.channel === 'email' && t.locale === 'en'
      )!;
    await template(f.event, 'en', seed.bodyTemplate, seed.variables, 'email', seed.subject);
    await db.pool.query(
      "UPDATE email_provider_configs SET status='disabled' WHERE status='active'"
    );
    await db.pool.query(
      `INSERT INTO email_provider_configs(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash) VALUES('resend','Private native test','active',$1,$2,'passed',now(),now(),encode(sha256(convert_to(jsonb_build_array('resend'::text,$1::jsonb)::text,'UTF8')),'hex'))`,
      [JSON.stringify({ api_key: 'test-only', from_email: 'sender@example.test' }), f.user]
    );
    const request = vi.fn<typeof fetch>();
    if (status === 'accepted')
      request.mockResolvedValue(
        new Response(JSON.stringify({ id: 'new-device-receipt' }), { status: 200 })
      );
    else request.mockRejectedValue(new Error('timeout'));
    const { DeliveryOutcomeUnknown } = createRequire(__filename)(
      resolve(__dirname, '../../../worker/dist/notifications/send-receipt.js')
    );
    const { EmailNotificationTransport } = createRequire(__filename)(
        resolve(__dirname, '../../../worker/dist/notifications/email-transport.js')
      ),
      transport = new EmailNotificationTransport(db.pool, request);
    const payload = {
      outboxId: saved.outbox.id,
      profileId: null,
      recipientId: f.user,
      eventKey: f.event,
      channel: 'email',
      payload: saved.outbox.payload,
      idempotencyKey: `new-device:${saved.outbox.id}`,
    };
    if (status === 'accepted')
      expect(await transport.send(payload)).toEqual({
        status: 'delivered',
        providerRef: 'new-device-receipt',
      });
    else await expect(transport.send(payload)).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).toHaveBeenCalledTimes(1);
    const body = String(request.mock.calls[0]![1]?.body);
    expect(body).toContain(saved.outbox.payload.loginTime);
    expect(body).toContain('Unrecognized device');
    expect(body).not.toContain('123456');
    expect(body).not.toContain('device_fingerprint');
    const receipt = (
      await db.pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [
        saved.outbox.id,
      ])
    ).rows;
    expect(receipt).toHaveLength(1);
    await db.pool.query('UPDATE users SET disabled_at=now() WHERE user_id=$1', [f.user]);
    if (status === 'accepted')
      expect(await transport.send(payload)).toEqual({
        status: 'delivered',
        providerRef: 'new-device-receipt',
      });
    else await expect(transport.send(payload)).rejects.toBeInstanceOf(DeliveryOutcomeUnknown);
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      (
        await db.pool.query('SELECT * FROM notification_send_receipts WHERE outbox_id=$1', [
          saved.outbox.id,
        ])
      ).rows
    ).toEqual(receipt);
    expect(
      (await db.pool.query('SELECT * FROM in_app_notifications WHERE id=$1', [saved.inbox.id])).rows
    ).toEqual([saved.inbox]);
  }
);

it('renders a custom verification template while retaining the original external message snapshot', async () => {
  const f = await fixture('profile.verification_status');
  await template(f.event, 'fa', '{{profileName}} / {{status}} / {{messageFa}}', [
    'profileName',
    'status',
    'messageFa',
  ]);
  await template(f.event, 'en', '{{profileName}} / {{status}} / {{messageEn}}', [
    'profileName',
    'status',
    'messageEn',
  ]);
  await transaction(f.write);
  const saved = await manifest(f);
  expect(saved.inbox.localized_content.fa.body).toBe(
    'Customer / Verified / ' + f.params.localizedContent.fa.body
  );
  expect(saved.inbox.localized_content.en.body).toBe(
    'Customer / Verified / ' + f.params.localizedContent.en.body
  );
  expect(saved.outbox.payload).toEqual({
    profileName: 'Customer',
    status: 'Verified',
    messageFa: f.params.localizedContent.fa.body,
    messageEn: f.params.localizedContent.en.body,
  });
  expect(saved.outbox.channels).toEqual(['email', 'sms']);
});

it.each([null, ['not an object'], 'not an object'])(
  'rolls back malformed canonical JSON %j without storing a private inbox',
  async (value) => {
    const f = await fixture('payment.wallet_topup_completed'),
      id = randomUUID();
    await db.pool.query(
      "INSERT INTO notification_outbox(id,profile_id,user_id,event_key,payload,channels,status,idempotency_key) VALUES($1,$2,$3,'payment.wallet_topup_completed',$4::jsonb,ARRAY['in_app'],'queued',$5)",
      [id, f.profile, f.user, JSON.stringify(value), randomUUID()]
    );
    const before = await allRows();
    await expect(
      transaction(async (c) => {
        await c.query("UPDATE users SET notification_preferences='IN_APP' WHERE user_id=$1", [
          f.user,
        ]);
        await service.create(
          { ...f.params, profileId: f.profile, operatingContext: 'customer' },
          c,
          { outboxId: id, eventKey: 'payment.wallet_topup_completed' }
        );
      })
    ).rejects.toThrow('Native inbox requires its private canonical payload');
    expect(await allRows()).toEqual(before);
  }
);
