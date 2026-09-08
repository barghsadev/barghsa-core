import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);
// Independent cases share one server/IP. Reset only its initiation quota.
beforeEach(async () => {
  await http.pool.query(
    "DELETE FROM rate_limit_counters WHERE key LIKE 'profiles:transfer-ownership:initiate:%'"
  );
  await http.pool.query(
    "DELETE FROM rate_limit_windows WHERE NOT security AND key LIKE 'profiles:transfer-ownership:initiate:%'"
  );
});

const operations = ['initiate', 'accept', 'decline', 'cancel'] as const;
type Operation = (typeof operations)[number];
const events = {
  initiate: 'initiated',
  accept: 'completed',
  decline: 'declined',
  cancel: 'cancelled',
};
async function setup(operation: Operation) {
  const owner = randomUUID(),
    target = randomUUID(),
    transferId = randomUUID();
  const actor = operation === 'initiate' || operation === 'cancel' ? owner : target;
  const sessionId = randomUUID(),
    csrf = randomUUID(),
    correlationId = randomUUID();
  for (const user of [owner, target]) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,'test-only')",
      [user, `${user}@example.test`]
    );
    const session = user === actor ? sessionId : randomUUID(),
      family = randomUUID();
    await http.pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
      VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
      [session, user, csrf, family]
    );
    await http.pool.query(
      'INSERT INTO refresh_tokens(id,family_id,token_hash,user_id,session_id) VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), family, randomUUID(), user, session]
    );
  }
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES ($1,'LEGAL','ACTIVE',true) RETURNING id",
      [owner]
    )
  ).rows[0].id as string;
  await http.pool.query(
    "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Manager')",
    [profileId, target]
  );
  if (operation !== 'initiate')
    await http.pool.query(
      `INSERT INTO profile_ownership_transfers(id,profile_id,from_user_id,to_user_id,status,expires_at)
    VALUES ($1,$2,$3,$4,'Pending',NOW()+INTERVAL '7 days')`,
      [transferId, profileId, owner, target]
    );
  return { owner, target, actor, sessionId, csrf, correlationId, profileId, transferId, operation };
}
type Context = Awaited<ReturnType<typeof setup>>;
function mutate(c: Context) {
  return fetch(
    `${http.base}/api/profiles/${c.profileId}/${c.operation === 'initiate' ? 'transfer-ownership' : `ownership-${c.operation}`}`,
    {
      method: 'POST',
      headers: {
        Cookie: `barghsa_session=${c.sessionId}`,
        'X-CSRF-Token': c.csrf,
        'Content-Type': 'application/json',
        'X-Correlation-ID': c.correlationId,
      },
      body: JSON.stringify(
        c.operation === 'initiate' ? { newOwnerUserId: c.target } : { transferId: c.transferId }
      ),
    }
  );
}
async function snapshot(c: Context) {
  return {
    profile: (
      await http.pool.query('SELECT user_id,is_default FROM profiles WHERE id=$1', [c.profileId])
    ).rows,
    agents: (
      await http.pool.query(
        'SELECT id,user_id,role FROM profile_agents WHERE profile_id=$1 ORDER BY id',
        [c.profileId]
      )
    ).rows,
    transfers: (
      await http.pool.query(
        'SELECT id,status,completed_at,declined_at,cancelled_at FROM profile_ownership_transfers WHERE profile_id=$1 ORDER BY id',
        [c.profileId]
      )
    ).rows,
    sessions: (
      await http.pool.query(
        'SELECT session_id,revoked_at FROM sessions WHERE user_id=ANY($1::text[]) ORDER BY session_id',
        [[c.owner, c.target]]
      )
    ).rows,
    refresh: (
      await http.pool.query(
        'SELECT id,consumed_at FROM refresh_tokens WHERE user_id=ANY($1::text[]) ORDER BY id',
        [[c.owner, c.target]]
      )
    ).rows,
    audit: (
      await http.pool.query(
        "SELECT event,user_id,metadata::jsonb AS metadata,correlation_id FROM audit_log WHERE metadata::jsonb->>'profileId'=$1 ORDER BY id",
        [c.profileId]
      )
    ).rows,
  };
}
async function auditHook(operation: Operation, failExpired = false) {
  await http.pool.query('CREATE SEQUENCE ownership_delay_witness');
  await http.pool
    .query(`CREATE FUNCTION ownership_audit_hook() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.event='ownership_transfer_${events[operation]}' THEN
      PERFORM nextval('ownership_delay_witness'); PERFORM pg_sleep(2.2);
    END IF;
    ${failExpired ? "IF NEW.event='ownership_transfer_expired' THEN RAISE EXCEPTION 'fixture expired audit failure'; END IF;" : ''}
    RETURN NEW; END $$`);
  await http.pool.query(
    'CREATE TRIGGER ownership_audit_hook BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION ownership_audit_hook()'
  );
}
async function clearHook() {
  await http.pool.query('DROP TRIGGER ownership_audit_hook ON audit_log');
  await http.pool.query('DROP FUNCTION ownership_audit_hook()');
  await http.pool.query('DROP SEQUENCE ownership_delay_witness');
}
async function expectWitness() {
  expect(
    (await http.pool.query('SELECT is_called FROM ownership_delay_witness')).rows[0].is_called
  ).toBe(true);
}
async function verifiedAt(c: Context) {
  return (
    (
      await http.pool.query('SELECT step_up_verified_at FROM sessions WHERE session_id=$1', [
        c.sessionId,
      ])
    ).rows[0].step_up_verified_at as Date
  ).toISOString();
}

for (const operation of operations) {
  it(`${operation} audits the current actor, step-up and request correlation`, async () => {
    const c = await setup(operation),
      before = await snapshot(c),
      time = await verifiedAt(c);
    const response = await mutate(c);
    expect(response.status, (await response.text()) + http.logs()).toBe(
      operation === 'initiate' ? 201 : 200
    );
    const after = await snapshot(c);
    expect(after.audit).toEqual([
      expect.objectContaining({
        event: `ownership_transfer_${events[operation]}`,
        user_id: c.actor,
        correlation_id: c.correlationId,
        metadata: expect.objectContaining({
          profileId: c.profileId,
          stepUpVerified: true,
          stepUpVerifiedAt: time,
        }),
      }),
    ]);
    expect(after.transfers).toHaveLength(1);
    expect(after.transfers[0]!.status).toBe(
      { initiate: 'Pending', accept: 'Completed', decline: 'Declined', cancel: 'Cancelled' }[
        operation
      ]
    );
    expect(after.profile).toEqual([
      { user_id: operation === 'accept' ? c.target : c.owner, is_default: operation !== 'accept' },
    ]);
    if (operation === 'accept') {
      expect(after.sessions).toHaveLength(2);
      expect(after.refresh).toHaveLength(2);
      expect(after.sessions.every((row) => row.revoked_at instanceof Date)).toBe(true);
      expect(after.refresh.every((row) => row.consumed_at instanceof Date)).toBe(true);
    } else {
      expect(after.sessions).toEqual(before.sessions);
      expect(after.refresh).toEqual(before.refresh);
    }
  });
  for (const change of [
    'revoke-session',
    'rotate-csrf',
    'disable-actor',
    'clear-step-up',
    'activation-pending',
  ] as const) {
    it(`${operation} rejects ${change} after request guards without effects`, async () => {
      const c = await setup(operation),
        lock = await http.pool.connect();
      let pending: Promise<Response> | undefined;
      try {
        await lock.query('BEGIN');
        const pid = (await lock.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await lock.query('SELECT id FROM profiles WHERE id=$1 FOR UPDATE', [c.profileId]);
        pending = mutate(c);
        await expect
          .poll(
            async () =>
              (
                await http.pool.query(
                  `SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND $1=ANY(pg_blocking_pids(pid)) AND query LIKE 'SELECT user_id%FROM profiles%FOR UPDATE%'`,
                  [pid]
                )
              ).rows.length,
            { timeout: 10000 }
          )
          .toBe(1);
        if (change === 'disable-actor')
          await http.pool.query('UPDATE users SET disabled_at=NOW() WHERE user_id=$1', [c.actor]);
        else if (change === 'activation-pending')
          await http.pool.query(
            "UPDATE users SET activation_token='fixture-pending' WHERE user_id=$1",
            [c.actor]
          );
        else
          await http.pool.query(
            `UPDATE sessions SET ${change === 'revoke-session' ? 'revoked_at=clock_timestamp()' : change === 'rotate-csrf' ? "csrf_token='fixture-rotated'" : 'step_up_verified_at=NULL'} WHERE session_id=$1`,
            [c.sessionId]
          );
        const before = await snapshot(c);
        await lock.query('COMMIT');
        const response = await pending;
        expect(response.status, (await response.text()) + http.logs()).toBe(
          change === 'revoke-session' ? 401 : 403
        );
        expect(await snapshot(c)).toEqual(before);
      } finally {
        await lock.query('ROLLBACK');
        lock.release();
        await pending;
      }
    }, 20000);
  }
  for (const expiry of ['session', 'step-up'] as const) {
    it(`${operation} rolls back ${expiry} expiry during the audit write`, async () => {
      const c = await setup(operation),
        before = await snapshot(c);
      await auditHook(operation);
      try {
        await http.pool.query(
          expiry === 'session'
            ? "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1"
            : "UPDATE sessions SET step_up_verified_at=clock_timestamp()-INTERVAL '15 minutes'+INTERVAL '2 seconds' WHERE session_id=$1",
          [c.sessionId]
        );
        const response = await mutate(c);
        expect(response.status, (await response.text()) + http.logs()).toBe(
          expiry === 'session' ? 401 : 403
        );
        await expectWitness();
        expect(await snapshot(c)).toEqual(before);
      } finally {
        await clearHook();
      }
    }, 10000);
  }
}

for (const operation of ['accept', 'decline', 'cancel'] as const) {
  it(`${operation} persists only Expired when the transfer expires during audit`, async () => {
    const c = await setup(operation),
      before = await snapshot(c),
      time = await verifiedAt(c);
    await auditHook(operation);
    try {
      await http.pool.query(
        "UPDATE profile_ownership_transfers SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE id=$1",
        [c.transferId]
      );
      const response = await mutate(c);
      expect(response.status, (await response.text()) + http.logs()).toBe(409);
      await expectWitness();
      const after = await snapshot(c);
      expect(after).toEqual({
        ...before,
        transfers: [{ ...before.transfers[0], status: 'Expired' }],
        audit: [
          {
            event: 'ownership_transfer_expired',
            user_id: c.actor,
            correlation_id: c.correlationId,
            metadata: {
              profileId: c.profileId,
              transferId: c.transferId,
              fromUserId: c.owner,
              toUserId: c.target,
              stepUpVerified: true,
              stepUpVerifiedAt: time,
            },
          },
        ],
      });
    } finally {
      await clearHook();
    }
  }, 10000);
}
it('rolls back ownership and credentials when the replacement expiry audit fails', async () => {
  const c = await setup('accept'),
    before = await snapshot(c);
  await auditHook('accept', true);
  try {
    await http.pool.query(
      "UPDATE profile_ownership_transfers SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE id=$1",
      [c.transferId]
    );
    const response = await mutate(c);
    expect(response.status, (await response.text()) + http.logs()).toBe(500);
    await expectWitness();
    expect(await snapshot(c)).toEqual(before);
  } finally {
    await clearHook();
  }
}, 10000);
for (const operation of ['initiate', 'accept'] as const) {
  it(`${operation} rejects a stale Owner membership as the target's only grant`, async () => {
    const c = await setup(operation);
    await http.pool.query("UPDATE profile_agents SET role='Owner' WHERE profile_id=$1", [
      c.profileId,
    ]);
    const before = await snapshot(c),
      response = await mutate(c);
    expect(response.status, (await response.text()) + http.logs()).toBe(
      operation === 'initiate' ? 400 : 409
    );
    expect(await snapshot(c)).toEqual(before);
  });
}
it('reconciles an expired transfer and binds both audits to the current step-up', async () => {
  const c = await setup('cancel');
  await http.pool.query(
    "UPDATE profile_ownership_transfers SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",
    [c.transferId]
  );
  c.operation = 'initiate';
  const before = await snapshot(c),
    time = await verifiedAt(c),
    response = await mutate(c);
  expect(response.status, (await response.text()) + http.logs()).toBe(201);
  const after = await snapshot(c);
  expect(after.transfers.map((row) => row.status).sort()).toEqual(['Expired', 'Pending']);
  expect(after.audit.map((row) => row.event).sort()).toEqual([
    'ownership_transfer_expired',
    'ownership_transfer_initiated',
  ]);
  for (const audit of after.audit)
    expect(audit).toMatchObject({
      user_id: c.actor,
      correlation_id: c.correlationId,
      metadata: { profileId: c.profileId, stepUpVerified: true, stepUpVerifiedAt: time },
    });
  expect(after.profile).toEqual(before.profile);
  expect(after.sessions).toEqual(before.sessions);
  expect(after.refresh).toEqual(before.refresh);
});
