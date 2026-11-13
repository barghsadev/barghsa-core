import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DEFAULT_VERIFICATION_POLICY, type VerificationPolicy } from '@barghsa/shared/verification';
import { startHttpFixture } from '../test/http-fixture.js';
import { OrdersService } from '../orders/orders.service.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>, profileId: string;
const session = randomUUID(),
  csrf = randomUUID();
const headers = {
  Cookie: `barghsa_session=${session}`,
  'X-CSRF-Token': csrf,
  'Content-Type': 'application/json',
};
const path = '/api/admin/config/profile-verification-policy';
const permissions = [
  'admin:config:read',
  'admin:config:write',
  'admin:users:create',
  'crm:view',
  'crm:verify',
];
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool
    .query(`INSERT INTO users(user_id,username,password_hash,is_staff) VALUES('policy-editor','policy@example.test','test',true),('policy-owner','owner@example.test','test',false);
    INSERT INTO staff_roles(role_id,name,description,permissions) VALUES('policy-role','Policy role','Test','[]');
    INSERT INTO user_roles(user_id,role_id) VALUES('policy-editor','policy-role')`);
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,'policy-editor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf, randomUUID()]
  );
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM app_config WHERE key LIKE 'profile_verification_policy%' OR key='profile_verification_mode'"
  );
  await http.pool.query(
    "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='policy-role'",
    [JSON.stringify(permissions)]
  );
  await http.pool.query(
    'UPDATE sessions SET revoked_at=NULL,step_up_verified_at=NOW() WHERE session_id=$1',
    [session]
  );
  profileId = randomUUID();
  await http.pool.query(
    "INSERT INTO profiles(id,user_id,profile_type,status) VALUES($1,'policy-owner','INDIVIDUAL','PENDING_VERIFICATION')",
    [profileId]
  );
});
const read = () => fetch(http.base + path, { headers });
const history = (query = '') => fetch(http.base + path + '/history' + query, { headers });
const restore = (sourceId: string, expectedVersion: number) =>
  fetch(http.base + path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ action: 'restore', sourceId, expectedVersion }),
  });
const write = (policy: VerificationPolicy, action = 'draft', expectedVersion = 0) =>
  fetch(http.base + path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ policy, action, expectedVersion }),
  });
const verify = (body: unknown) =>
  fetch(`${http.base}/api/crm/profiles/${profileId}/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
it('expands a populated legacy profile table without inventing verification timestamps or changing prior bytes', async () => {
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "CREATE TEMP TABLE profiles(id text,status text,notes text) ON COMMIT DROP; INSERT INTO profiles VALUES('legacy','VERIFIED','retained')"
    );
    await client.query(
      readFileSync(
        '../../packages/db/drizzle/production/0279_profile_verification_expiry.sql',
        'utf8'
      )
    );
    expect((await client.query('SELECT * FROM profiles')).rows).toEqual([
      { id: 'legacy', status: 'VERIFIED', notes: 'retained', verified_at: null },
    ]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
it('fails closed on an explicitly corrupt active policy instead of restoring permissive staff defaults', async () => {
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('profile_verification_policy','null')"
  );
  expect((await read()).status).toBe(503);
  expect((await verify({ action: 'verify' })).status).toBe(503);
  expect(
    (await http.pool.query('SELECT status FROM profiles WHERE id=$1', [profileId])).rows[0].status
  ).toBe('PENDING_VERIFICATION');
});
it('enforces legal requirements independently of an exempt individual profile', async () => {
  const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
  policy.INDIVIDUAL.required = false;
  policy.LEGAL.documents = ['registration_notice'];
  policy.LEGAL.expiryDays = 2;
  await active(policy);
  await http.pool.query("UPDATE profiles SET profile_type='LEGAL' WHERE id=$1", [profileId]);
  expect((await verify({ action: 'verify' })).status).toBe(400);
  const key = `verification-evidence/${randomUUID()}/legal`;
  await http.pool.query(
    "INSERT INTO storage_records(storage_key,status,metadata) VALUES($1,'immutable',$2::jsonb)",
    [key, JSON.stringify({ purpose: 'verification_evidence', profileId, sha256: 'b'.repeat(64) })]
  );
  expect(
    (await verify({ action: 'verify', evidence: [{ type: 'national_id', key }] })).status
  ).toBe(400);
  expect(
    (await verify({ action: 'verify', evidence: [{ type: 'registration_notice', key }] })).status
  ).toBe(200);
  await http.pool.query("UPDATE profiles SET verified_at=NOW()-INTERVAL '3 days' WHERE id=$1", [
    profileId,
  ]);
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    const orders = Object.create(OrdersService.prototype) as OrdersService;
    await expect(
      orders.mayManageOrders(client, 'policy-owner', profileId, true, false)
    ).rejects.toMatchObject({ status: 403 });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
it('reports expired approvals in customer context and applies the active profile-type requirement', async () => {
  const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
  policy.INDIVIDUAL.expiryDays = 1;
  await active(policy);
  await http.pool.query(
    "UPDATE profiles SET is_default=true,status='VERIFIED',verified_at=NOW()-INTERVAL '2 days' WHERE id=$1",
    [profileId]
  );
  const id = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES($1,'policy-owner',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [id, randomUUID(), randomUUID()]
  );
  const status = () =>
    fetch(http.base + '/api/profiles/verification-status', {
      headers: { Cookie: `barghsa_session=${id}` },
    });
  expect(await (await status()).json()).toMatchObject({
    activeProfileId: profileId,
    isVerified: false,
    verificationRequired: true,
    canAutoVerify: false,
  });
  policy.INDIVIDUAL.required = false;
  await http.pool.query(
    "UPDATE app_config SET value=$1::jsonb WHERE key='profile_verification_policy'",
    [JSON.stringify(policy)]
  );
  expect(await (await status()).json()).toMatchObject({
    isVerified: false,
    verificationRequired: false,
  });
});
async function active(policy: VerificationPolicy) {
  await http.pool.query(
    "INSERT INTO app_config(key,value) VALUES('profile_verification_policy',$1::jsonb),('profile_verification_mode','\"MANUAL\"')",
    [JSON.stringify(policy)]
  );
}
it('saves draft separately, rejects stale races, and activates only the exact tested revision with step-up', async () => {
  expect(await (await read()).json()).toEqual({
    active: DEFAULT_VERIFICATION_POLICY,
    draft: null,
    version: 0,
  });
  const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
  policy.LEGAL.documents = ['registration_notice'];
  policy.autoVerifyStaff = false;
  const responses = await Promise.all([write(policy), write(policy)]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  expect(await (await read()).json()).toEqual({
    active: DEFAULT_VERIFICATION_POLICY,
    draft: policy,
    version: 1,
  });
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    session,
  ]);
  expect((await write(policy, 'activate', 1)).status).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE session_id=$1', [
    session,
  ]);
  expect((await write(DEFAULT_VERIFICATION_POLICY, 'activate', 1)).status).toBe(409);
  expect((await write(policy, 'activate', 1)).status).toBe(200);
  expect(await (await read()).json()).toEqual({ active: policy, draft: null, version: 2 });
  expect((await write(policy, 'activate', 1)).status).toBe(409);
});
it('rejects malformed policy, revoked authority and missing CSRF before changing state', async () => {
  const malformed = { ...DEFAULT_VERIFICATION_POLICY, allowManualOverride: 'true' };
  expect((await write(malformed as never)).status).toBe(400);
  const noCsrf = await fetch(http.base + path, {
    method: 'PUT',
    headers: { Cookie: headers.Cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy: DEFAULT_VERIFICATION_POLICY,
      action: 'draft',
      expectedVersion: 0,
    }),
  });
  expect(noCsrf.status).toBe(403);
  await http.pool.query("UPDATE staff_roles SET permissions='[]' WHERE role_id='policy-role'");
  expect((await read()).status).toBe(403);
  expect((await write(DEFAULT_VERIFICATION_POLICY)).status).toBe(403);
  expect(
    (
      await http.pool.query(
        "SELECT key FROM app_config WHERE key LIKE 'profile_verification_policy%'"
      )
    ).rows
  ).toEqual([]);
});
it('restores an audited activation as a new draft and requires separate step-up to publish it', async () => {
  const first = structuredClone(DEFAULT_VERIFICATION_POLICY);
  first.LEGAL.documents = ['registration_notice'];
  const second = structuredClone(first);
  second.LEGAL.expiryDays = 21;
  expect((await write(first)).status).toBe(200);
  expect((await write(first, 'activate', 1)).status).toBe(200);
  expect((await write(second, 'draft', 2)).status).toBe(200);
  expect((await write(second, 'activate', 3)).status).toBe(200);

  const response = await history('?beforeVersion=4');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe(
    'private, no-cache, no-store, must-revalidate'
  );
  const revisions = (await response.json()) as {
    items: { id: string; version: number; policy: VerificationPolicy }[];
  };
  expect(revisions.items).not.toContainEqual(expect.objectContaining({ version: 4 }));
  const source = revisions.items.find(
    (item) =>
      item.policy.LEGAL.documents.includes('registration_notice') && item.policy.autoVerifyStaff
  );
  expect(source).toEqual({ id: expect.any(String), version: 2, policy: first });
  if (!source) throw new Error('Missing verification policy revision');
  const { id } = source;
  expect((await history('?beforeVersion=0')).status).toBe(400);
  expect((await restore(randomUUID(), 4)).status).toBe(404);
  expect((await restore(id, 3)).status).toBe(409);

  await http.pool.query('UPDATE sessions SET step_up_verified_at=NULL WHERE session_id=$1', [
    session,
  ]);
  expect((await restore(id, 4)).status).toBe(200);
  expect(await (await read()).json()).toEqual({ active: second, draft: first, version: 5 });
  expect((await write(first, 'activate', 5)).status).toBe(403);
  await http.pool.query('UPDATE sessions SET step_up_verified_at=NOW() WHERE session_id=$1', [
    session,
  ]);
  expect((await write(first, 'activate', 5)).status).toBe(200);
  expect(await (await read()).json()).toEqual({ active: first, draft: null, version: 6 });
  const audit = await http.pool.query(
    `SELECT metadata::jsonb->>'action' AS action, metadata::jsonb->'restoredFrom' AS source
    FROM audit_log WHERE metadata IS JSON OBJECT AND metadata::jsonb#>>'{restoredFrom,id}'=$1
    ORDER BY created_at`,
    [id]
  );
  expect(audit.rows).toEqual(
    ['restore', 'activate'].map((action) => ({ action, source: { id, version: 2 } }))
  );
});
it('rolls back activation and its revision if durable audit fails', async () => {
  expect((await write(DEFAULT_VERIFICATION_POLICY)).status).toBe(200);
  await http.pool
    .query(`CREATE FUNCTION reject_policy_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.metadata::jsonb->>'key'='profile_verification_policy' THEN RAISE EXCEPTION 'controlled audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_policy_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_policy_audit()`);
  try {
    expect((await write(DEFAULT_VERIFICATION_POLICY, 'activate', 1)).status).toBe(500);
  } finally {
    await http.pool.query(
      'DROP TRIGGER reject_policy_audit ON audit_log; DROP FUNCTION reject_policy_audit()'
    );
  }
  expect(await (await read()).json()).toEqual({
    active: DEFAULT_VERIFICATION_POLICY,
    draft: DEFAULT_VERIFICATION_POLICY,
    version: 1,
  });
});
it('requires typed sealed evidence, rejects cross-profile files and records accepted evidence in immutable review history', async () => {
  const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
  policy.INDIVIDUAL.documents = ['national_id'];
  await active(policy);
  expect((await verify({ action: 'verify' })).status).toBe(400);
  const key = `verification-evidence/${randomUUID()}/digest`,
    ownedKey = `verification-evidence/${randomUUID()}/digest`;
  await http.pool.query(
    "INSERT INTO storage_records(storage_key,status,metadata) VALUES($1,'immutable',$2::jsonb)",
    [
      key,
      JSON.stringify({
        purpose: 'verification_evidence',
        profileId: randomUUID(),
        sha256: 'a'.repeat(64),
      }),
    ]
  );
  expect(
    (await verify({ action: 'verify', evidence: [{ type: 'national_id', key }] })).status
  ).toBe(409);
  await http.pool.query(
    "INSERT INTO storage_records(storage_key,status,metadata) VALUES($1,'immutable',$2::jsonb)",
    [
      ownedKey,
      JSON.stringify({ purpose: 'verification_evidence', profileId, sha256: 'a'.repeat(64) }),
    ]
  );
  expect(
    (await verify({ action: 'verify', evidence: [{ type: 'national_id', key: ownedKey }] })).status
  ).toBe(200);
  const row = (
    await http.pool.query('SELECT status,verified_at FROM profiles WHERE id=$1', [profileId])
  ).rows[0];
  expect(row.status).toBe('VERIFIED');
  expect(row.verified_at).toBeInstanceOf(Date);
  expect(
    (
      await http.pool.query(
        "SELECT metadata::jsonb AS metadata FROM audit_log WHERE event='verification_change' AND metadata::jsonb->>'profileId'=$1",
        [profileId]
      )
    ).rows[0].metadata.evidence
  ).toEqual([{ type: 'national_id', key: ownedKey }]);
});
it('allows a reason-bound override only when both policy and elevated permission allow it', async () => {
  const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
  policy.INDIVIDUAL.documents = ['national_id'];
  await active(policy);
  expect(
    (await verify({ action: 'verify', overrideReason: 'Reviewed original identity in person' }))
      .status
  ).toBe(400);
  policy.allowManualOverride = true;
  await http.pool.query(
    "UPDATE app_config SET value=$1::jsonb WHERE key='profile_verification_policy'",
    [JSON.stringify(policy)]
  );
  await http.pool.query(
    "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='policy-role'",
    [JSON.stringify(['crm:verify'])]
  );
  expect(
    (await verify({ action: 'verify', overrideReason: 'Reviewed original identity in person' }))
      .status
  ).toBe(403);
  await http.pool.query(
    "UPDATE staff_roles SET permissions=$1::jsonb WHERE role_id='policy-role'",
    [JSON.stringify(permissions)]
  );
  expect((await verify({ action: 'verify', overrideReason: '  ' })).status).toBe(400);
  expect(
    (await verify({ action: 'verify', overrideReason: 'Reviewed original identity in person' }))
      .status
  ).toBe(200);
});
it('enforces expiry and profile-specific requirements at the shared commercial boundary', async () => {
  const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
  policy.INDIVIDUAL.expiryDays = 1;
  await active(policy);
  await http.pool.query(
    "UPDATE profiles SET status='VERIFIED',verified_at=NOW()-INTERVAL '2 days' WHERE id=$1",
    [profileId]
  );
  const client = await http.pool.connect();
  const orders = Object.create(OrdersService.prototype) as OrdersService;
  try {
    await client.query('BEGIN');
    await expect(
      orders.mayManageOrders(client, 'policy-owner', profileId, true, false)
    ).rejects.toMatchObject({ status: 403 });
    await client.query('ROLLBACK');
    // A new, authorized manual review renews an expired approval.
    expect((await verify({ action: 'verify' })).status).toBe(200);
    await client.query('BEGIN');
    expect(await orders.mayManageOrders(client, 'policy-owner', profileId, true, false)).toBe(true);
    await client.query('ROLLBACK');
    policy.INDIVIDUAL.required = false;
    await http.pool.query(
      "UPDATE app_config SET value=$1::jsonb WHERE key='profile_verification_policy'",
      [JSON.stringify(policy)]
    );
    await http.pool.query("UPDATE profiles SET status='ACTIVE',verified_at=NULL WHERE id=$1", [
      profileId,
    ]);
    await client.query('BEGIN');
    expect(await orders.mayManageOrders(client, 'policy-owner', profileId, true, false)).toBe(true);
    await client.query('ROLLBACK');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
it.each([true, false])(
  'uses autoVerifyStaff=%s only in protected staff creation',
  async (autoVerifyStaff) => {
    const policy = structuredClone(DEFAULT_VERIFICATION_POLICY);
    policy.autoVerifyStaff = autoVerifyStaff;
    await active(policy);
    const response = await fetch(http.base + '/api/admin/users/create-staff', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username: `staff-${randomUUID()}@example.test`,
        firstName: 'New',
        lastName: 'Staff',
        roleIds: [],
        activationMethod: 'tempPassword',
      }),
    });
    expect(response.status).toBe(201);
    const data = (await response.json()) as { userId: string };
    const row = (
      await http.pool.query('SELECT status,verified_at FROM profiles WHERE user_id=$1', [
        data.userId,
      ])
    ).rows[0];
    expect(row.status).toBe(autoVerifyStaff ? 'VERIFIED' : 'PENDING_VERIFICATION');
    expect(row.verified_at !== null).toBe(autoVerifyStaff);
  }
);
