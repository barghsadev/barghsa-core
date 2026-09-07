import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rootCertificates } from 'node:tls';
import { Client, type Pool } from 'pg';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';

const scratch = mkdtempSync(join(tmpdir(), 'barghsa-db-ca-'));
const pools: Pool[] = [];
beforeEach(() => {
  vi.resetModules();
});
afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end()));
  vi.unstubAllEnvs();
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

for (const direct of [false, true]) {
  it(`honors explicit TLS settings over conflicting URL settings, direct=${direct}`, async () => {
    const db = await import('./index.js');
    const url =
      'postgresql://localhost/test?sslmode=disable&ssl=0&sslrootcert=/missing&sslnegotiation=direct';
    const ssl = { rejectUnauthorized: true, ca: rootCertificates[0]! };
    const pool = direct
      ? db.createDirectDbPool({ pgdirectUrl: url, ssl })
      : db.createDbPool({ databaseUrl: url, ssl });
    pools.push(pool);
    expect(new Client(pool.options).ssl).toEqual(ssl);
  });
}

it('keeps URL TLS behavior when no application override exists', async () => {
  const { createDirectDbPool } = await import('./index.js');
  const pool = createDirectDbPool({ pgdirectUrl: 'postgresql://localhost/test?sslmode=disable' });
  pools.push(pool);
  expect(new Client(pool.options).ssl).toBe(false);
});

it('allows explicit TLS disable to override environment and URL enablement', async () => {
  vi.stubEnv('DATABASE_SSL_ENABLED', 'true');
  const { createDirectDbPool } = await import('./index.js');
  const pool = createDirectDbPool({
    pgdirectUrl: 'postgresql://localhost/test?sslmode=require',
    ssl: false,
  });
  pools.push(pool);
  expect(new Client(pool.options).ssl).toBe(false);
});

it.each(['false', '0'])(
  'preserves an explicit certificate-verification opt-out (%s)',
  async (flag) => {
    vi.stubEnv('DATABASE_SSL_ENABLED', 'true');
    vi.stubEnv('DATABASE_SSL_REJECT_UNAUTHORIZED', flag);
    const { createDirectDbPool } = await import('./index.js');
    const pool = createDirectDbPool({ pgdirectUrl: 'postgresql://localhost/test' });
    pools.push(pool);
    expect(new Client(pool.options).ssl).toEqual({ rejectUnauthorized: false });
  }
);

it('reuses only shared direct pools and isolates explicitly owned pools', async () => {
  vi.stubEnv('PGDIRECT_URL', 'postgresql://localhost/direct');
  const { createDirectDbPool } = await import('./index.js');
  const shared = createDirectDbPool();
  const owned = createDirectDbPool({}, { shared: false });
  pools.push(shared, owned);
  expect(createDirectDbPool()).toBe(shared);
  expect(owned).not.toBe(shared);
  expect(new Client(owned.options).database).toBe('direct');
});

it.each(['true', '1'])(
  'uses the configured CA and defaults to certificate verification (%s)',
  async (enabled) => {
    const path = join(scratch, 'ca.pem');
    writeFileSync(path, rootCertificates[0]!);
    vi.stubEnv('DATABASE_SSL_ENABLED', enabled);
    vi.stubEnv('DATABASE_CA_PATH', path);
    const { createDirectDbPool } = await import('./index.js');
    const pool = createDirectDbPool({ pgdirectUrl: 'postgresql://localhost/test?sslmode=disable' });
    pools.push(pool);
    expect(new Client(pool.options).ssl).toEqual({
      rejectUnauthorized: true,
      ca: rootCertificates[0],
    });
  }
);

it.each(['missing', 'empty', 'malformed'])(
  'fails closed on a %s CA and allows corrected startup',
  async (kind) => {
    const path = join(scratch, kind + '.pem');
    if (kind !== 'missing') writeFileSync(path, kind === 'empty' ? '' : 'not a certificate');
    vi.stubEnv('DATABASE_SSL_ENABLED', 'true');
    vi.stubEnv('DATABASE_CA_PATH', path);
    const { createDbPool, getDbPool } = await import('./index.js');
    expect(() => createDbPool({ databaseUrl: 'postgresql://localhost/test' })).toThrow(
      'CA certificate'
    );
    expect(() => getDbPool()).toThrow('not initialized');
    writeFileSync(path, rootCertificates[0]!);
    const pool = createDbPool({ databaseUrl: 'postgresql://localhost/test' });
    pools.push(pool);
    expect(new Client(pool.options).ssl).toMatchObject({ rejectUnauthorized: true });
  }
);

it.each([0, -1, 0.5, NaN, Infinity, 2147483648])(
  'rejects invalid deadlines before caching a pool (%s)',
  async (readTimeoutMs) => {
    const { createDbPool, getDbPool } = await import('./index.js');
    expect(() => createDbPool({ readTimeoutMs })).toThrow('positive integer');
    expect(() => getDbPool()).toThrow('not initialized');
    const pool = createDbPool({ databaseUrl: 'postgresql://localhost/test', readTimeoutMs: 5000 });
    pools.push(pool);
    expect(getDbPool()).toBe(pool);
  }
);
