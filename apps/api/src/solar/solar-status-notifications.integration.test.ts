import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import {
  expectSolarStatusDeliveries,
  expectSolarStatusRollback,
  solarDeliverySnapshot,
} from '../test/solar-status-notification-proof.js';
import { notifySolarStatus } from './solar-status-notifications.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>, profile: string, id: string;
const owner = randomUUID(),
  manager = randomUUID(),
  next = randomUUID(),
  session = randomUUID(),
  csrf = randomUUID();
const content = {
  title: 'Solar notice',
  localizedContent: {
    fa: { title: 'نیروگاه خورشیدی', body: 'وضعیت درخواست تغییر کرد.' },
    en: { title: 'Solar request', body: 'Status changed.' },
  },
};
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of [owner, manager, next])
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,'fixture')",
      [user, `${user}@example.test`]
    );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [session, owner, csrf, randomUUID()]
  );
  profile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES($1,'LEGAL','ACTIVE') RETURNING id",
      [owner]
    )
  ).rows[0].id;
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES($1,$2,'Manager')",
    [profile, manager]
  );
  id = (
    await http.pool.query(
      "INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,status,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at) VALUES($1,$2,$3,'submitted','building_apartment','off_grid','villa','steel','2020-01-01',true,'fixture','Fixture agreement',NOW()) RETURNING id",
      [profile, manager, randomUUID()]
    )
  ).rows[0].id;
}, 40000);
afterEach(async () => {
  await http?.close();
});
async function change(from: string, to: string, recipient?: string) {
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE solar_construction_requests SET status=$2 WHERE id=$1', [id, to]);
    await notifySolarStatus(client, id, from, to, content, recipient);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
it('rolls back all four native document-completion delivery sinks and recovers inside the actual request limit', async () => {
  const complete = () =>
    fetch(`${http.base}/api/solar/requests/${id}/documents/complete`, {
      method: 'POST',
      headers: {
        Cookie: `barghsa_session=${session}`,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ allDocumentsUploaded: true }),
    });
  await expectSolarStatusRollback(http.pool, id, 'documents_under_review', complete);
  expect((await complete()).status, http.logs()).toBe(200);
  await expectSolarStatusDeliveries(http.pool, id, owner, ['documents_under_review']);
  const before = await solarDeliverySnapshot(http.pool, id);
  expect((await complete()).status, http.logs()).toBe(200);
  expect(await solarDeliverySnapshot(http.pool, id)).toEqual(before);
});
it('uses the current owner and keeps an active original manager inbox-only', async () => {
  await http.pool.query('UPDATE profiles SET user_id=$2 WHERE id=$1', [profile, next]);
  await change('submitted', 'documents_under_review', manager);
  await expectSolarStatusDeliveries(http.pool, id, next, ['documents_under_review']);
  expect(
    (
      await http.pool.query(
        'SELECT recipient_user_id,type FROM in_app_notifications WHERE profile_id=$1 ORDER BY created_at,id',
        [profile]
      )
    ).rows
  ).toEqual([
    { recipient_user_id: next, type: 'order.status_changed' },
    { recipient_user_id: manager, type: 'general' },
  ]);
  expect(
    (
      await http.pool.query('SELECT * FROM in_app_notifications WHERE recipient_user_id=$1', [
        owner,
      ])
    ).rows
  ).toEqual([]);
});
it.each(['revoked', 'disabled'])(
  'omits a %s original manager from new private delivery',
  async (mode) => {
    if (mode === 'revoked')
      await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
        profile,
        manager,
      ]);
    else await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [manager]);
    await change('submitted', 'documents_under_review', manager);
    expect(
      (
        await http.pool.query('SELECT * FROM in_app_notifications WHERE recipient_user_id=$1', [
          manager,
        ])
      ).rows
    ).toEqual([]);
    await expectSolarStatusDeliveries(http.pool, id, owner, ['documents_under_review']);
  }
);
it('gives repeated real state cycles distinct occurrences and keeps same-state information separate', async () => {
  await change('submitted', 'documents_under_review');
  await change('documents_under_review', 'changes_requested');
  await change('changes_requested', 'documents_under_review');
  await expectSolarStatusDeliveries(http.pool, id, owner, [
    'documents_under_review',
    'changes_requested',
    'documents_under_review',
  ]);
  await change('documents_under_review', 'documents_under_review');
  expect(
    (
      await http.pool.query(
        'SELECT type FROM in_app_notifications WHERE profile_id=$1 ORDER BY created_at,id',
        [profile]
      )
    ).rows.map((r) => r.type)
  ).toEqual(['order.status_changed', 'order.status_changed', 'order.status_changed', 'general']);
});
it('rejects a mismatched saved status without an inbox or external intent', async () => {
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await expect(notifySolarStatus(client, id, 'submitted', 'approved', content)).rejects.toThrow(
      'saved status'
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  expect(
    (await http.pool.query('SELECT * FROM in_app_notifications WHERE profile_id=$1', [profile]))
      .rows
  ).toEqual([]);
  expect(
    (await http.pool.query('SELECT * FROM notification_outbox WHERE profile_id=$1', [profile])).rows
  ).toEqual([]);
});
