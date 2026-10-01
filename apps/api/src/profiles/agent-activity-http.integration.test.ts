import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID, randomInt } from 'node:crypto';
import type { TeamActivityPage } from '@barghsa/shared/team-activity';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
beforeAll(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);

async function account(username = `${randomUUID()}@example.test`) {
  const id = randomUUID(),
    session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,'fixture-only')",
    [id, username]
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline)
    VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')`,
    [session, id, csrf, randomUUID()]
  );
  return {
    id,
    username,
    session,
    headers: {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
  };
}
type Account = Awaited<ReturnType<typeof account>>;
async function legal(owner: Account) {
  const id = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,title) VALUES ($1,'LEGAL','ACTIVE','Custom profile label') RETURNING id",
      [owner.id]
    )
  ).rows[0].id as string;
  const nationalIdentifier = String(randomInt(10_000_000_000, 99_999_999_999));
  await http.pool.query(
    `INSERT INTO legal_profiles(id,legal_name,national_identifier,registration_number,representative_title,representative_relationship)
    VALUES ($1,'Example legal entity',$2,'123456','Director','Employee')`,
    [id, nationalIdentifier]
  );
  return { id, nationalIdentifier };
}

async function member(profileId: string, actor: Account, role = 'Finance') {
  await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,$3)', [
    profileId,
    actor.id,
    role,
  ]);
}
async function audit(
  actor: Account,
  event: string,
  metadata: unknown,
  at = '2026-09-01T00:00:00.000001Z'
) {
  const id = randomUUID();
  await http.pool.query(
    'INSERT INTO audit_log(id,user_id,event,metadata,created_at,ip,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [
      id,
      actor.id,
      event,
      typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
      at,
      'private-ip',
      'private-correlation',
    ]
  );
  return id;
}
async function activity(profileId: string, target: Account, actor: Account, cursor?: string) {
  return fetch(
    `${http.base}/api/profiles/${profileId}/agents/${target.id}/activity${cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`}`,
    { headers: actor.headers }
  );
}
it.each(['Owner', 'Manager'])(
  '%s reads only this member’s public history in this legal profile',
  async (role) => {
    const owner = await account(),
      actor = role === 'Owner' ? owner : await account(),
      target = await account(),
      other = await account(),
      profile = await legal(owner),
      foreign = await legal(owner);
    await member(profile.id, target);
    await member(foreign.id, target);
    if (role === 'Manager') await member(profile.id, actor, 'Manager');
    const performed = await audit(target, 'order_created', {
      profileId: profile.id,
      secret: 'private-note',
    });
    const affected = await audit(other, 'agent_roles_changed', {
      profileId: profile.id,
      targetUserId: target.id,
      before: ['Manager'],
      after: ['Finance'],
      password: 'private-password',
    });
    await audit(target, 'order_created', { profileId: foreign.id });
    await audit(other, 'order_created', { profileId: profile.id });
    await audit(target, 'electricity.order_comment_added', {
      profileId: profile.id,
      visibility: 'internal',
    });
    await audit(target, 'login', { profileId: profile.id });
    await audit(target, 'invitation_created', 'legacy invalid JSON');
    await audit(target, 'invitation_created', []);
    const response = await activity(profile.id, target, actor);
    expect(response.status, http.logs()).toBe(200);
    const body = (await response.json()) as TeamActivityPage;
    expect(body).toEqual({
      profileId: profile.id,
      userId: target.id,
      nextCursor: null,
      items: expect.arrayContaining([
        {
          id: performed,
          kind: 'orderCreated',
          createdAt: '2026-09-01T00:00:00.000Z',
          performed: true,
        },
        {
          id: affected,
          kind: 'rolesChanged',
          createdAt: '2026-09-01T00:00:00.000Z',
          performed: false,
        },
      ]),
    });
    expect(body.items).toHaveLength(2);
    expect(JSON.stringify(body)).not.toMatch(
      /private|secret|password|before|after|metadata|correlation/
    );
  }
);
it.each(['Finance', 'Legal', 'stranger'])('%s cannot enumerate member activity', async (role) => {
  const owner = await account(),
    actor = await account(),
    target = await account(),
    profile = await legal(owner);
  await member(profile.id, target);
  if (role !== 'stranger') await member(profile.id, actor, role);
  expect((await activity(profile.id, target, actor)).status).toBe(403);
  expect((await activity(profile.id, await account(), actor)).status).toBe(403);
});
it('resolves a legacy order through its resource and lets explicit profileId win', async () => {
  const owner = await account(),
    target = await account(),
    profile = await legal(owner),
    foreign = await legal(owner);
  await member(profile.id, target);
  const product = (
    await http.pool.query(
      "INSERT INTO products(type,title) VALUES ('hardware',$1::jsonb) RETURNING id",
      [JSON.stringify({ fa: 'تست', en: 'Test' })]
    )
  ).rows[0].id;
  const order = (
    await http.pool.query(
      `INSERT INTO orders(user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES ($1,$2,$3,'electricity','province','city','address','1234567890') RETURNING id`,
      [target.id, profile.id, product]
    )
  ).rows[0].id;
  const expected = await audit(target, 'order_created', { orderId: order });
  await audit(target, 'order_created', { orderId: order, profileId: foreign.id });
  await audit(target, 'order_created', { orderId: 'not-a-uuid' });
  const response = await activity(profile.id, target, owner);
  expect(response.status, http.logs()).toBe(200);
  expect(((await response.json()) as TeamActivityPage).items.map((row) => row.id)).toEqual([
    expected,
  ]);
});
it('paginates equal and sub-millisecond timestamps exactly, without duplicates or missed entries', async () => {
  const owner = await account(),
    target = await account(),
    profile = await legal(owner);
  await member(profile.id, target);
  const expected = [] as string[];
  for (let i = 0; i < 105; i++)
    expected.push(
      await audit(
        target,
        'order_created',
        { profileId: profile.id },
        `2026-09-01T00:00:00.${String(i < 70 ? 1 : 2).padStart(6, '0')}Z`
      )
    );
  const actual = [] as string[];
  let cursor: string | undefined;
  do {
    const response = await activity(profile.id, target, owner, cursor);
    expect(response.status, http.logs()).toBe(200);
    const page = (await response.json()) as TeamActivityPage;
    expect(page.items.length).toBeLessThanOrEqual(50);
    actual.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  expect(actual).toHaveLength(105);
  expect(new Set(actual)).toEqual(new Set(expected));
  const sorted = (
    await http.pool.query(
      "SELECT id FROM audit_log WHERE user_id=$1 AND event='order_created' ORDER BY created_at DESC,id DESC",
      [target.id]
    )
  ).rows.map((row) => row.id);
  expect(actual).toEqual(sorted);
});
it('rejects forged, invalid-time and cross-scope cursors and rechecks membership and permission', async () => {
  const owner = await account(),
    manager = await account(),
    target = await account(),
    other = await account(),
    profile = await legal(owner),
    foreign = await legal(owner);
  await member(profile.id, manager, 'Manager');
  await member(profile.id, target);
  await member(profile.id, other);
  await member(foreign.id, target);
  for (let i = 0; i < 51; i++) await audit(target, 'order_created', { profileId: profile.id });
  const first = await activity(profile.id, target, manager);
  expect(first.status, http.logs()).toBe(200);
  const cursor = ((await first.json()) as TeamActivityPage).nextCursor!;
  expect(cursor).toBeTruthy();
  expect((await activity(foreign.id, target, owner, cursor)).status).toBe(400);
  expect((await activity(profile.id, other, owner, cursor)).status).toBe(400);
  const anchor = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  for (const value of [
    'bad=',
    'a'.repeat(2049),
    Buffer.from(JSON.stringify({ ...anchor, id: randomUUID() })).toString('base64url'),
    Buffer.from(JSON.stringify({ ...anchor, createdAt: '2026-99-01T00:00:00.000001Z' })).toString(
      'base64url'
    ),
  ])
    expect((await activity(profile.id, target, owner, value)).status).toBe(400);
  await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
    profile.id,
    manager.id,
  ]);
  expect((await activity(profile.id, target, manager, cursor)).status).toBe(403);
  await http.pool.query('DELETE FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
    profile.id,
    target.id,
  ]);
  expect((await activity(profile.id, target, owner, cursor)).status).toBe(404);
  await http.pool.query('UPDATE profiles SET archived=true WHERE id=$1', [profile.id]);
  expect((await activity(profile.id, owner, owner)).status).toBe(403);
});
