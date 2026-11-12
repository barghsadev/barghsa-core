import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { PROVIDER_SECRET_ENCRYPTION_ENV, SecretCipher } from '@barghsa/shared/auth-delivery';
import { startHttpFixture } from '../test/http-fixture.js';

const fixtureKey = 'verification-provider-fixture-key-only';
const path = '/api/admin/verification/providers/stub/config';
const configKey = 'verification_provider_stub';
const settings = { timeoutMs: '300', fixtureCredential: 'synthetic-setting-value' };
const session = randomUUID();
const csrf = randomUUID();
const headers = {
  Cookie: `barghsa_session=${session}`,
  'X-CSRF-Token': csrf,
  'Content-Type': 'application/json',
};
let http: Awaited<ReturnType<typeof startHttpFixture>>;

beforeAll(async () => {
  vi.stubEnv('ENABLE_VERIFICATION_STUB', 'true');
  vi.stubEnv(PROVIDER_SECRET_ENCRYPTION_ENV, fixtureKey);
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_KEY_ID', '');
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_PREVIOUS_KEY', '');
  vi.stubEnv('PROVIDER_CONFIG_ENCRYPTION_PREVIOUS_KEY_ID', '');
  try {
    http = await startHttpFixture(process.env.TEST_DATABASE_URL!);
  } finally {
    vi.unstubAllEnvs();
  }
  await http.pool.query(
    `INSERT INTO users(user_id,username,password_hash,is_admin)
     VALUES('verification-config-owner','verification-config-owner@example.test','test-only',true)`
  );
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,expires_at,idle_deadline,step_up_verified_at)
     VALUES($1,'verification-config-owner',$2,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, csrf]
  );
}, 40000);
afterAll(async () => {
  await http?.close();
}, 15000);

const read = () => fetch(http.base + path, { headers });
const save = () =>
  fetch(http.base + path, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ providerId: 'stub', enabled: true, settings }),
  });
const verify = () =>
  fetch(`${http.base}/api/admin/verification/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId: 'stub', input: { nationalId: '0000000000' } }),
  });

it('keeps legacy settings private, seals replacement settings and decrypts only for the adapter', async () => {
  const initial = await read();
  expect(initial.status).toBe(200);
  expect(await initial.json()).toMatchObject({
    config: { providerId: 'stub', enabled: false, settingsConfigured: false },
  });
  await http.pool.query('INSERT INTO app_config (key,value) VALUES ($1,$2::jsonb)', [
    configKey,
    JSON.stringify({ providerId: 'stub', enabled: true, settings }),
  ]);
  const inventory = await readFile(
    resolve(__dirname, '../../../../docs/operations/preflight/provider-secret-review.sql'),
    'utf8'
  );
  async function legacyCount() {
    const result = await http.pool.query(inventory);
    expect(Array.isArray(result)).toBe(true);
    return (
      result as unknown as { rows: { verification_configs_with_plaintext_settings: string }[] }[]
    ).at(-1)?.rows[0]?.verification_configs_with_plaintext_settings;
  }
  expect(await legacyCount()).toBe('1');
  const configStatus = { providerId: 'stub', enabled: true, settingsConfigured: true };
  for (const readback of [await read(), await verify()]) {
    expect(readback.status).toBe(200);
    const body = await readback.text();
    expect(body).not.toContain('fixtureCredential');
    expect(body).not.toContain(settings.fixtureCredential);
  }
  const before = (await http.pool.query("SELECT version FROM config_version WHERE id='global'"))
    .rows[0].version;
  const saved = await save();
  expect(saved.status, await saved.clone().text()).toBe(200);
  expect(await saved.json()).toEqual({ providerId: 'stub', message: 'Configuration updated' });
  const row = (
    await http.pool.query('SELECT value,version FROM app_config WHERE key=$1', [configKey])
  ).rows[0];
  expect(row.version).toBe(2);
  expect(row.value).toEqual({
    providerId: 'stub',
    enabled: true,
    settingsCiphertext: expect.stringMatching(/^v[12]:/),
  });
  expect(JSON.stringify(row.value)).not.toContain(settings.fixtureCredential);
  const cipher = new SecretCipher(PROVIDER_SECRET_ENCRYPTION_ENV, fixtureKey);
  expect(JSON.parse(cipher.decrypt(row.value.settingsCiphertext, configKey))).toEqual(settings);
  expect(await legacyCount()).toBe('0');
  expect(
    (await http.pool.query("SELECT version FROM config_version WHERE id='global'")).rows[0].version
  ).toBe(before + 1);
  expect(await (await read()).json()).toMatchObject({ config: configStatus });
  const result = await verify();
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({ verified: true });

  // Ciphertext authenticated for a different settings record cannot be used by this adapter.
  const mismatched = cipher.encrypt(JSON.stringify(settings), 'verification_provider_other');
  await http.pool.query('UPDATE app_config SET value=$2::jsonb WHERE key=$1', [
    configKey,
    JSON.stringify({ providerId: 'stub', enabled: true, settingsCiphertext: mismatched }),
  ]);
  const refused = await verify();
  expect(refused.status).toBe(503);
  const body = await refused.text();
  expect(JSON.parse(body)).toMatchObject({ error: { code: 'VERIFICATION:PROVIDER:UNAVAILABLE' } });
  expect(body).not.toContain(mismatched);
  expect(await (await read()).json()).toMatchObject({ config: configStatus });
  expect(http.logs()).not.toContain(settings.fixtureCredential);
});
