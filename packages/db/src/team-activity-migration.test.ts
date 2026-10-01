import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createIsolatedTestDb, dropTestSchema, type IsolatedTestDb } from './test/testDb';
let ctx: IsolatedTestDb;
beforeAll(async () => {
  ctx = await createIsolatedTestDb();
});
afterAll(async () => {
  await ctx?.pool.end();
  if (ctx) await dropTestSchema(ctx.schemaName);
});
it('indexes populated audit history without rejecting invalid legacy JSON or changing entries', async () => {
  await ctx.pool
    .query(`CREATE TABLE audit_log(id text PRIMARY KEY,user_id text NOT NULL,metadata text,created_at timestamptz NOT NULL DEFAULT NOW());
    INSERT INTO audit_log(id,user_id,metadata) VALUES ('valid','actor','{"profileId":"legal"}'),('legacy','actor','invalid-json'),('array','actor','[]'),('empty','actor',NULL);`);
  const before = (await ctx.pool.query('SELECT * FROM audit_log ORDER BY id')).rows;
  await ctx.pool.query(
    readFileSync(
      resolve(__dirname, '../drizzle/production/0231_team_activity_history.sql'),
      'utf8'
    ).replaceAll('--> statement-breakpoint', '')
  );
  expect((await ctx.pool.query('SELECT * FROM audit_log ORDER BY id')).rows).toEqual(before);
  expect(
    (
      await ctx.pool.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname IN ('audit_log_member_activity_idx','audit_log_profile_activity_idx')",
        [ctx.schemaName]
      )
    ).rows
  ).toHaveLength(2);
  await ctx.pool.query(
    "INSERT INTO audit_log(id,user_id,metadata) VALUES ('later','actor','{bad-json')"
  );
});
