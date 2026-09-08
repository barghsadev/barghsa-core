import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import * as argon2 from 'argon2';
import { createMigratedTestDb } from '../test/migrated-db';
import { seedAdmin } from './index';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
const password = 'Fixture-only-password-123!';
beforeEach(async () => {
  vi.stubEnv('ADMIN_BOOTSTRAP_SECRET', 'fixture-secret');
  vi.stubEnv('ADMIN_BOOTSTRAP_KEY', 'fixture-key');
  vi.stubEnv('ADMIN_BOOTSTRAP_EMAIL', 'FIRST@example.test');
  vi.stubEnv('ADMIN_BOOTSTRAP_PASSWORD', password);
  fixture = await createMigratedTestDb();
}, 30000);
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await fixture?.close();
});

it('requires explicit complete credentials and a valid password before creating the first admin', async () => {
  vi.stubEnv('ADMIN_BOOTSTRAP_KEY', '');
  expect((await seedAdmin(fixture.db, false)).errors).toHaveLength(1);
  vi.stubEnv('ADMIN_BOOTSTRAP_KEY', 'fixture-key');
  vi.stubEnv('ADMIN_BOOTSTRAP_PASSWORD', 'weak');
  expect((await seedAdmin(fixture.db, false)).errors).toHaveLength(1);
  expect((await fixture.pool.query('SELECT user_id FROM users')).rows).toEqual([]);
  for (const key of [
    'ADMIN_BOOTSTRAP_KEY',
    'ADMIN_BOOTSTRAP_SECRET',
    'ADMIN_BOOTSTRAP_EMAIL',
    'ADMIN_BOOTSTRAP_PASSWORD',
  ])
    vi.stubEnv(key, '');
  expect(await seedAdmin(fixture.db, false)).toMatchObject({ created: 0, skipped: 1, errors: [] });
});

it('creates one admin across concurrent identities, hashes credentials, audits once and emits no secret', async () => {
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const first = seedAdmin(fixture.db, false);
  vi.stubEnv('ADMIN_BOOTSTRAP_EMAIL', 'second@example.test');
  const second = seedAdmin(fixture.db, false);
  const results = await Promise.all([first, second]);
  expect(results.reduce((sum, result) => sum + result.created, 0)).toBe(1);
  expect(results.reduce((sum, result) => sum + result.skipped, 0)).toBe(1);
  expect(results.flatMap((result) => result.errors)).toEqual([]);
  const admins = (
    await fixture.pool.query(
      'SELECT username,password_hash,is_admin,is_staff,must_change_password FROM users'
    )
  ).rows;
  expect(admins).toHaveLength(1);
  expect(admins[0]).toMatchObject({ is_admin: true, is_staff: true, must_change_password: true });
  expect(admins[0].password_hash).toMatch(/^\$argon2id\$v=19\$m=37888,(?:t=3,p=1|p=1,t=3)\$/);
  expect(await argon2.verify(admins[0].password_hash, password)).toBe(true);
  const audit = (
    await fixture.pool.query("SELECT metadata FROM audit_log WHERE event='admin_bootstrapped'")
  ).rows;
  expect(audit).toHaveLength(1);
  const output = JSON.stringify([stderr.mock.calls, stdout.mock.calls, results, audit]);
  for (const secret of [password, 'fixture-secret', 'fixture-key'])
    expect(output).not.toContain(secret);
});

it('never replaces a disabled administrator or turns an existing customer into an admin', async () => {
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('customer','first@example.test','test')"
  );
  expect((await seedAdmin(fixture.db, false)).errors).toHaveLength(1);
  expect(
    (await fixture.pool.query("SELECT is_admin FROM users WHERE user_id='customer'")).rows[0]
      .is_admin
  ).toBe(false);
  await fixture.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin,disabled_at) VALUES ('existing','prior@example.test','test',true,NOW())"
  );
  vi.stubEnv('ADMIN_BOOTSTRAP_EMAIL', 'replacement@example.test');
  expect(await seedAdmin(fixture.db, false)).toMatchObject({ created: 0, skipped: 1, errors: [] });
  expect(
    (await fixture.pool.query('SELECT count(*)::int AS count FROM users WHERE is_admin')).rows[0]
      .count
  ).toBe(1);
});

it('rolls back account creation on audit failure and permits a clean retry', async () => {
  await fixture.pool
    .query(`CREATE FUNCTION fail_bootstrap_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$;
    CREATE TRIGGER fail_bootstrap_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_bootstrap_audit()`);
  const result = await seedAdmin(fixture.db, false);
  expect(result.created).toBe(0);
  expect(result.errors).toHaveLength(1);
  expect((await fixture.pool.query('SELECT user_id FROM users')).rows).toEqual([]);
  await fixture.pool.query(
    'DROP TRIGGER fail_bootstrap_audit ON audit_log; DROP FUNCTION fail_bootstrap_audit()'
  );
  expect(await seedAdmin(fixture.db, false)).toMatchObject({ created: 1, skipped: 0, errors: [] });
});
