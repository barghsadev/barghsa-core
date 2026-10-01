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
it('adds nullable invitation metadata to populated tables without inventing historical dates', async () => {
  await ctx.pool
    .query(`CREATE TABLE profile_agents(id text PRIMARY KEY,joined_at timestamptz NOT NULL);
 CREATE TABLE profile_invitations(id text PRIMARY KEY,username text NOT NULL,status text NOT NULL);
 INSERT INTO profile_agents VALUES ('legacy-member','2026-07-01T00:00:00Z');
 INSERT INTO profile_invitations VALUES ('legacy-invite','legacy@example.test','Pending');`);
  const sql = readFileSync(
    resolve(__dirname, '../drizzle/production/0230_team_directory_metadata.sql'),
    'utf8'
  );
  await ctx.pool.query(sql.replaceAll('--> statement-breakpoint', ''));
  expect((await ctx.pool.query('SELECT * FROM profile_agents')).rows).toEqual([
    { id: 'legacy-member', joined_at: new Date('2026-07-01T00:00:00Z'), invited_at: null },
  ]);
  expect((await ctx.pool.query('SELECT * FROM profile_invitations')).rows).toEqual([
    { id: 'legacy-invite', username: 'legacy@example.test', status: 'Pending', message: null },
  ]);
  await ctx.pool.query('UPDATE profile_invitations SET message=$1', ['x'.repeat(1000)]);
  await expect(
    ctx.pool.query('UPDATE profile_invitations SET message=$1', ['x'.repeat(1001)])
  ).rejects.toMatchObject({ code: '23514', constraint: 'profile_invitations_message_length' });
});
