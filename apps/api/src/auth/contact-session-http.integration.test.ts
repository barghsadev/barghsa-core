import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { startHttpFixture } from '../test/http-fixture.js';

let http: Awaited<ReturnType<typeof startHttpFixture>>;
let sessionId: string;
let headers: Record<string, string>;
beforeEach(async () => {
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  await http.pool.query(
    "INSERT INTO users(user_id,username,email,password_hash) VALUES ('contact-owner','old-contact@example.test','old-contact@example.test','test-only')"
  );
  sessionId = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,'contact-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [sessionId, csrf]
  );
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline) VALUES ($1,'contact-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
    [randomUUID(), randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${sessionId}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
    'X-Correlation-ID': randomUUID(),
  };
}, 40000);
afterEach(async () => {
  await http?.close();
}, 15000);

it.each([
  { operation: 'change-username', issuing: true },
  { operation: 'add-contact', issuing: true },
  { operation: 'change-username', issuing: false },
  { operation: 'add-contact', issuing: false },
])(
  'rolls back $operation issuing=$issuing if the session expires before commit',
  async ({ operation, issuing }) => {
    const username = operation === 'change-username';
    const destination = username ? 'new-contact@example.test' : '+989120007777';
    const body: Record<string, unknown> = username
      ? { newUsername: destination }
      : { contactType: 'mobile', contactValue: destination };
    if (!issuing) {
      const id = randomUUID();
      const previous = username ? randomUUID() : null;
      const hash = createHash('sha256').update('123456').digest('hex');
      if (previous)
        await http.pool.query(
          "INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose,user_id,auth_version) SELECT $1,username,$2,NOW()+INTERVAL '5 minutes','change_username',user_id,auth_version FROM users WHERE user_id='contact-owner'",
          [previous, hash]
        );
      await http.pool.query(
        "INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose,user_id,auth_version,previous_challenge_id) SELECT $1,$2,$3,NOW()+INTERVAL '5 minutes',$4,user_id,auth_version,$5 FROM users WHERE user_id='contact-owner'",
        [id, destination, hash, username ? 'change_username' : 'add_mobile', previous]
      );
      Object.assign(body, {
        otpChallengeId: id,
        otp: '123456',
        ...(username ? { previousOtp: '123456' } : {}),
      });
    }
    const table = issuing ? 'auth_delivery_outbox' : 'audit_log';
    await http.pool.query(
      `CREATE SEQUENCE contact_write_reached; CREATE FUNCTION delay_contact_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM nextval('contact_write_reached'); PERFORM pg_sleep(2.2); RETURN NEW; END $$; CREATE TRIGGER delay_contact_write BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION delay_contact_write()`
    );
    await http.pool.query(
      "UPDATE sessions SET expires_at=clock_timestamp()+INTERVAL '2 seconds' WHERE session_id=$1",
      [sessionId]
    );
    const response = await fetch(
      `${http.base}/api/auth/${operation}${issuing ? '/send-otp' : ''}`,
      { method: 'POST', headers, body: JSON.stringify(body) }
    );
    expect(
      (await http.pool.query('SELECT is_called FROM contact_write_reached')).rows[0].is_called
    ).toBe(true);
    expect(response.status, await response.clone().text()).toBe(401);
    expect(
      (await http.pool.query("SELECT username,mobile FROM users WHERE user_id='contact-owner'"))
        .rows[0]
    ).toEqual({ username: 'old-contact@example.test', mobile: null });
    expect(
      (
        await http.pool.query(
          'SELECT destination FROM account_login_identifiers ORDER BY destination'
        )
      ).rows
    ).toEqual([{ destination: 'old-contact@example.test' }]);
    expect(
      (
        await http.pool.query(
          'SELECT count(*)::int AS count FROM otp_challenges WHERE consumed_at IS NOT NULL'
        )
      ).rows[0].count
    ).toBe(0);
    expect(
      (await http.pool.query('SELECT count(*)::int AS count FROM auth_delivery_outbox')).rows[0]
        .count
    ).toBe(0);
    expect(
      (
        await http.pool.query(
          "SELECT event FROM audit_log WHERE event IN ('username_changed','contact_added')"
        )
      ).rows
    ).toEqual([]);
    expect(
      (
        await http.pool.query(
          'SELECT count(*)::int AS count FROM sessions WHERE revoked_at IS NOT NULL'
        )
      ).rows[0].count
    ).toBe(0);
  }
);

it.each(['change-username', 'add-contact'])(
  'commits %s with its correlated audit and expected session policy',
  async (operation) => {
    const username = operation === 'change-username';
    const destination = username ? 'new-contact@example.test' : '+989120007777';
    const input = username
      ? { newUsername: destination }
      : { contactType: 'mobile', contactValue: destination };
    const post = (path: string, body: unknown) =>
      fetch(`${http.base}/api/auth/${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    const issued = await post(`${operation}/send-otp`, input);
    expect(issued.status, await issued.clone().text()).toBe(200);
    const { challengeId } = (await issued.json()) as { challengeId: string };
    await http.pool.query('UPDATE otp_challenges SET otp_hash=$1', [
      createHash('sha256').update('123456').digest('hex'),
    ]);
    const body = {
      ...input,
      otpChallengeId: challengeId,
      otp: '123456',
      ...(username ? { previousOtp: '123456' } : {}),
    };
    const response = await post(operation, body);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      (await http.pool.query('SELECT revoked_at FROM sessions WHERE session_id=$1', [sessionId]))
        .rows[0].revoked_at
    ).toBeNull();
    const peer = (
      await http.pool.query('SELECT revoked_at FROM sessions WHERE session_id<>$1', [sessionId])
    ).rows[0].revoked_at;
    expect(peer !== null).toBe(username);
    expect(
      (
        await http.pool.query(
          'SELECT user_id FROM account_login_identifiers WHERE destination=$1',
          [destination]
        )
      ).rows
    ).toEqual([{ user_id: 'contact-owner' }]);
    expect(
      (
        await http.pool.query(
          "SELECT correlation_id FROM audit_log WHERE event IN ('username_changed','contact_added')"
        )
      ).rows
    ).toEqual([{ correlation_id: headers['X-Correlation-ID'] }]);
    expect((await post(operation, body)).status).toBe(409);
  }
);
