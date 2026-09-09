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
