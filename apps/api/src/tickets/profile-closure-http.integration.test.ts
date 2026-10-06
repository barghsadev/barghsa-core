import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
let closureId: string;
let ownerSessionId: string;
const ownerHeaders: Record<string, string> = {};
const staffHeaders: Record<string, string> = {};

async function session(userId: string, headers: Record<string, string>, stepUp = false) {
  const sessionId = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
     VALUES($1,$2,$3,$4,now()+interval '1 day',now()+interval '30 minutes',
       CASE WHEN $5::boolean THEN now() ELSE NULL END)`,
    [sessionId, userId, csrf, randomUUID(), stepUp]
  );
  headers.Cookie = `barghsa_session=${sessionId}`;
  headers['X-CSRF-Token'] = csrf;
  headers['Content-Type'] = 'application/json';
  return sessionId;
}

const preview = () =>
  fetch(`${http.base}/api/staff/tickets/${closureId}/closure-preview`, { headers: staffHeaders });
const execute = (previewVersion: string) =>
  fetch(`${http.base}/api/staff/tickets/${closureId}/execute-closure`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({ previewVersion, confirmation: 'CLOSE_PROFILE' }),
  });

beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, 'http://127.0.0.1:9999');
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_admin)
     VALUES('closure-owner','closure-owner@example.test','test-only',false),
           ('closure-staff','closure-staff@example.test','test-only',true)`
  );
  ownerSessionId = await session('closure-owner', ownerHeaders);
  await session('closure-staff', staffHeaders, true);
  profileId = (
    await http.pool.query(
      `INSERT INTO profiles(user_id,profile_type,status,is_default,first_name,last_name,national_id,contact_email)
       VALUES('closure-owner','INDIVIDUAL','ACTIVE',true,'Private','Person','1234567890','private@example.test')
       RETURNING id`
    )
  ).rows[0].id as string;
  await http.pool.query(
    `INSERT INTO user_profile_contexts(user_id,profile_id) VALUES('closure-owner',$1)`,
    [profileId]
  );
  const provinceId = (
    await http.pool.query(
      `INSERT INTO provinces(name_fa,name_en) VALUES('استان','Province') RETURNING id`
    )
  ).rows[0].id as string;
  const cityId = (
    await http.pool.query(
      `INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر','City') RETURNING id`,
      [provinceId]
    )
  ).rows[0].id as string;
  await http.pool.query(
    `INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address)
     VALUES($1,$2,$3,'Private street','1234567890',true)`,
    [profileId, provinceId, cityId]
  );
  const created = await fetch(`${http.base}/api/tickets/lifecycle-requests`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ type: 'closure', idempotencyKey: randomUUID(), locale: 'en' }),
  });
  expect(created.status, http.logs()).toBe(201);
  closureId = ((await created.json()) as { ticketId: string }).ticketId;
}, 40000);

afterAll(async () => {
  await http?.close();
}, 15000);

it('requires a fresh dry-run, rejects blockers, and rolls back every effect on audit failure', async () => {
  expect(
    (
      await fetch(`${http.base}/api/staff/tickets/${closureId}/closure-preview`, {
        headers: ownerHeaders,
      })
    ).status
  ).toBe(403);
  const first = await preview();
  expect(first.status, http.logs()).toBe(200);
  const initial = (await first.json()) as { previewVersion: string; eligible: boolean };
  expect(initial.eligible).toBe(true);
  const hold = (
    await http.pool.query(
      `INSERT INTO document_legal_holds(profile_id,reason,initiated_by)
       VALUES($1,'Review','closure-staff') RETURNING id`,
      [profileId]
    )
  ).rows[0].id as string;
  expect((await execute(initial.previewVersion)).status).toBe(409);
  const blocked = (await (await preview()).json()) as { eligible: boolean };
  expect(blocked.eligible).toBe(false);
  await http.pool.query(
    `UPDATE document_legal_holds SET released_at=now(),released_by='closure-staff' WHERE id=$1`,
    [hold]
  );
  const ready = (await (await preview()).json()) as {
    previewVersion: string;
    eligible: boolean;
    anonymizeProfile: boolean;
  };
  expect(ready).toMatchObject({ eligible: true, anonymizeProfile: true });
  await http.pool.query(
    `UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='closure-staff'`
  );
  expect((await execute(ready.previewVersion)).status).toBe(403);
  await http.pool.query(
    `UPDATE sessions SET step_up_verified_at=now() WHERE user_id='closure-staff'`
  );
  await http.pool
    .query(`CREATE FUNCTION reject_closure_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='profile_closure_executed' THEN RAISE EXCEPTION 'audit unavailable'; END IF;
    RETURN NEW; END $$`);
  await http.pool.query(`CREATE TRIGGER reject_closure_audit BEFORE INSERT ON audit_log
    FOR EACH ROW EXECUTE FUNCTION reject_closure_audit()`);
  expect((await execute(ready.previewVersion)).status).toBeGreaterThanOrEqual(500);
  await http.pool.query('DROP TRIGGER reject_closure_audit ON audit_log');
  await http.pool.query('DROP FUNCTION reject_closure_audit()');
  const rolledBack = (
    await http.pool.query(
      `SELECT p.archived,p.first_name,t.privacy_closure_completed_at,s.revoked_at
       FROM profiles p JOIN tickets t ON t.profile_id=p.id
       JOIN sessions s ON s.user_id=p.user_id AND s.session_id=$2 WHERE p.id=$1 AND t.id=$3`,
      [profileId, ownerSessionId, closureId]
    )
  ).rows[0];
  expect(rolledBack).toMatchObject({
    archived: false,
    first_name: 'Private',
    privacy_closure_completed_at: null,
    revoked_at: null,
  });
});

it('closes once, redacts eligible profile fields, revokes sessions, and keeps support history', async () => {
  const ready = (await (await preview()).json()) as { previewVersion: string };
  const closed = await execute(ready.previewVersion);
  expect(closed.status, http.logs()).toBe(200);
  expect(await closed.json()).toMatchObject({
    created: true,
    anonymized: true,
    exportTicketId: null,
  });
  const replay = await execute(ready.previewVersion);
  expect(replay.status, http.logs()).toBe(200);
  expect(await replay.json()).toMatchObject({ created: false });
  const profile = (
    await http.pool.query(
      `SELECT archived,first_name,national_id,contact_email FROM profiles WHERE id=$1`,
      [profileId]
    )
  ).rows[0];
  expect(profile).toMatchObject({
    archived: true,
    first_name: null,
    national_id: null,
    contact_email: null,
  });
  expect(
    (
      await http.pool.query(`SELECT full_address,postal_code FROM addresses WHERE profile_id=$1`, [
        profileId,
      ])
    ).rows[0]
  ).toMatchObject({ full_address: '[redacted]', postal_code: '0000000000' });
  expect(
    (
      await http.pool.query(
        `SELECT profile_id FROM user_profile_contexts WHERE user_id='closure-owner'`
      )
    ).rows[0].profile_id
  ).toBeNull();
  expect(
    (await http.pool.query(`SELECT revoked_at FROM sessions WHERE session_id=$1`, [ownerSessionId]))
      .rows[0].revoked_at
  ).not.toBeNull();
  expect(
    (await fetch(`${http.base}/api/tickets/${closureId}`, { headers: ownerHeaders })).status
  ).toBe(401);
  await session('closure-owner', ownerHeaders);
  const ticket = await fetch(`${http.base}/api/tickets/${closureId}`, { headers: ownerHeaders });
  expect(ticket.status, http.logs()).toBe(200);
  expect(await ticket.json()).toMatchObject({ status: 'closed', privacyClosureAnonymized: true });
  expect(
    (
      await http.pool.query(
        `SELECT count(*)::int AS count FROM audit_log WHERE event='profile_closure_executed' AND user_id='closure-staff'`
      )
    ).rows[0].count
  ).toBe(1);
});

it('retains profile identity and a zero-balance wallet as linked financial history', async () => {
  const retainedProfileId = (
    await http.pool.query(
      `INSERT INTO profiles(user_id,profile_type,status,is_default,first_name)
       VALUES('closure-owner','INDIVIDUAL','ACTIVE',true,'Retained') RETURNING id`
    )
  ).rows[0].id as string;
  await http.pool.query(
    `UPDATE user_profile_contexts SET profile_id=$1 WHERE user_id='closure-owner'`,
    [retainedProfileId]
  );
  await http.pool.query(
    `INSERT INTO wallets(profile_id,posted_balance,reserved_balance) VALUES($1,0,0)`,
    [retainedProfileId]
  );
  const exportResponse = await fetch(`${http.base}/api/tickets/lifecycle-requests`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ type: 'export', idempotencyKey: randomUUID(), locale: 'en' }),
  });
  expect(exportResponse.status, http.logs()).toBe(201);
  const exportTicketId = ((await exportResponse.json()) as { ticketId: string }).ticketId;
  const created = await fetch(`${http.base}/api/tickets/lifecycle-requests`, {
    method: 'POST',
    headers: ownerHeaders,
    body: JSON.stringify({ type: 'closure', idempotencyKey: randomUUID(), locale: 'en' }),
  });
  expect(created.status, http.logs()).toBe(201);
  const id = ((await created.json()) as { ticketId: string }).ticketId;
  const pendingPreview = await fetch(`${http.base}/api/staff/tickets/${id}/closure-preview`, {
    headers: staffHeaders,
  });
  const pendingReview = (await pendingPreview.json()) as {
    eligible: boolean;
    previewVersion: string;
    blockers: unknown[];
  };
  expect(pendingReview.eligible).toBe(false);
  expect(pendingReview.blockers).toContainEqual({
    code: 'pendingExport',
    count: 1,
    owner: 'customer',
    nextStep: 'prepareExport',
  });
  const executeRetained = (version: string) =>
    fetch(`${http.base}/api/staff/tickets/${id}/execute-closure`, {
      method: 'POST',
      headers: staffHeaders,
      body: JSON.stringify({ previewVersion: version, confirmation: 'CLOSE_PROFILE' }),
    });
  expect((await executeRetained(pendingReview.previewVersion)).status).toBe(409);
  const queued = await fetch(
    `${http.base}/api/tickets/lifecycle-requests/${exportTicketId}/export`,
    { method: 'POST', headers: ownerHeaders }
  );
  expect(queued.status, http.logs()).toBe(202);
  const jobId = ((await queued.json()) as { jobId: string }).jobId;
  await http.pool.query(
    "UPDATE async_jobs SET status='completed',progress_pct=100,result_url=$2,completed_at=now() WHERE id=$1",
    [jobId, `/api/tickets/lifecycle-requests/${exportTicketId}/export`]
  );
  await http.pool.query(
    "UPDATE tickets SET privacy_export_storage_key=$2,privacy_export_expires_at=clock_timestamp()+interval '24 hours' WHERE id=$1",
    [exportTicketId, `tmp/profile-exports/${exportTicketId}/owned.zip`]
  );
  const downloaded = await fetch(
    `${http.base}/api/tickets/lifecycle-requests/${exportTicketId}/export`,
    { headers: ownerHeaders, redirect: 'manual' }
  );
  expect(downloaded.status, await downloaded.clone().text()).toBe(302);
  expect(downloaded.headers.get('cache-control')).toBe('private, no-store');
  const privateUrl = new URL(downloaded.headers.get('location')!);
  expect(privateUrl.pathname).toContain(`tmp/profile-exports/${exportTicketId}/owned.zip`);
  expect(Number(privateUrl.searchParams.get('X-Amz-Expires'))).toBeLessThanOrEqual(300);
  expect(Number(privateUrl.searchParams.get('X-Amz-Expires'))).toBeGreaterThan(0);

  // The export can expire during closure writes. Reach the audit first, then
  // prove the final clock check rolls back archive/revocation/audit together.
  await http.pool.query(
    "UPDATE tickets SET privacy_export_expires_at=clock_timestamp()+interval '4 seconds' WHERE id=$1",
    [exportTicketId]
  );
  const expiring = (await (
    await fetch(`${http.base}/api/staff/tickets/${id}/closure-preview`, { headers: staffHeaders })
  ).json()) as { eligible: boolean; previewVersion: string };
  expect(expiring.eligible).toBe(true);
  await http.pool.query(`CREATE SEQUENCE closure_export_audit_reached;
    CREATE FUNCTION wait_for_export_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='profile_closure_executed' THEN
      PERFORM nextval('closure_export_audit_reached'); PERFORM pg_sleep(5);
    END IF; RETURN NEW; END $$;
    CREATE TRIGGER wait_for_export_expiry BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION wait_for_export_expiry()`);
  try {
    const closing = executeRetained(expiring.previewVersion);
    await expect
      .poll(
        async () =>
          (await http.pool.query('SELECT is_called FROM closure_export_audit_reached')).rows[0]
            .is_called
      )
      .toBe(true);
    expect((await closing).status).toBe(409);
    expect(
      (
        await http.pool.query('SELECT archived,first_name FROM profiles WHERE id=$1', [
          retainedProfileId,
        ])
      ).rows[0]
    ).toMatchObject({ archived: false, first_name: 'Retained' });
    expect(
      (await http.pool.query('SELECT privacy_closure_completed_at FROM tickets WHERE id=$1', [id]))
        .rows[0].privacy_closure_completed_at
    ).toBeNull();
    expect(
      (
        await http.pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [
          ownerHeaders.Cookie!.split('=')[1],
        ])
      ).rows[0].revoked_at
    ).toBeNull();
    expect(
      (
        await http.pool.query(
          "SELECT id FROM audit_log WHERE event='profile_closure_executed' AND metadata::jsonb->>'ticketId'=$1",
          [id]
        )
      ).rows
    ).toEqual([]);
  } finally {
    await http.pool.query(
      'DROP TRIGGER wait_for_export_expiry ON audit_log; DROP FUNCTION wait_for_export_expiry(); DROP SEQUENCE closure_export_audit_reached'
    );
  }
  await http.pool.query(
    "UPDATE tickets SET privacy_export_expires_at=clock_timestamp()+interval '24 hours' WHERE id=$1",
    [exportTicketId]
  );
  const dryRun = await fetch(`${http.base}/api/staff/tickets/${id}/closure-preview`, {
    headers: staffHeaders,
  });
  expect(dryRun.status, http.logs()).toBe(200);
  const review = (await dryRun.json()) as {
    eligible: boolean;
    anonymizeProfile: boolean;
    retained: { wallets: number };
    previewVersion: string;
    exportTicketId: string;
  };
  expect(review).toMatchObject({
    eligible: true,
    anonymizeProfile: false,
    retained: { wallets: 1 },
    exportTicketId,
  });
  const result = await fetch(`${http.base}/api/staff/tickets/${id}/execute-closure`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({ previewVersion: review.previewVersion, confirmation: 'CLOSE_PROFILE' }),
  });
  expect(result.status, http.logs()).toBe(200);
  expect(
    (
      await http.pool.query(`SELECT archived,first_name FROM profiles WHERE id=$1`, [
        retainedProfileId,
      ])
    ).rows[0]
  ).toMatchObject({ archived: true, first_name: 'Retained' });
  expect(
    (
      await http.pool.query(
        `SELECT privacy_closure_anonymized,privacy_closure_retained,
           privacy_closure_export_ticket_id FROM tickets WHERE id=$1`,
        [id]
      )
    ).rows[0]
  ).toMatchObject({
    privacy_closure_anonymized: false,
    privacy_closure_retained: { wallets: 1 },
    privacy_closure_export_ticket_id: exportTicketId,
  });
  await session('closure-owner', ownerHeaders);
  const retainedExport = await fetch(`${http.base}/api/tickets/${exportTicketId}`, {
    headers: ownerHeaders,
  });
  expect(retainedExport.status, http.logs()).toBe(200);
  expect(await retainedExport.json()).toMatchObject({
    id: exportTicketId,
    privacyRequestType: 'export',
  });
  const completedRecord = await fetch(`${http.base}/api/tickets/${id}`, { headers: ownerHeaders });
  expect(completedRecord.status, http.logs()).toBe(200);
  expect(await completedRecord.json()).toMatchObject({
    privacyClosureExportTicketId: exportTicketId,
  });
  // Closure retains support references; downloads still require an active owned profile.
  expect(
    (
      await fetch(`${http.base}/api/tickets/lifecycle-requests/${exportTicketId}/export`, {
        headers: ownerHeaders,
        redirect: 'manual',
      })
    ).status
  ).toBe(403);
}, 15000);

it('refuses to close a profile after its ownership changes, without touching either account', async () => {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('closure-new-owner','new-owner@example.test','test-only'),('closure-transfer-owner','transfer-owner@example.test','test-only')"
  );
  const changedProfile = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default,first_name) VALUES('closure-transfer-owner','INDIVIDUAL','ACTIVE',true,'Changed owner profile') RETURNING id"
    )
  ).rows[0].id as string;
  const transferHeaders: Record<string, string> = {};
  const transferSession = await session('closure-transfer-owner', transferHeaders);
  const newOwnerHeaders: Record<string, string> = {};
  const newOwnerSession = await session('closure-new-owner', newOwnerHeaders);
  await http.pool.query(
    "INSERT INTO user_profile_contexts(user_id,profile_id) VALUES('closure-transfer-owner',$1)",
    [changedProfile]
  );
  const created = await fetch(`${http.base}/api/tickets/lifecycle-requests`, {
    method: 'POST',
    headers: transferHeaders,
    body: JSON.stringify({ type: 'closure', idempotencyKey: randomUUID(), locale: 'en' }),
  });
  expect(created.status, http.logs()).toBe(201);
  const ticketId = ((await created.json()) as { ticketId: string }).ticketId;
  const before = (await (
    await fetch(`${http.base}/api/staff/tickets/${ticketId}/closure-preview`, {
      headers: staffHeaders,
    })
  ).json()) as { previewVersion: string; eligible: boolean };
  expect(before.eligible).toBe(true);
  await http.pool.query(
    "UPDATE profiles SET user_id='closure-new-owner',updated_at=clock_timestamp() WHERE id=$1",
    [changedProfile]
  );
  const current = (await (
    await fetch(`${http.base}/api/staff/tickets/${ticketId}/closure-preview`, {
      headers: staffHeaders,
    })
  ).json()) as { eligible: boolean; blockers: unknown[] };
  expect(current.eligible).toBe(false);
  expect(current.blockers).toContainEqual({
    code: 'profileOwnershipChanged',
    count: 1,
    owner: 'privacy',
    nextStep: 'staffReview',
  });
  const result = await fetch(`${http.base}/api/staff/tickets/${ticketId}/execute-closure`, {
    method: 'POST',
    headers: staffHeaders,
    body: JSON.stringify({ previewVersion: before.previewVersion, confirmation: 'CLOSE_PROFILE' }),
  });
  expect(result.status, http.logs()).toBe(409);
  expect(
    (
      await http.pool.query(
        'SELECT session_id FROM sessions WHERE session_id=ANY($1::text[]) AND revoked_at IS NULL',
        [[transferSession, newOwnerSession]]
      )
    ).rows
  ).toHaveLength(2);
  expect(
    (
      await http.pool.query('SELECT archived,user_id,first_name FROM profiles WHERE id=$1', [
        changedProfile,
      ])
    ).rows[0]
  ).toMatchObject({
    archived: false,
    user_id: 'closure-new-owner',
    first_name: 'Changed owner profile',
  });
  expect(
    (
      await http.pool.query('SELECT privacy_closure_completed_at FROM tickets WHERE id=$1', [
        ticketId,
      ])
    ).rows[0].privacy_closure_completed_at
  ).toBeNull();
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='profile_closure_executed' AND metadata::jsonb->>'ticketId'=$1",
        [ticketId]
      )
    ).rows
  ).toEqual([]);
});
