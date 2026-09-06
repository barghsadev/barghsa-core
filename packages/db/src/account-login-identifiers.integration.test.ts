import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from './migrate';
let pool: Pool;
const database = `test_login_identifiers_${randomUUID().replaceAll('-', '')}`;
beforeAll(async () => {
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await management.query(`CREATE DATABASE "${database}"`);
  } finally {
    await management.end();
  }
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  expect((await runMigrations({ connection: { pgdirectUrl: url.toString() } })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
}, 30000);
afterAll(async () => {
  await pool?.end();
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await management.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  } finally {
    await management.end();
  }
});
it('reserves only primary usernames until a matching secondary contact has explicit proof', async () => {
  await pool.query(
    "INSERT INTO users(user_id,username,email,mobile,password_hash) VALUES ('alias-owner','primary@example.test','legacy@example.test','+989120000001','test-only')"
  );
  expect(
    (
      await pool.query(
        "SELECT destination,kind,verified_at FROM account_login_identifiers WHERE user_id='alias-owner'"
      )
    ).rows
  ).toEqual([{ destination: 'primary@example.test', kind: 'primary', verified_at: null }]);
  await expect(
    pool.query(
      "INSERT INTO account_login_identifiers(destination,user_id,kind) VALUES ('legacy@example.test','alias-owner','email')"
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    pool.query(
      "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ('unbound@example.test','alias-owner','email',NOW())"
    )
  ).rejects.toMatchObject({ code: '23514' });
  await pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ('legacy@example.test','alias-owner','email',NOW())"
  );
  await expect(
    pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('alias-conflict','LEGACY@EXAMPLE.TEST','test-only')"
    )
  ).rejects.toMatchObject({ code: '23505' });
  expect(
    (await pool.query("SELECT user_id FROM users WHERE user_id='alias-conflict'")).rows
  ).toHaveLength(0);
  await pool.query("UPDATE users SET email='replacement@example.test' WHERE user_id='alias-owner'");
  expect(
    (
      await pool.query(
        "SELECT destination FROM account_login_identifiers WHERE user_id='alias-owner'"
      )
    ).rows
  ).toEqual([{ destination: 'primary@example.test' }]);
  await pool.query(
    "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ('replacement@example.test','alias-owner','email',NOW())"
  );
  await pool.query(
    "UPDATE users SET username='replacement@example.test' WHERE user_id='alias-owner'"
  );
  expect(
    (
      await pool.query(
        "SELECT destination,kind,verified_at FROM account_login_identifiers WHERE user_id='alias-owner'"
      )
    ).rows
  ).toEqual([{ destination: 'replacement@example.test', kind: 'primary', verified_at: null }]);
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES ('reserved-owner','reserved@example.test','test-only')"
  );
  await expect(
    pool.query("UPDATE users SET username='reserved@example.test' WHERE user_id='alias-owner'")
  ).rejects.toMatchObject({ code: '23505' });
  expect(
    (
      await pool.query(
        "SELECT destination FROM account_login_identifiers WHERE user_id='alias-owner'"
      )
    ).rows
  ).toEqual([{ destination: 'replacement@example.test' }]);
});
it('lets exactly one competing primary registration or secondary claim reserve a destination', async () => {
  await pool.query(
    "INSERT INTO users(user_id,username,email,password_hash) VALUES ('racing-owner','racing-primary@example.test','racing-contact@example.test','test-only')"
  );
  const results = await Promise.allSettled([
    pool.query(
      "INSERT INTO account_login_identifiers(destination,user_id,kind,verified_at) VALUES ('racing-contact@example.test','racing-owner','email',NOW())"
    ),
    pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('racing-new','racing-contact@example.test','test-only')"
    ),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  expect(rejected.reason).toMatchObject({ code: '23505' });
  expect(
    (
      await pool.query(
        "SELECT user_id FROM account_login_identifiers WHERE destination='racing-contact@example.test'"
      )
    ).rows
  ).toHaveLength(1);
});
