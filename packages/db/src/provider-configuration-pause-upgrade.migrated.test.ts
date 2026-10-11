import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';
const production = resolve('drizzle/production'),
  prior = mkdtempSync(join(tmpdir(), 'provider-pause-upgrade-'));
const name = 'test_provider_pause_upgrade_' + randomUUID().replaceAll('-', '');
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 275);
  mkdirSync(join(prior, 'meta'));
  writeFileSync(join(prior, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(prior, entry.tag + '.sql'));
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect((await runMigrations({ connection, migrationsFolder: prior })).ok).toBe(true);
  pool = new Pool({ connectionString: url.toString() });
}, 40000);
afterAll(async () => {
  await pool?.end();
  try {
    if (management) await management.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
    rmSync(prior, { recursive: true, force: true });
  }
});
it('preserves populated provider versions through upgrade/replay and fences rollback probes for both channels', async () => {
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash) VALUES('pause-upgrade-staff','pause@example.test','fixture')"
  );
  const ids = { email: randomUUID(), sms: randomUUID() };
  for (const channel of ['email', 'sms'] as const) {
    await pool.query(
      `INSERT INTO ${channel}_provider_configs(id,transport,label,status,config,created_by,degraded,degraded_reason,cooldown_until)
      VALUES($1,$2,'Existing paused version','draft','{}','pause-upgrade-staff',true,'provider_configuration_pause',NULL)`,
      [ids[channel], channel === 'email' ? 'resend' : 'smsir']
    );
  }
  const rows = async () =>
    Promise.all(
      ['email', 'sms'].map(
        async (channel) =>
          (
            await pool.query(
              `SELECT row_to_json(p) AS row FROM ${channel}_provider_configs p ORDER BY id`
            )
          ).rows
      )
    );
  const before = await rows();
  expect((await runMigrations({ connection, migrationsFolder: production })).ok).toBe(true);
  expect(await rows()).toEqual(before);
  expect((await runMigrations({ connection, migrationsFolder: production })).ok).toBe(true);
  expect(await rows()).toEqual(before);
  for (const channel of ['email', 'sms'] as const) {
    for (const update of [
      'degraded=false,degraded_reason=NULL',
      'cooldown_until=NOW()',
      "degraded_reason='temporary'",
    ])
      await expect(
        pool.query(`UPDATE ${channel}_provider_configs SET ${update} WHERE id=$1`, [ids[channel]])
      ).rejects.toThrow('replacement version');
    // Replacement is an independent version; historical health stays immutable.
    await pool.query(`UPDATE ${channel}_provider_configs SET status='superseded' WHERE id=$1`, [
      ids[channel],
    ]);
    const replacement = randomUUID();
    await pool.query(
      `INSERT INTO ${channel}_provider_configs(id,transport,label,status,config,created_by)
      SELECT $2,transport,'Corrected draft','draft',config,created_by FROM ${channel}_provider_configs WHERE id=$1`,
      [ids[channel], replacement]
    );
    expect(
      (
        await pool.query(
          `SELECT degraded,degraded_reason,cooldown_until FROM ${channel}_provider_configs WHERE id=$1`,
          [replacement]
        )
      ).rows[0]
    ).toEqual({ degraded: false, degraded_reason: null, cooldown_until: null });
  }
});
