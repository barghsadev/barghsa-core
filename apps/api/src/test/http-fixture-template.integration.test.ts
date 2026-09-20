import { expect, it } from 'vitest';
import { Pool } from 'pg';
import { startHttpFixture } from './http-fixture';

it('clones isolated production-migrated databases from an unwritable baseline', async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const template = process.env.BARGHSA_HTTP_TEMPLATE_DATABASE!;
  expect(template).toMatch(/^http_template_[a-f0-9]{32}$/);
  const fixtures: Awaited<ReturnType<typeof startHttpFixture>>[] = [];
  try {
    // Keep fulfilled fixtures for cleanup even if the other startup fails.
    const starts = await Promise.allSettled([
      startHttpFixture(databaseUrl),
      startHttpFixture(databaseUrl),
    ]);
    for (const result of starts) if (result.status === 'fulfilled') fixtures.push(result.value);
    for (const result of starts) if (result.status === 'rejected') throw result.reason;
    const [first, second] = fixtures;
    await first!.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ('template-isolation','template-isolation','test-only')"
    );
    await first!.pool.query('CREATE TABLE fixture_only(id integer)');
    expect(
      (await second!.pool.query("SELECT user_id FROM users WHERE user_id='template-isolation'"))
        .rows
    ).toEqual([]);
    expect((await second!.pool.query("SELECT to_regclass('fixture_only') AS name")).rows).toEqual([
      { name: null },
    ]);
    for (const fixture of fixtures) {
      expect(
        (
          await fixture.pool.query(
            "SELECT count(*)::integer AS count FROM pg_trigger WHERE tgname IN ('refunds_identity_guard','refunds_completion_totals')"
          )
        ).rows
      ).toEqual([{ count: 2 }]);
      expect(
        (
          await fixture.pool.query(
            "SELECT count(*)::integer AS count FROM staff_roles WHERE role_id='role-finance'"
          )
        ).rows
      ).toEqual([{ count: 1 }]);
    }
    const url = new URL(databaseUrl);
    url.pathname = `/${template}`;
    const baseline = new Pool({ connectionString: url.toString(), max: 1 });
    try {
      await expect(baseline.query('SELECT 1')).rejects.toMatchObject({ code: '55000' });
    } finally {
      await baseline.end();
    }
  } finally {
    await Promise.all(fixtures.map((fixture) => fixture.close()));
  }
}, 40000);
