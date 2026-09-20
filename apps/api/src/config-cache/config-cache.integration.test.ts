import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
const state = vi.hoisted(() => ({
  pool: undefined as Pool | undefined,
  afterRead: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('@barghsa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@barghsa/db')>()),
  getDbPool: () => ({
    query: async (sql: string, values?: unknown[]) => {
      const result = await state.pool!.query(sql, values);
      if (sql.startsWith('SELECT value, version') && state.afterRead) {
        const callback = state.afterRead;
        state.afterRead = undefined;
        await callback();
      }
      return result;
    },
  }),
}));
import { runMigrations } from '../../../../packages/db/src/migrate';
import { ConfigCacheService } from './config-cache.service.js';
let management: Pool;
const database = 'test_config_cache_' + randomUUID().replaceAll('-', '');
const entries = new Map<string, string>();
const redis = {
  get: vi.fn(async (key: string) => entries.get(key) ?? null),
  setex: vi.fn(async (key: string, _ttl: number, value: string) => {
    entries.set(key, value);
    return 'OK';
  }),
};
let service: ConfigCacheService;
beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + database;
  expect(await runMigrations({ connection: { pgdirectUrl: url.toString() } })).toMatchObject({
    ok: true,
  });
  state.pool = new Pool({ connectionString: url.toString() });
}, 30000);
afterAll(async () => {
  await state.pool?.end();
  if (management) {
    await management.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await management.end();
  }
});
beforeEach(async () => {
  entries.clear();
  vi.clearAllMocks();
  state.afterRead = undefined;
  await state.pool!.query(
    "INSERT INTO config_version(id,version) VALUES ('global',5) ON CONFLICT(id) DO UPDATE SET version=5"
  );
  await state.pool!.query(
    "INSERT INTO app_config(key,value,version) VALUES ('audit.cache','9',1) ON CONFLICT(key) DO UPDATE SET value='9',version=1"
  );
  service = new ConfigCacheService(redis as unknown as Redis);
});
async function commitUpdate() {
  const client = await state.pool!.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE app_config SET value='12',version=2 WHERE key='audit.cache'");
    await client.query("UPDATE config_version SET version=version+1 WHERE id='global'");
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}
it('rejects stale Redis after a committed change without cache invalidation', async () => {
  expect(await service.get('audit.cache')).toBe(9);
  entries.set('config:global:version', '5');
  await commitUpdate();
  expect(await service.get('audit.cache')).toBe(12);
  expect(await service.peek('audit.cache')).toMatchObject({
    value: 12,
    version: 2,
    cachedAtGlobalVersion: 6,
  });
});
it('does not certify a row read before a concurrent committed update', async () => {
  state.afterRead = commitUpdate;
  expect(await service.get('audit.cache')).toBe(9);
  expect(redis.setex).not.toHaveBeenCalled();
  expect(await service.get('audit.cache')).toBe(12);
});
it('ignores cached values when authoritative version metadata is missing', async () => {
  expect(await service.get('audit.cache')).toBe(9);
  await commitUpdate();
  await state.pool!.query("DELETE FROM config_version WHERE id='global'");
  entries.set('config:global:version', '5');
  expect(await service.peek('audit.cache')).toBeNull();
  expect(await service.get('audit.cache')).toBe(12);
});
it('falls back to the current database row when the version query fails', async () => {
  expect(await service.get('audit.cache')).toBe(9);
  await commitUpdate();
  await state.pool!.query('ALTER TABLE config_version RENAME TO fixture_hidden_version');
  try {
    expect(await service.peek('audit.cache')).toBeNull();
    expect(await service.get('audit.cache')).toBe(12);
  } finally {
    await state.pool!.query('ALTER TABLE fixture_hidden_version RENAME TO config_version');
  }
});

it('ignores entries written by the previous cache version even when versions match', async () => {
  entries.set(
    'config:entry:audit.cache',
    JSON.stringify({ value: 99, version: 1, cachedAtGlobalVersion: 5 })
  );
  expect(await service.get('audit.cache')).toBe(9);
});
