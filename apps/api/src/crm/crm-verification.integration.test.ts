import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
import { CrmV2Service } from './crm-v2.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { SessionService } from '../session/session.service.js';
const db = vi.hoisted(() => ({ pool: null as unknown as import('pg').Pool }));
vi.mock('@barghsa/db', async (original) => ({
  ...(await original<typeof import('@barghsa/db')>()),
  getDbPool: () => db.pool,
}));
let fixture: Awaited<ReturnType<typeof startHttpFixture>>;
const notifications = new NotificationsService();
const service = new CrmV2Service({} as SessionService, notifications);
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
}, 40000);
afterAll(async () => {
  await fixture?.close();
});
async function profile(status: string) {
  return (
    await db.pool.query('INSERT INTO profiles(user_id,status) VALUES ($1,$2) RETURNING id', [
      'verify-owner',
      status,
    ])
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
        en: { title: 'Your profile was verified' },
        fa: { title: 'پروفایل شما تأیید شد' },
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
