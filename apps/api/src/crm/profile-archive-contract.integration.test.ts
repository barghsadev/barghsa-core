import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
const author = 'archive-contract-author';
const archivist = 'archive-contract-staff';
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const user of [author, archivist]) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_admin) VALUES($1,$1,'fixture',true)",
      [user]
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')",
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: 'barghsa_session=' + session,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40000);
afterAll(async () => {
  await http?.close();
});

async function fixture(serviceType: 'electricity' | 'savings' | 'solar' = 'electricity') {
  const profileId = randomUUID(),
    owner = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')",
    [owner]
  );
  await http.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profileId, owner]);
  const input = {
    profileId,
    serviceType,
    content: { price: '100', termMonths: 12 },
    changeDescription: 'Initial contract',
    idempotencyKey: randomUUID(),
  };
  const create = () =>
    fetch(http.base + '/api/admin/contracts', {
      method: 'POST',
      headers: headers[author]!,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
    });
  const archive = () =>
    fetch(http.base + '/api/crm/profiles/' + profileId, {
      method: 'DELETE',
      headers: headers[archivist]!,
      body: JSON.stringify({ reason: 'Closure requested' }),
      signal: AbortSignal.timeout(10000),
    });
  const snapshot = async () => ({
    owner: (await http.pool.query('SELECT * FROM users WHERE user_id=$1', [owner])).rows,
    profile: (await http.pool.query('SELECT * FROM profiles WHERE id=$1', [profileId])).rows,
    contracts: (
      await http.pool.query('SELECT * FROM contracts WHERE profile_id=$1 ORDER BY id', [profileId])
    ).rows,
    versions: (
      await http.pool.query(
        'SELECT * FROM contract_versions WHERE contract_id IN (SELECT id FROM contracts WHERE profile_id=$1) ORDER BY id',
        [profileId]
      )
    ).rows,
    keys: (
      await http.pool.query(
        "SELECT * FROM idempotency_keys WHERE entity_type='contract_create' AND response->'request'->>'profileId'=$1::text ORDER BY idempotency_key",
        [profileId]
      )
    ).rows,
    audits: (
      await http.pool.query(
        "SELECT * FROM audit_log WHERE metadata::jsonb->>'profileId'=$1::text OR metadata::jsonb->>'contractId' IN (SELECT id::text FROM contracts WHERE profile_id=$1::uuid) ORDER BY id",
        [profileId]
      )
    ).rows,
  });
  return { profileId, owner, input, create, archive, snapshot };
}
async function waiting(fragment: string) {
  await expect
    .poll(
      async () =>
        (
          await http.pool.query(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE $1) AS waiting",
            ['%' + fragment + '%']
          )
        ).rows[0].waiting
    )
    .toBe(true);
}
for (const service of ['electricity', 'savings', 'solar'] as const) {
  it(
    'retains a real ' + service + ' contract and refuses archival without side effects',
    async () => {
      const f = await fixture(service);
      const created = await f.create();
      expect(created.status, http.logs()).toBe(201);
      const before = await f.snapshot();
      expect(before.contracts).toHaveLength(1);
      const response = await f.archive();
      expect(response.status, http.logs()).toBe(409);
      expect(await response.json()).toMatchObject({
        error: {
          code: 'CRM:PROFILE:DELETION_BLOCKED',
          message: 'This profile has 1 contract(s). Resolve them before archiving.',
        },
      });
      expect(await f.snapshot()).toEqual(before);
    }
  );
}
it('allows a sibling profile to archive while retaining the owner and contract history', async () => {
  const f = await fixture();
  expect((await f.create()).status, http.logs()).toBe(201);
  const before = await f.snapshot(),
    sibling = randomUUID();
  await http.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [sibling, f.owner]);
  const response = await fetch(http.base + '/api/crm/profiles/' + sibling, {
    method: 'DELETE',
    headers: headers[archivist]!,
    body: JSON.stringify({ reason: 'Close sibling' }),
  });
  expect(response.status, http.logs()).toBe(200);
  expect(await response.json()).toMatchObject({
    success: true,
    profileId: sibling,
    archivedAt: expect.any(String),
  });
  expect(
    (await http.pool.query('SELECT archived,archived_reason FROM profiles WHERE id=$1', [sibling]))
      .rows[0]
  ).toEqual({ archived: true, archived_reason: 'Close sibling' });
  expect(await f.snapshot()).toEqual(before);
});
it('rechecks archival after contract creation waits for the same profile lock', async () => {
  const f = await fixture(),
    lock = await http.pool.connect();
  let creating: Promise<Response> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query('UPDATE profiles SET archived=true WHERE id=$1', [f.profileId]);
    creating = f.create();
    await waiting('SELECT archived FROM profiles WHERE id=$1 FOR SHARE');
    await lock.query('COMMIT');
    const before = await f.snapshot();
    expect((await creating).status, http.logs()).toBe(409);
    expect(await f.snapshot()).toEqual(before);
    expect(before.contracts).toEqual([]);
    expect(before.versions).toEqual([]);
    expect(before.keys).toEqual([]);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await creating;
  }
});
it('archival waits for contract creation and then rejects the newly committed obligation', async () => {
  const f = await fixture(),
    lock = await http.pool.connect();
  let creating: Promise<Response> | undefined, archiving: Promise<Response> | undefined;
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      'contract_create:' + author + ':' + f.input.idempotencyKey,
    ]);
    creating = f.create();
    await waiting('SELECT pg_advisory_xact_lock(hashtextextended');
    archiving = f.archive();
    await waiting('SELECT id,user_id,profile_type,status,archived FROM profiles');
    await lock.query('COMMIT');
    expect((await creating).status, http.logs()).toBe(201);
    const response = await archiving;
    expect(response.status, http.logs()).toBe(409);
    expect(await response.json()).toMatchObject({
      error: {
        code: 'CRM:PROFILE:DELETION_BLOCKED',
        message: 'This profile has 1 contract(s). Resolve them before archiving.',
      },
    });
    const saved = await f.snapshot();
    expect(saved.contracts).toHaveLength(1);
    expect(saved.versions).toHaveLength(1);
    expect(saved.profile[0]).toMatchObject({ archived: false });
    expect(saved.audits.filter((row) => row.event === 'profile_deleted')).toEqual([]);
    expect(saved.audits.filter((row) => row.event === 'contract.created')).toHaveLength(1);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await Promise.all([creating, archiving]);
  }
});
