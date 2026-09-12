import { buildSeedTemplates } from '../../../../packages/db/dist/seed/notification-templates.js';
import { runOutboxPoll } from '../../../worker/dist/notifications/outbox-runner.js';
import { EmailNotificationTransport } from '../../../worker/dist/notifications/email-transport.js';
import { SmsNotificationTransport } from '../../../worker/dist/notifications/sms-transport.js';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { CrmV2Service } from './crm-v2.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { SessionService } from '../session/session.service.js';
import type { VerificationStatusDto } from '../profiles/profiles.service.js';
const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => db.pool,
}));
let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const notifications = new NotificationsService();
const service = new CrmV2Service({} as SessionService, notifications);
const ownerSession = randomUUID(),
  ownerCsrf = randomUUID();
const ownerHeaders = { Cookie: `barghsa_session=${ownerSession}`, 'X-CSRF-Token': ownerCsrf };
beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  fixture = await startHttpFixture(process.env.TEST_DATABASE_URL);
  db.pool = fixture.pool;
  for (const user of ['verify-owner', 'verify-staff', 'verify-new-owner'])
    await db.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      user,
      `${user}@example.test`,
      'test-only',
    ]);
  await db.pool.query("UPDATE users SET is_admin=true WHERE user_id='verify-staff'");
  await db.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES($1,'verify-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [ownerSession, ownerCsrf, randomUUID()]
  );
}, 40000);
afterAll(async () => {
  await fixture?.close();
});
async function profile(status: string) {
  return (
    await db.pool.query(
      "INSERT INTO profiles(user_id,status,title) VALUES ($1,$2,'Main profile') RETURNING id",
      ['verify-owner', status]
    )
  ).rows[0].id as string;
}
async function state(id: string) {
  return (await db.pool.query('SELECT status FROM profiles WHERE id=$1', [id])).rows[0].status;
}
it.each(['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION'])(
  'verifies a %s profile and records bilingual notice/audit together',
  async (status) => {
    const id = await profile(status);
    expect(await service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '')).toMatchObject(
      {
        success: true,
        previousStatus: status,
        newStatus: 'VERIFIED',
      }
    );
    const notice = (
      await db.pool.query(
        'SELECT recipient_user_id,localized_content,link_route FROM in_app_notifications WHERE profile_id=$1',
        [id]
      )
    ).rows[0];
    expect(notice).toMatchObject({
      recipient_user_id: 'verify-owner',
      link_route: '/settings/profile',
      localized_content: {
        en: {
          title: 'Your profile was verified',
          body: 'A staff reviewer verified your profile "Main profile".',
        },
        fa: {
          title: 'پروفایل شما تأیید شد',
          body: 'پروفایل «Main profile» توسط کارشناس تأیید شد.',
        },
      },
    });
    const audit = (
      await db.pool.query(
        "SELECT metadata::jsonb AS data FROM audit_log WHERE event='verification_change' AND metadata::jsonb->>'profileId'=$1",
        [id]
      )
    ).rows[0].data;
    expect(audit).toMatchObject({
      previousStatus: status,
      newStatus: 'VERIFIED',
      profileOwnerUserId: 'verify-owner',
      action: 'verify',
    });
  }
);
it('serializes concurrent verification and writes one notice', async () => {
  const id = await profile('PENDING_VERIFICATION');
  await Promise.all(
    Array.from({ length: 8 }, () =>
      service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '')
    )
  );
  expect(
    (
      await db.pool.query(
        'SELECT count(*)::int AS count FROM in_app_notifications WHERE profile_id=$1',
        [id]
      )
    ).rows[0].count
  ).toBe(1);
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='verification_change' AND metadata::jsonb->>'profileId'=$1",
        [id]
      )
    ).rows[0].count
  ).toBe(1);
});
it.each([
  ['unverify', 'ACTIVE'],
  ['reverify', 'PENDING_VERIFICATION'],
] as const)(
  'applies %s with a reason and a durable pending/active notice',
  async (action, target) => {
    const id = await profile('VERIFIED');
    expect(
      await service.verifyProfile(
        id,
        { action, reason: 'Documents need review' },
        'verify-staff',
        ''
      )
    ).toMatchObject({ newStatus: target, reason: 'Documents need review' });
    expect(await state(id)).toBe(target);
    const notice = (
      await db.pool.query(
        'SELECT localized_content FROM in_app_notifications WHERE profile_id=$1',
        [id]
      )
    ).rows[0].localized_content;
    for (const lang of ['en', 'fa']) {
      expect(notice[lang].body).toContain('Main profile');
      expect(notice[lang].body).toContain('Documents need review');
    }
    expect(notice.en.body).toContain('correct the requested details');
    expect(notice.en.body).toContain('support ticket to request another review');
    expect(notice.fa.body).toContain('اطلاعات درخواست‌شده را اصلاح کنید');
    expect(notice.fa.body).toContain('برای بررسی دوباره، تیکت پشتیبانی ارسال کنید');
  }
);
it.each(['unverify', 'reverify'])('rejects %s without a reason', async (action) => {
  const id = await profile('VERIFIED');
  expect(await service.verifyProfile(id, { action }, 'verify-staff', '')).toHaveProperty('error');
  expect(await state(id)).toBe('VERIFIED');
});
it('rejects invalid actions/transitions and absent or archived profiles', async () => {
  const id = await profile('SUSPENDED');
  expect(await service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '')).toHaveProperty(
    'error'
  );
  expect(await service.verifyProfile(id, { action: 'invalid' }, 'verify-staff', '')).toHaveProperty(
    'error'
  );
  expect(
    await service.verifyProfile(
      await profile('DRAFT'),
      { action: 'unverify', reason: 'Review' },
      'verify-staff',
      ''
    )
  ).toHaveProperty('error');
  expect(
    await service.verifyProfile(randomUUID(), { action: 'verify' }, 'verify-staff', '')
  ).toBeNull();
  await db.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [id]);
  expect(await service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '')).toBeNull();
});
it('rolls back status and audit when the notice cannot be written', async () => {
  const id = await profile('PENDING_VERIFICATION');
  const fail = vi
    .spyOn(notifications, 'create')
    .mockRejectedValueOnce(new Error('controlled inbox failure'));
  try {
    await expect(
      service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '')
    ).rejects.toThrow('inbox failure');
  } finally {
    fail.mockRestore();
  }
  expect(await state(id)).toBe('PENDING_VERIFICATION');
  expect(
    (
      await db.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE metadata::jsonb->>'profileId'=$1",
        [id]
      )
    ).rows[0].count
  ).toBe(0);
});
it('resolves the owner after acquiring the profile lock', async () => {
  const id = await profile('PENDING_VERIFICATION'),
    client = await db.pool.connect();
  await client.query('BEGIN');
  await client.query("UPDATE profiles SET user_id='verify-new-owner' WHERE id=$1", [id]);
  const verifying = service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '');
  await client.query('COMMIT');
  client.release();
  expect(await verifying).toMatchObject({ success: true });
  expect(
    (
      await db.pool.query(
        'SELECT recipient_user_id FROM in_app_notifications WHERE profile_id=$1',
        [id]
      )
    ).rows[0].recipient_user_id
  ).toBe('verify-new-owner');
});

it('uses the individual name when the profile title is blank', async () => {
  const id = await profile('PENDING_VERIFICATION');
  await db.pool.query(
    "UPDATE profiles SET title=' ',first_name='Ada',last_name='Owner' WHERE id=$1",
    [id]
  );
  await service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '');
  const content = (
    await db.pool.query('SELECT localized_content FROM in_app_notifications WHERE profile_id=$1', [
      id,
    ])
  ).rows[0].localized_content;
  expect(content.en.body).toContain('Ada Owner');
  expect(content.fa.body).toContain('Ada Owner');
});

async function active(id: string) {
  await db.pool.query(
    `INSERT INTO user_profile_contexts(user_id,profile_id) VALUES('verify-owner',$1)
    ON CONFLICT(user_id) DO UPDATE SET profile_id=EXCLUDED.profile_id`,
    [id]
  );
}
async function banner() {
  const response = await fetch(fixture.base + '/api/profiles/verification-status', {
    headers: ownerHeaders,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as VerificationStatusDto;
}
it('returns the same current notice in the selected-profile banner and inbox, then clears it on read', async () => {
  const id = await profile('PENDING_VERIFICATION');
  await active(id);
  await service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '');
  const context = await banner();
  expect(context).toMatchObject({
    activeProfileId: id,
    isVerified: true,
    verificationNotice: {
      localizedContent: { en: { body: 'A staff reviewer verified your profile "Main profile".' } },
    },
  });
  const inbox = await fetch(fixture.base + '/api/v1/notifications?limit=20&filter=all', {
    headers: ownerHeaders,
  });
  expect(inbox.status).toBe(200);
  expect(((await inbox.json()) as { data: unknown[] }).data).toContainEqual(
    expect.objectContaining({
      id: context.verificationNotice!.id,
      localizedContent: context.verificationNotice!.localizedContent,
    })
  );
  // Reading the newest transition must not bring an older unread notice back.
  await service.verifyProfile(
    id,
    { action: 'reverify', reason: 'Correct document' },
    'verify-staff',
    ''
  );
  const newest = (await banner()).verificationNotice!;
  expect(newest.id).not.toBe(context.verificationNotice!.id);
  const read = await fetch(fixture.base + `/api/v1/notifications/${newest.id}/read`, {
    method: 'PATCH',
    headers: ownerHeaders,
  });
  expect(read.status).toBe(200);
  expect((await banner()).verificationNotice).toBeNull();
});
it('does not expose notices from another profile, recipient, previous owner or obsolete status', async () => {
  const id = await profile('PENDING_VERIFICATION'),
    other = await profile('ACTIVE');
  await service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '');
  await active(other);
  expect((await banner()).verificationNotice).toBeNull();
  await active(id);
  expect((await banner()).verificationNotice).not.toBeNull();
  await db.pool.query(
    "UPDATE in_app_notifications SET recipient_user_id='verify-new-owner' WHERE profile_id=$1",
    [id]
  );
  expect((await banner()).verificationNotice).toBeNull();
  await db.pool.query(
    "UPDATE in_app_notifications SET recipient_user_id='verify-owner' WHERE profile_id=$1",
    [id]
  );
  await db.pool.query("UPDATE profiles SET status='SUSPENDED' WHERE id=$1", [id]);
  expect((await banner()).verificationNotice).toBeNull();
  await db.pool.query(
    "UPDATE profiles SET status='VERIFIED',user_id='verify-new-owner' WHERE id=$1",
    [id]
  );
  expect((await banner()).verificationNotice).toBeNull();
});

for (const action of ['verify', 'unverify', 'reverify'] as const) {
  it(`queues ${action} email and SMS together with the in-app notice`, async () => {
    const id = await profile(action === 'verify' ? 'PENDING_VERIFICATION' : 'VERIFIED');
    await service.verifyProfile(
      id,
      { action, ...(action === 'verify' ? {} : { reason: 'Correct the registration number' }) },
      'verify-staff',
      ''
    );
    const rows = (
      await db.pool.query(
        'SELECT id,event_key,payload,channels,user_id FROM notification_outbox WHERE profile_id=$1',
        [id]
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_key: 'profile.verification_status',
      channels: ['email', 'sms'],
      user_id: 'verify-owner',
      payload: { profileName: 'Main profile' },
    });
    expect(rows[0].payload.messageEn).toContain('Main profile');
    if (action !== 'verify') {
      expect(rows[0].payload.messageEn).toContain('Correct the registration number');
      expect(rows[0].payload.messageEn).toContain('support ticket');
    }
    expect(
      (
        await db.pool.query(
          'SELECT channel,status FROM notification_job WHERE outbox_id=$1 ORDER BY channel',
          [rows[0].id]
        )
      ).rows
    ).toEqual([
      { channel: 'email', status: 'queued' },
      { channel: 'sms', status: 'queued' },
    ]);
    // Repeating the same status transition must not produce another delivery.
    await service.verifyProfile(
      id,
      { action, ...(action === 'verify' ? {} : { reason: 'Correct the registration number' }) },
      'verify-staff',
      ''
    );
    expect(
      (await db.pool.query('SELECT id FROM notification_outbox WHERE profile_id=$1', [id])).rows
    ).toHaveLength(1);
  });
}

it('rolls back verification, audit and inbox when external notice queuing fails', async () => {
  const id = await profile('PENDING_VERIFICATION');
  await db.pool
    .query(`CREATE FUNCTION fail_verification_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event_key='profile.verification_status' THEN RAISE EXCEPTION 'injected verification queue failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fail_verification_delivery BEFORE INSERT ON notification_outbox FOR EACH ROW EXECUTE FUNCTION fail_verification_delivery()`);
  try {
    await expect(
      service.verifyProfile(id, { action: 'verify' }, 'verify-staff', '')
    ).rejects.toThrow('injected verification queue failure');
  } finally {
    await db.pool.query('DROP TRIGGER fail_verification_delivery ON notification_outbox');
  }
  expect(await state(id)).toBe('PENDING_VERIFICATION');
  expect(
    (await db.pool.query('SELECT id FROM in_app_notifications WHERE profile_id=$1', [id])).rows
  ).toHaveLength(0);
  expect(
    (
      await db.pool.query(
        "SELECT id FROM audit_log WHERE event='verification_change' AND metadata::jsonb->>'profileId'=$1",
        [id]
      )
    ).rows
  ).toHaveLength(0);
});

for (const locale of ['fa', 'en'] as const) {
  for (const action of ['verify', 'unverify', 'reverify'] as const) {
    it(`delivers ${action} through real email/SMS transports in ${locale} with current preferences`, async () => {
      await db.pool.query(
        "UPDATE notification_outbox SET status='cancelled' WHERE status IN ('queued','scheduled','sending')"
      );
      const userId = randomUUID(),
        email = `${userId}@example.test`,
        phone = `+9891200000${locale === 'fa' ? '1' : '2'}${['verify', 'unverify', 'reverify'].indexOf(action)}`;
      await db.pool.query(
        "INSERT INTO users(user_id,username,email,mobile,password_hash,locale,notification_preferences) VALUES($1,$2,$2,$3,'fixture-only',$4,'EMAIL,SMS')",
        [userId, email, phone, locale]
      );
      await db.pool.query(
        "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES($2,$1,'mobile',NOW())",
        [userId, phone]
      );
      const id = (
        await db.pool.query(
          "INSERT INTO profiles(user_id,status,title) VALUES($1,$2,'Named verification profile') RETURNING id",
          [userId, action === 'verify' ? 'PENDING_VERIFICATION' : 'VERIFIED']
        )
      ).rows[0].id;
      const templates = buildSeedTemplates().filter(
        (t) => t.eventKey === 'profile.verification_status' && t.locale === locale
      );
      for (const t of templates) {
        await db.pool.query(
          "UPDATE notification_templates SET status='archived',is_active=false WHERE event_key=$1 AND channel=$2 AND locale=$3",
          [t.eventKey, t.channel, t.locale]
        );
        await db.pool.query(
          `INSERT INTO notification_templates(event_key,channel,locale,version,subject,body_template,variables,status,is_active)
          VALUES($1,$2,$3,(SELECT COALESCE(MAX(version),0)+1 FROM notification_templates WHERE event_key=$1 AND channel=$2 AND locale=$3),$4,$5,$6,'active',true)`,
          [t.eventKey, t.channel, t.locale, t.subject, t.bodyTemplate, JSON.stringify(t.variables)]
        );
      }
      await db.pool.query(
        "UPDATE email_provider_configs SET status='superseded' WHERE status='active'"
      );
      await db.pool.query(
        "UPDATE sms_provider_configs SET status='superseded' WHERE status='active'"
      );
      for (const channel of ['email', 'sms']) {
        const transport = channel === 'email' ? 'resend' : 'smsir';
        const config =
          channel === 'email'
            ? { api_key: 'fixture-only', from_email: 'sender@example.test' }
            : {
                api_key: 'fixture-only',
                sender: '3000',
                template_mappings: [
                  {
                    event_key: 'profile.verification_status',
                    locale,
                    template_id: locale === 'fa' ? '42' : '43',
                    variables: { [locale === 'fa' ? 'messageFa' : 'messageEn']: 'MESSAGE' },
                  },
                ],
              };
        await db.pool.query(
          `INSERT INTO ${channel === 'email' ? 'email_provider_configs' : 'sms_provider_configs'}(transport,label,status,config,created_by,last_test_status,last_test_at,delivery_verified_at,delivery_config_hash)
          VALUES($1,'Verification fixture','active',$2,$3,'passed',NOW(),NOW(),encode(sha256(convert_to(jsonb_build_array($1::text,$2::jsonb)::text,'UTF8')),'hex'))`,
          [transport, JSON.stringify(config), userId]
        );
      }
      const reason = 'Correct your registration number';
      await service.verifyProfile(
        id,
        { action, ...(action === 'verify' ? {} : { reason }) },
        'verify-staff',
        ''
      );
      const outbox = (
        await db.pool.query('SELECT id FROM notification_outbox WHERE profile_id=$1', [id])
      ).rows[0];
      expect(outbox).toBeDefined();
      const request = vi.fn<typeof fetch>(
        async (url) =>
          new Response(
            JSON.stringify(
              String(url).includes('sms.ir')
                ? { status: 1, data: { messageId: 123 } }
                : { id: randomUUID() }
            ),
            { status: 200 }
          )
      );
      const options = {
        pool: db.pool,
        deliveryWindow: { timezone: 'UTC', startHour: 0, endHour: 24 },
        transports: {
          email: new EmailNotificationTransport(db.pool, request),
          sms: new SmsNotificationTransport(db.pool, request),
        },
      };
      expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
      expect(request).toHaveBeenCalledTimes(2);
      const messages = request.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
      const mail = messages.find((m) => m.html),
        sms = messages.find((m) => m.TemplateId);
      expect(mail.to).toEqual([email]);
      expect(sms.TemplateId).toBe(locale === 'fa' ? 42 : 43);
      const text = sms.Parameters[0].Value;
      expect(text).toContain('Named verification profile');
      expect(mail.html).toContain('Named verification profile');
      expect(mail.html).not.toContain('{{');
      expect(text).toContain(locale === 'fa' ? 'پروفایل' : 'profile');
      if (action !== 'verify') {
        expect(text).toContain(reason);
        expect(mail.html).toContain(reason);
        expect(text).toContain(locale === 'fa' ? 'تیکت پشتیبانی' : 'support ticket');
      }
      expect(
        (await db.pool.query('SELECT id FROM in_app_notifications WHERE profile_id=$1', [id])).rows
      ).toHaveLength(1);
      expect(await runOutboxPoll(options)).toEqual({ leased: 0, delivered: 0, failed: 0 });
      expect(request).toHaveBeenCalledTimes(2);
      // A queued notice must honor a channel choice changed before dispatch.
      await service.verifyProfile(
        id,
        { action: action === 'verify' ? 'reverify' : 'verify', reason },
        'verify-staff',
        ''
      );
      await db.pool.query("UPDATE users SET notification_preferences='IN_APP' WHERE user_id=$1", [
        userId,
      ]);
      expect(await runOutboxPoll(options)).toEqual({ leased: 1, delivered: 1, failed: 0 });
      expect(request).toHaveBeenCalledTimes(2);
    });
  }
}
