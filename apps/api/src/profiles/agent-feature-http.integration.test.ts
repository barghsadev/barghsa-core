import { fetchWithPreauth } from '../test/public-auth.js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID, randomInt } from 'node:crypto';
import type { AgentListResponseDto } from './agents.service.js';
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
function invite(profileId: string, actor: Account, username: string, role = 'Finance') {
  return fetch(`${http.base}/api/profiles/${profileId}/invitations`, {
    method: 'POST',
    headers: actor.headers,
    body: JSON.stringify({ username, role }),
  });
}
async function pending(actor: { headers: Record<string, string> }) {
  const response = await fetch(`${http.base}/api/invitations/pending`, { headers: actor.headers });
  expect(response.status, http.logs()).toBe(200);
  return ((await response.json()) as { invitations: Array<Record<string, unknown>> }).invitations;
}
async function effects(profileId: string, recipient: { id: string }) {
  return {
    invitations: (
      await http.pool.query('SELECT id,status FROM profile_invitations WHERE profile_id=$1', [
        profileId,
      ])
    ).rows,
    audit: (
      await http.pool.query("SELECT event FROM audit_log WHERE metadata::jsonb->>'profileId'=$1", [
        profileId,
      ])
    ).rows,
    notices: (
      await http.pool.query('SELECT id FROM in_app_notifications WHERE recipient_user_id=$1', [
        recipient.id,
      ])
    ).rows,
  };
}

it.each(['Owner', 'Manager'])(
  '%s list preserves invitation privacy and excludes expired pending rows',
  async (role) => {
    const owner = await account(),
      actor = role === 'Owner' ? owner : await account(),
      recipient = await account(),
      profile = await legal(owner);
    if (role === 'Manager')
      await http.pool.query(
        "INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,'Manager')",
        [profile.id, actor.id]
      );
    for (const username of [recipient.username, `${randomUUID()}@example.test`])
      expect((await invite(profile.id, actor, username)).status, http.logs()).toBe(201);
    await http.pool.query(
      "INSERT INTO profile_invitations(profile_id,username,role,invited_by,status,expires_at) VALUES ($1,'expired@example.test','Legal',$2,'Pending',NOW()-INTERVAL '1 second')",
      [profile.id, owner.id]
    );
    const response = await fetch(`${http.base}/api/profiles/${profile.id}/agents`, {
      headers: actor.headers,
    });
    expect(response.status, http.logs()).toBe(200);
    const body = (await response.json()) as AgentListResponseDto & {
      canTransferOwnership: boolean;
    };
    expect(body.profileName).toBe('Example legal entity');
    expect(body.canTransferOwnership).toBe(role === 'Owner');
    const invitations = body.agents.filter((row: { type: string }) => row.type === 'invitation');
    expect(invitations).toHaveLength(2);
    for (const row of invitations)
      expect(row).toMatchObject({ userId: null, name: null, status: 'Pending', joinedAt: null });
    expect(invitations.map((row) => row.username)).not.toContain('expired@example.test');
    if (role === 'Manager')
      expect(body.agents.find((row: { type: string }) => row.type === 'agent')).toMatchObject({
        username: actor.username,
        role: 'Manager',
        status: 'Active',
        joinedAt: expect.any(String),
      });
  }
);

it.each(['Finance', 'Legal', 'stranger'])('%s cannot read the private agent list', async (role) => {
  const owner = await account(),
    actor = await account(),
    profile = await legal(owner);
  if (role !== 'stranger')
    await http.pool.query('INSERT INTO profile_agents(profile_id,user_id,role) VALUES ($1,$2,$3)', [
      profile.id,
      actor.id,
      role,
    ]);
  expect(
    (await fetch(`${http.base}/api/profiles/${profile.id}/agents`, { headers: actor.headers }))
      .status
  ).toBe(403);
});

it('creates a localized user notice and private entity details for the registered invitee', async () => {
  const owner = await account(),
    recipient = await account(),
    stranger = await account(),
    profile = await legal(owner);
  const response = await invite(profile.id, owner, recipient.username);
  expect(response.status, http.logs()).toBe(201);
  const result = (await response.json()) as { id: string };
  expect(Object.keys(result)).toEqual(['id']);
  const notice = (
    await http.pool.query(
      'SELECT recipient_user_id,profile_id,localized_content,link_route FROM in_app_notifications WHERE recipient_user_id=$1',
      [recipient.id]
    )
  ).rows[0];
  expect(notice).toMatchObject({
    recipient_user_id: recipient.id,
    profile_id: null,
    link_route: '/dashboard',
    localized_content: {
      fa: { title: 'دعوت به تیم', body: expect.stringContaining('مالی') },
      en: { title: 'Team invitation', body: expect.stringContaining('Example legal entity') },
    },
  });
  expect(await pending(recipient)).toEqual([
    expect.objectContaining({
      id: result.id,
      profileName: 'Example legal entity',
      inviterName: owner.username,
      role: 'Finance',
      entity: { nationalIdentifier: profile.nationalIdentifier, registrationNumber: '123456' },
    }),
  ]);
  expect(await pending(stranger)).toEqual([]);
  const inbox = await fetch(`${http.base}/api/v1/notifications`, {
    headers: { ...recipient.headers, 'Accept-Language': 'en' },
  });
  expect(inbox.status, http.logs()).toBe(200);
  expect(JSON.stringify(await inbox.json())).toContain('Team invitation');
  expect((await invite(profile.id, owner, recipient.username)).status).toBe(409);
  expect((await effects(profile.id, recipient)).notices).toHaveLength(1);
});

it('an unregistered username discovers the same pending invite after account creation without an automatic grant', async () => {
  const owner = await account(),
    profile = await legal(owner),
    username = `${randomUUID()}@example.test`;
  const response = await invite(profile.id, owner, username.toUpperCase());
  expect(response.status, http.logs()).toBe(201);
  const id = ((await response.json()) as { id: string }).id;
  const terms = randomUUID();
  await http.pool.query(
    "INSERT INTO tos_versions(id,version_id,content_fa,content_en,status,is_active,published_at,change_type) VALUES ($1,$2,'قوانین','Terms','published',true,NOW(),'major')",
    [terms, terms]
  );
  const registration = await fetchWithPreauth(`${http.base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: 'Invitation-registration-123!',
      tosVersionId: terms,
    }),
  });
  expect(registration.status, http.logs()).toBe(200);
  const { challengeId } = (await registration.json()) as { challengeId: string };
  // Exercise the real verified-username flow. Transport is outside this batch.
  await http.pool.query('UPDATE otp_challenges SET otp_hash=$1 WHERE challenge_id=$2', [
    createHash('sha256').update('123456').digest('hex'),
    challengeId,
  ]);
  const verification = await fetchWithPreauth(`${http.base}/api/auth/register/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challengeId, otp: '123456' }),
  });
  expect(verification.status, http.logs()).toBe(200);
  const registered = (await verification.json()) as { userId: string; csrfToken: string };
  const recipient = {
    id: registered.userId as string,
    headers: {
      Cookie: verification.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
      'X-CSRF-Token': registered.csrfToken as string,
      'Content-Type': 'application/json',
    },
  };
  expect(await pending(recipient)).toEqual([expect.objectContaining({ id, role: 'Finance' })]);
  expect(
    (
      await http.pool.query('SELECT id FROM profile_agents WHERE profile_id=$1 AND user_id=$2', [
        profile.id,
        recipient.id,
      ])
    ).rows
  ).toEqual([]);
  expect((await effects(profile.id, recipient)).notices).toEqual([]);
});

it('allows ten invitations per profile per hour and rejects the next without another write', async () => {
  const owner = await account(),
    profile = await legal(owner);
  for (let i = 0; i < 10; i++)
    expect(
      (await invite(profile.id, owner, `${randomUUID()}@example.test`)).status,
      http.logs()
    ).toBe(201);
  const limited = await invite(profile.id, owner, `${randomUUID()}@example.test`);
  expect(limited.status).toBe(429);
  const saved = await effects(profile.id, owner);
  expect(saved.invitations).toHaveLength(10);
  expect(saved.audit).toHaveLength(10);
  const dates = (
    await http.pool.query(
      'SELECT extract(epoch FROM expires_at-created_at)::int AS seconds FROM profile_invitations WHERE profile_id=$1',
      [profile.id]
    )
  ).rows;
  expect(dates.every((row) => row.seconds === 7 * 24 * 60 * 60)).toBe(true);
});

it('notice insertion failure rolls back invitation and audit and allows a clean retry', async () => {
  const owner = await account(),
    recipient = await account(),
    profile = await legal(owner);
  await http.pool.query(
    "CREATE FUNCTION reject_invite_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture notice failure'; END $$"
  );
  await http.pool.query(
    'CREATE TRIGGER reject_invite_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION reject_invite_notice()'
  );
  try {
    expect((await invite(profile.id, owner, recipient.username)).status).toBe(500);
    expect(await effects(profile.id, recipient)).toEqual({
      invitations: [],
      audit: [],
      notices: [],
    });
  } finally {
    await http.pool.query('DROP TRIGGER reject_invite_notice ON in_app_notifications');
    await http.pool.query('DROP FUNCTION reject_invite_notice()');
  }
  expect((await invite(profile.id, owner, recipient.username)).status, http.logs()).toBe(201);
  const saved = await effects(profile.id, recipient);
  expect(saved.invitations).toHaveLength(1);
  expect(saved.audit).toEqual([{ event: 'invitation_created' }]);
  expect(saved.notices).toHaveLength(1);
});

it('authorization expiry during notice insertion rolls back every effect', async () => {
  const owner = await account(),
    recipient = await account(),
    profile = await legal(owner);
  await http.pool.query('CREATE SEQUENCE invitation_notice_witness');
  await http.pool.query(
    "CREATE FUNCTION delay_invite_notice() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('invitation_notice_witness');PERFORM pg_sleep(2.2);RETURN NEW;END $$"
  );
  await http.pool.query(
    'CREATE TRIGGER delay_invite_notice BEFORE INSERT ON in_app_notifications FOR EACH ROW EXECUTE FUNCTION delay_invite_notice()'
  );
  try {
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
      [owner.session]
    );
    expect((await invite(profile.id, owner, recipient.username)).status, http.logs()).toBe(401);
    expect(
      (await http.pool.query('SELECT is_called FROM invitation_notice_witness')).rows[0].is_called
    ).toBe(true);
    expect(await effects(profile.id, recipient)).toEqual({
      invitations: [],
      audit: [],
      notices: [],
    });
  } finally {
    await http.pool.query('DROP TRIGGER delay_invite_notice ON in_app_notifications');
    await http.pool.query('DROP FUNCTION delay_invite_notice()');
    await http.pool.query('DROP SEQUENCE invitation_notice_witness');
  }
}, 10000);

it('opposite invitations complete without account-lock deadlock', async () => {
  const a = await account(),
    b = await account(),
    pa = await legal(a),
    pb = await legal(b),
    lock = await http.pool.connect();
  let attempts: Promise<Response>[] = [];
  await http.pool.query(
    "CREATE FUNCTION pause_invitation_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event='invitation_created' THEN PERFORM pg_sleep(0.2);END IF;RETURN NEW;END $$"
  );
  await http.pool.query(
    'CREATE TRIGGER pause_invitation_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION pause_invitation_audit()'
  );
  try {
    await lock.query('BEGIN');
    await lock.query('SELECT id FROM profiles WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [
      [pa.id, pb.id],
    ]);
    attempts = [invite(pa.id, a, b.username), invite(pb.id, b, a.username)];
    await expect
      .poll(
        async () =>
          (
            await http.pool.query(
              "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT user_id FROM profiles WHERE id=$1%'"
            )
          ).rows[0].count,
        { timeout: 10000 }
      )
      .toBe(2);
    await lock.query('COMMIT');
    const responses = await Promise.all(attempts);
    expect(
      responses.map((r) => r.status),
      http.logs()
    ).toEqual([201, 201]);
    expect((await effects(pa.id, b)).notices).toHaveLength(1);
    expect((await effects(pb.id, a)).notices).toHaveLength(1);
  } finally {
    await lock.query('ROLLBACK');
    lock.release();
    await Promise.allSettled(attempts);
    await http.pool.query('DROP TRIGGER pause_invitation_audit ON audit_log');
    await http.pool.query('DROP FUNCTION pause_invitation_audit()');
  }
}, 15000);
