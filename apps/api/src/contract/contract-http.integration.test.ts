import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
import type { ContractService } from './contract.service.js';
type ContractDto = Awaited<ReturnType<ContractService['get']>>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const headers: Record<string, Record<string, string>> = {};
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  for (const [user, role] of [
    ['contract-legal', 'role-legal-contracts'],
    ['contract-support', 'role-customer-support'],
  ]) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',true)",
      [user]
    );
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [user, role]);
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')",
      [session, user, csrf, randomUUID()]
    );
    headers[user!] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
}, 40_000);
afterAll(async () => {
  await http?.close();
});
beforeEach(async () => {
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 second' WHERE user_id='contract-legal'"
  );
  await http.pool.query(
    "INSERT INTO user_roles(user_id,role_id) VALUES('contract-legal','role-legal-contracts') ON CONFLICT DO NOTHING"
  );
});
async function profile() {
  const user = randomUUID(),
    id = randomUUID();
  await http.pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
    user,
  ]);
  await http.pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [id, user]);
  return id;
}
async function input() {
  return {
    profileId: await profile(),
    serviceType: 'electricity',
    content: { price: '9007199254740993', termMonths: 12 },
    changeDescription: 'Initial draft',
    idempotencyKey: randomUUID(),
  };
}
function send(path = '', method = 'GET', body?: unknown, user = 'contract-legal') {
  return fetch(http.base + '/api/admin/contracts' + path, {
    method,
    headers: headers[user]!,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function create(body?: Awaited<ReturnType<typeof input>>) {
  const response = await send('', 'POST', body ?? (await input()));
  expect(response.status).toBe(201);
  return (await response.json()) as ContractDto;
}
function edit(row: ContractDto) {
  return {
    expectedVersionId: row.currentVersionId,
    content: { price: '200' },
    changeDescription: 'Reprice draft',
    idempotencyKey: randomUUID(),
  };
}
it('creates and reads exact full snapshots and immutable version metadata', async () => {
  const row = await create();
  expect(row).toMatchObject({
    state: 'Draft',
    currentVersion: {
      versionNumber: 1,
      content: { price: '9007199254740993' },
      createdBy: 'contract-legal',
    },
  });
  expect((await send('/' + row.id)).status).toBe(200);
  const changed = await send('/' + row.id, 'PATCH', edit(row));
  expect(changed.status).toBe(200);
  const next = (await changed.json()) as ContractDto;
  expect(next.currentVersion).toMatchObject({ versionNumber: 2, content: { price: '200' } });
  const old = await send('/' + row.id + '/versions/' + row.currentVersionId);
  expect(await old.json()).toEqual(row.currentVersion);
  const list = (await (await send('/' + row.id + '/versions')).json()) as {
    versions: Array<{ versionNumber: number; content?: unknown }>;
    nextBefore: number | null;
  };
  expect(list.versions.map((v) => v.versionNumber)).toEqual([2, 1]);
  expect(list.versions[0]?.content).toBeUndefined();
  expect(list.nextBefore).toBeNull();
  const cursor = (await (await send('/' + row.id + '/versions?before=2')).json()) as typeof list;
  expect(cursor.versions.map((v) => v.versionNumber)).toEqual([1]);
  expect(
    (
      await http.pool.query(
        "SELECT event FROM audit_log WHERE metadata::jsonb->>'contractId'=$1 ORDER BY created_at",
        [row.id]
      )
    ).rows.map((r) => r.event)
  ).toEqual(['contract.created', 'contract.version_created']);
});
it('replays concurrent create and edit requests exactly once', async () => {
  const body = await input();
  const responses = await Promise.all([send('', 'POST', body), send('', 'POST', body)]);
  expect(responses.map((r) => r.status)).toEqual([201, 201]);
  const row = (await responses[0]!.json()) as ContractDto;
  expect(await responses[1]!.json()).toEqual(row);
  const change = edit(row);
  const edits = await Promise.all([
    send('/' + row.id, 'PATCH', change),
    send('/' + row.id, 'PATCH', change),
  ]);
  expect(edits.map((r) => r.status)).toEqual([200, 200]);
  expect(await edits[0]!.json()).toEqual(await edits[1]!.json());
  expect(
    (await http.pool.query('SELECT count(*) FROM contract_versions WHERE contract_id=$1', [row.id]))
      .rows[0].count
  ).toBe('2');
  expect((await send('', 'POST', { ...body, content: { price: 'different' } })).status).toBe(409);
  expect(
    (await send('/' + row.id, 'PATCH', { ...change, content: { price: 'different' } })).status
  ).toBe(409);
});
it('rejects competing edits and preserves the winning full snapshot', async () => {
  const row = await create();
  const results = await Promise.all([
    send('/' + row.id, 'PATCH', edit(row)),
    send('/' + row.id, 'PATCH', { ...edit(row), content: { price: '300' } }),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const winner = await results.find((r) => r.status === 200)!.json();
  expect(await (await send('/' + row.id)).json()).toEqual(winner);
});
it('does not create a version for reordered but unchanged content', async () => {
  const row = await create();
  const result = await send('/' + row.id, 'PATCH', {
    ...edit(row),
    content: { termMonths: 12, price: '9007199254740993' },
  });
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(row);
});
it('rejects archived-profile mutations but preserves successful retry results', async () => {
  const body = await input(),
    row = await create(body);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [body.profileId]);
  expect((await send('', 'POST', { ...body, idempotencyKey: randomUUID() })).status).toBe(409);
  expect((await send('/' + row.id, 'PATCH', edit(row))).status).toBe(409);
  expect(await (await send('', 'POST', body)).json()).toEqual(row);
});
it.each([
  'AwaitingStaffReview',
  'AwaitingCustomerAcceptance',
  'Accepted',
  'Active',
  'Cancelled',
  'Completed',
])('rejects draft edits in %s', async (state) => {
  const row = await create();
  if (['AwaitingCustomerAcceptance', 'Accepted'].includes(state)) {
    await http.pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [row.id]);
    await http.pool.query(
      "INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,'contract-legal')",
      [row.id, row.currentVersionId]
    );
    if (state === 'Accepted')
      await http.pool.query(
        "INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,'contract-legal')",
        [row.id, row.currentVersionId]
      );
  } else await http.pool.query('UPDATE contracts SET state=$2 WHERE id=$1', [row.id, state]);
  expect((await send('/' + row.id, 'PATCH', edit(row))).status).toBe(409);
});
it('enforces authentication, legal permission, current grants and step-up', async () => {
  const body = await input(),
    row = await create(body);
  expect((await fetch(http.base + '/api/admin/contracts/' + row.id)).status).toBe(401);
  expect((await send('', 'POST', body, 'contract-support')).status).toBe(403);
  expect((await send('/' + row.id, 'GET', undefined, 'contract-support')).status).toBe(403);
  await http.pool.query(
    "UPDATE sessions SET step_up_verified_at=NOW()-INTERVAL '1 day' WHERE user_id='contract-legal'"
  );
  expect((await send('', 'POST', body)).status).toBe(403);
  await http.pool.query("DELETE FROM user_roles WHERE user_id='contract-legal'");
  expect((await send('/' + row.id)).status).toBe(403);
});
it.each([
  { content: {} },
  { content: [] },
  { content: { body: 'x'.repeat(65537) } },
  { serviceType: 'consultation' },
  { changeDescription: ' ' },
  { profileId: 'bad' },
  { surprise: true },
])('rejects invalid input case %#', async (patch) => {
  expect((await send('', 'POST', { ...(await input()), ...patch })).status).toBe(400);
});
it('rejects invalid IDs and cursors and does not cross contract version boundaries', async () => {
  const a = await create(),
    b = await create();
  for (const path of [
    '/bad',
    '/' + a.id + '/versions/bad',
    '/' + a.id + '/versions?before=0',
    '/' + a.id + '/versions?before=x',
  ])
    expect((await send(path)).status).toBe(400);
  for (const path of [
    '/' + randomUUID(),
    '/' + randomUUID() + '/versions',
    '/' + a.id + '/versions/' + b.currentVersionId,
  ])
    expect((await send(path)).status).toBe(404);
  expect((await send('/' + randomUUID(), 'PATCH', edit(a))).status).toBe(404);
});
it('rolls back the version, current pointer and idempotency result when audit fails', async () => {
  const row = await create(),
    change = edit(row);
  await http.pool.query(
    "CREATE FUNCTION reject_contract_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='contract.version_created' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$"
  );
  await http.pool.query(
    'CREATE TRIGGER reject_contract_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_contract_audit()'
  );
  try {
    expect((await send('/' + row.id, 'PATCH', change)).status).toBe(500);
  } finally {
    await http.pool.query('DROP TRIGGER reject_contract_audit ON audit_log');
    await http.pool.query('DROP FUNCTION reject_contract_audit()');
  }
  expect(await (await send('/' + row.id)).json()).toEqual(row);
  expect((await send('/' + row.id, 'PATCH', change)).status).toBe(200);
});
it('rejects missing profiles and unavailable orders', async () => {
  const body = await input();
  expect((await send('', 'POST', { ...body, profileId: randomUUID() })).status).toBe(404);
  expect((await send('', 'POST', { ...body, orderId: randomUUID() })).status).toBe(409);
});

it('links only matching live orders and keeps that identity stable', async () => {
  const body = await input();
  const order = randomUUID();
  const owner = (
    await http.pool.query('SELECT user_id FROM profiles WHERE id=$1', [body.profileId])
  ).rows[0].user_id;
  const product = (
    await http.pool.query(
      "INSERT INTO products(type,title) VALUES('hardware',$1::jsonb) RETURNING id",
      [JSON.stringify({ fa: 'تست', en: 'Test' })]
    )
  ).rows[0].id;
  await http.pool.query(
    "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','p','c','address','1234567890')",
    [order, owner, body.profileId, product]
  );
  expect(
    (await send('', 'POST', { ...body, orderId: order, profileId: await profile() })).status
  ).toBe(409);
  expect((await send('', 'POST', { ...body, orderId: order, serviceType: 'solar' })).status).toBe(
    409
  );
  const row = await create({ ...body, orderId: order } as typeof body);
  expect(row.orderId).toBe(order);
  await expect(
    http.pool.query("UPDATE orders SET order_type='solar' WHERE id=$1", [order])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query('UPDATE orders SET profile_id=$2 WHERE id=$1', [order, await profile()])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    http.pool.query("UPDATE contracts SET service_type='solar' WHERE id=$1", [row.id])
  ).rejects.toMatchObject({ code: '23514' });
  await http.pool.query("UPDATE orders SET status='CANCELLED' WHERE id=$1", [order]);
  expect(
    (await send('', 'POST', { ...body, orderId: order, idempotencyKey: randomUUID() })).status
  ).toBe(409);
});
it('bounds version history and provides the next exclusive cursor', async () => {
  const row = await create();
  const client = await http.pool.connect();
  try {
    await client.query('BEGIN');
    let current = row.currentVersionId;
    for (let number = 2; number <= 101; number++) {
      current = randomUUID();
      await client.query(
        "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,$3,$4,'Revision','contract-legal')",
        [current, row.id, number, { revision: number }]
      );
    }
    await client.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [row.id, current]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const first = (await (await send('/' + row.id + '/versions')).json()) as {
    versions: unknown[];
    nextBefore: number;
  };
  expect(first.versions).toHaveLength(100);
  expect(first.nextBefore).toBe(2);
  const last = (await (
    await send('/' + row.id + '/versions?before=' + first.nextBefore)
  ).json()) as { versions: Array<{ versionNumber: number }>; nextBefore: null };
  expect(last.versions.map((v) => v.versionNumber)).toEqual([1]);
  expect(last.nextBefore).toBeNull();
});

it('rejects revoked legal grants after an in-flight request waits for the actor lock', async () => {
  const body = await input(),
    client = await http.pool.connect();
  let pending: Promise<Response> | undefined;
  try {
    await client.query('BEGIN');
    await client.query("SELECT user_id FROM users WHERE user_id='contract-legal' FOR UPDATE");
    await client.query("DELETE FROM user_roles WHERE user_id='contract-legal'");
    const blocker = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = send('', 'POST', body);
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await http.pool.query(
        'SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pg_blocking_pids(pid) @> ARRAY[$1]::integer[]',
        [blocker]
      );
      if (result.rows.length) {
        waiting = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(waiting).toBe(true);
    await client.query('COMMIT');
    expect((await pending).status).toBe(403);
    expect(
      (
        await http.pool.query('SELECT count(*) FROM contracts WHERE profile_id=$1', [
          body.profileId,
        ])
      ).rows[0].count
    ).toBe('0');
  } finally {
    await client.query('ROLLBACK');
    client.release();
    await pending;
  }
});
