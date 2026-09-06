import { afterEach, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>;
let profileId: string;
const headers: Record<string, Record<string, string>> = {};
beforeEach(async () => {
  if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
  http = await startHttpFixture(process.env.TEST_DATABASE_URL);
  for (const user of ['owner', 'target', 'stranger']) {
    await http.pool.query('INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,$3)', [
      user,
      `${user}@example.test`,
      'test-only',
    ]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES ('owner','LEGAL','ACTIVE',true) RETURNING id"
    )
  ).rows[0].id;
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,'target','Manager')",
    [profileId]
  );
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);
function post(action: string, user = 'owner', body: unknown = {}) {
  return fetch(`${http.base}/api/profiles/${profileId}/${action}`, {
    method: 'POST',
    headers: headers[user]!,
    body: JSON.stringify(body),
  });
}
async function initiate() {
  const r = await post('transfer-ownership', 'owner', { newOwnerUserId: 'target' });
  const body = (await r.json()) as { id: string };
  expect(r.status, JSON.stringify(body) + http.logs()).toBe(201);
  return body.id;
}
it('requires step-up and keeps the old owner until exact-transfer acceptance', async () => {
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='owner'");
  expect((await post('transfer-ownership', 'owner', { newOwnerUserId: 'target' })).status).toBe(
    403
  );
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='owner'");
  const ownerTeam = await fetch(`${http.base}/api/profiles/${profileId}/agents`, {
    headers: headers.owner!,
  });
  expect(await ownerTeam.json(), http.logs()).toMatchObject({ canTransferOwnership: true });
  const managerTeam = await fetch(`${http.base}/api/profiles/${profileId}/agents`, {
    headers: headers.target!,
  });
  expect(await managerTeam.json()).toMatchObject({ canTransferOwnership: false });
  const id = await initiate();
  const outgoing = await fetch(`${http.base}/api/profiles/ownership-transfers`, {
    headers: headers.owner!,
  });
  expect(await outgoing.json()).toMatchObject({ transfers: [{ id, direction: 'outgoing' }] });
  expect(
    (await http.pool.query('SELECT user_id FROM profiles WHERE id=$1', [profileId])).rows[0].user_id
  ).toBe('owner');
  const list = await fetch(`${http.base}/api/profiles/ownership-transfers`, {
    headers: headers.target!,
  });
  expect(await list.json()).toMatchObject({
    transfers: [{ id, profileId, direction: 'incoming' }],
  });
  expect((await post('ownership-accept', 'stranger', { transferId: id })).status).toBe(404);
  expect((await post('ownership-accept', 'target', { transferId: randomUUID() })).status).toBe(404);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='target'");
  expect((await post('ownership-accept', 'target', { transferId: id })).status).toBe(403);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='target'");
  const accepted = await post('ownership-accept', 'target', { transferId: id });
  expect(accepted.status, (await accepted.text()) + http.logs()).toBe(200);
  expect(
    (await http.pool.query('SELECT user_id,is_default FROM profiles WHERE id=$1', [profileId]))
      .rows[0]
  ).toEqual({ user_id: 'target', is_default: false });
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM sessions WHERE user_id IN ('owner','target') AND revoked_at IS NULL"
      )
    ).rows[0].count
  ).toBe(0);
  expect((await post('ownership-accept', 'target', { transferId: id })).status).toBe(401);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='ownership_transfer_completed'"
      )
    ).rows[0].count
  ).toBe(1);
});
it.each(['decline', 'cancel'])(
  'races acceptance with %s and preserves one owner',
  async (opponent) => {
    const id = await initiate(),
      client = await http.pool.connect();
    let attempts: Promise<Response>[] = [];
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
      attempts = [
        post('ownership-accept', 'target', { transferId: id }),
        post(`ownership-${opponent}`, opponent === 'cancel' ? 'owner' : 'target', {
          transferId: id,
        }),
      ];
      await expect
        .poll(
          async () =>
            (
              await http.pool
                .query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE 'SELECT user_id,profile_type,archived FROM profiles%'`)
            ).rows[0].count
        )
        .toBe(2);
      await client.query('COMMIT');
      const results = await Promise.all(attempts);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const status = (
        await http.pool.query('SELECT status FROM profile_ownership_transfers WHERE id=$1', [id])
      ).rows[0].status;
      expect(
        (await http.pool.query('SELECT user_id FROM profiles WHERE id=$1', [profileId])).rows[0]
          .user_id
      ).toBe(status === 'Completed' ? 'target' : 'owner');
      expect(
        (
          await http.pool.query(
            "SELECT count(*)::int AS count FROM audit_log WHERE event IN ('ownership_transfer_completed','ownership_transfer_declined','ownership_transfer_cancelled')"
          )
        ).rows[0].count
      ).toBe(1);
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await Promise.allSettled(attempts);
    }
  },
  15000
);
it('rejects expired or removed targets and allows a replacement after expiry', async () => {
  const id = await initiate();
  await http.pool.query(
    "UPDATE profile_ownership_transfers SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
    [id]
  );
  expect((await post('ownership-accept', 'target', { transferId: id })).status).toBe(409);
  expect(
    (await http.pool.query('SELECT status FROM profile_ownership_transfers WHERE id=$1', [id]))
      .rows[0].status
  ).toBe('Expired');
  const replacement = await initiate();
  await http.pool.query("DELETE FROM profile_agents WHERE profile_id=$1 AND user_id='target'", [
    profileId,
  ]);
  expect((await post('ownership-accept', 'target', { transferId: replacement })).status).toBe(409);
  expect(
    (await http.pool.query('SELECT user_id FROM profiles WHERE id=$1', [profileId])).rows[0].user_id
  ).toBe('owner');
});
it('rolls back ownership, sessions and transfer state when audit fails', async () => {
  const id = await initiate();
  await http.pool
    .query(`CREATE FUNCTION reject_transfer_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.event='ownership_transfer_completed' THEN RAISE EXCEPTION 'Injected audit failure'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER reject_transfer_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_transfer_audit()`);
  expect((await post('ownership-accept', 'target', { transferId: id })).status).toBe(500);
  expect(
    (await http.pool.query('SELECT user_id,is_default FROM profiles WHERE id=$1', [profileId]))
      .rows[0]
  ).toEqual({ user_id: 'owner', is_default: true });
  expect(
    (await http.pool.query('SELECT status FROM profile_ownership_transfers WHERE id=$1', [id]))
      .rows[0].status
  ).toBe('Pending');
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM sessions WHERE user_id IN ('owner','target') AND revoked_at IS NULL"
      )
    ).rows[0].count
  ).toBe(2);
});
it('checks expiry again after waiting for target membership', async () => {
  const id = await initiate(),
    client = await http.pool.connect();
  let attempt: Promise<Response> | undefined;
  await http.pool.query(
    "UPDATE profile_ownership_transfers SET expires_at=clock_timestamp()+INTERVAL '1 second' WHERE id=$1",
    [id]
  );
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id='target' FOR UPDATE",
      [profileId]
    );
    attempt = post('ownership-accept', 'target', { transferId: id });
    await expect
      .poll(
        async () =>
          (
            await http.pool
              .query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE 'SELECT pa.id FROM profile_agents%'`)
          ).rows[0].count
      )
      .toBe(1);
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              'SELECT expires_at<clock_timestamp() AS expired FROM profile_ownership_transfers WHERE id=$1',
              [id]
            )
          ).rows[0].expired
      )
      .toBe(true);
    await client.query('COMMIT');
    expect((await attempt).status).toBe(409);
    expect(
      (await http.pool.query('SELECT user_id FROM profiles WHERE id=$1', [profileId])).rows[0]
        .user_id
    ).toBe('owner');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await attempt;
  }
});
it('allows only one concurrent initiation', async () => {
  const responses = await Promise.all(
    [1, 2].map(() => post('transfer-ownership', 'owner', { newOwnerUserId: 'target' }))
  );
  expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM profile_ownership_transfers WHERE profile_id=$1 AND status='Pending'",
        [profileId]
      )
    ).rows[0].count
  ).toBe(1);
});
it('supports additive roles and immediately removes financial access when Finance is removed', async () => {
  const edit = (roles: string[]) =>
    fetch(`${http.base}/api/profiles/${profileId}/agents/target/roles`, {
      method: 'PUT',
      headers: headers.owner!,
      body: JSON.stringify({ roles }),
    });
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NULL WHERE user_id='owner'");
  expect((await edit(['Finance', 'Legal'])).status).toBe(403);
  await http.pool.query("UPDATE sessions SET step_up_verified_at=NOW() WHERE user_id='owner'");
  const changed = await edit(['Finance', 'Legal']);
  expect(changed.status, await changed.text()).toBe(200);
  expect(
    (
      await http.pool.query('SELECT role FROM profile_agents WHERE profile_id=$1 ORDER BY role', [
        profileId,
      ])
    ).rows
  ).toEqual([{ role: 'Finance' }, { role: 'Legal' }]);
  expect(
    (
      await fetch(`${http.base}/api/wallet/${profileId}/create`, {
        method: 'POST',
        headers: headers.target!,
      })
    ).status
  ).toBeLessThan(300);
  expect((await edit(['Legal'])).status).toBe(200);
  expect(
    (await fetch(`${http.base}/api/wallet/${profileId}`, { headers: headers.target! })).status
  ).toBe(404);
  expect((await edit(['Owner'])).status).toBe(400);
  expect(
    (
      await fetch(`${http.base}/api/profiles/${profileId}/agents/owner`, {
        method: 'DELETE',
        headers: headers.owner!,
      })
    ).status
  ).toBe(409);
  expect(
    (
      await fetch(`${http.base}/api/profiles/${profileId}/agents/target`, {
        method: 'DELETE',
        headers: headers.owner!,
      })
    ).status
  ).toBe(200);
  expect((await post('transfer-ownership', 'owner', { newOwnerUserId: 'target' })).status).toBe(
    400
  );
  expect(
    (
      await http.pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='agent_removed'"
      )
    ).rows[0].count
  ).toBe(1);
});
it('serializes removing a target with ownership acceptance', async () => {
  const id = await initiate(),
    client = await http.pool.connect();
  let attempts: Promise<Response>[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [profileId]);
    attempts = [
      post('ownership-accept', 'target', { transferId: id }),
      fetch(`${http.base}/api/profiles/${profileId}/agents/target`, {
        method: 'DELETE',
        headers: headers.owner!,
      }),
    ];
    await expect
      .poll(
        async () =>
          (
            await http.pool
              .query(`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE 'SELECT user_id%FROM profiles%'`)
          ).rows[0].count
      )
      .toBe(2);
    await client.query('COMMIT');
    const results = await Promise.all(attempts);
    expect(results.map((r) => r.status).filter((s) => s === 200)).toHaveLength(1);
    expect(results.map((r) => r.status).every((s) => [200, 403, 409].includes(s))).toBe(true);
    const owner = (await http.pool.query('SELECT user_id FROM profiles WHERE id=$1', [profileId]))
      .rows[0].user_id;
    const agents = (
      await http.pool.query(
        "SELECT * FROM profile_agents WHERE profile_id=$1 AND user_id='target'",
        [profileId]
      )
    ).rows;
    expect(agents.length).toBe(owner === 'target' ? 1 : 0);
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await Promise.allSettled(attempts);
  }
}, 15000);
