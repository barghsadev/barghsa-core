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
const verify = (providerId = 'stub', input = { nationalId: '0000000000' }) =>
  fetch(`${http.base}/api/admin/verification/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ providerId, input }),
  });

it('keeps unregistered provider input out of the result and verification logs', async () => {
  const unknownProvider = 'unregistered-verification-fixture';
  const response = await verify(unknownProvider);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(JSON.parse(body)).toMatchObject({
    verified: false,
    code: 'PROVIDER_ERROR',
    rawResponse: { error: 'VERIFICATION:PROVIDER_NOT_FOUND' },
  });
  const correlationId = response.headers.get('x-correlation-id')!;
  expect(correlationId).toBeTruthy();
  const verificationLog = () =>
    http
      .logs()
      .split('\n')
      .find((line) => line.includes(correlationId) && line.includes('Verification requested:'));
  await expect.poll(verificationLog).toBeDefined();
  expect(verificationLog()).not.toContain(unknownProvider);
  expect(body).not.toContain(unknownProvider);
});

it('bounds the provider identifier at the HTTP request boundary', async () => {
  const response = await verify('x'.repeat(129));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION:INPUT:INVALID' } });
});

it('rejects undeclared verification input fields before running the adapter', async () => {
  const input = { nationalId: '0000000000', unexpected: 'synthetic-extra-field' };
  const response = await verify('stub', input);
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(JSON.parse(body)).toMatchObject({ verified: false, code: 'INVALID_INPUT' });
  expect(body).not.toContain(input.unexpected);
  expect(await (await verify()).json()).toMatchObject({ verified: true });
});

it('refuses a mismatched provider identity and leaves disabled encrypted settings unused', async () => {
  const update = (value: unknown) =>
    http.pool.query(
      'INSERT INTO app_config(key,value) VALUES ($1,$2::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value',
      [configKey, JSON.stringify(value)]
    );
  const fixtureCiphertext = 'unreadable-disabled-settings';
  try {
    const unconfigured = await verify();
    expect(unconfigured.status, http.logs()).toBe(200);
    expect(await unconfigured.json()).toMatchObject({ durationMs: expect.any(Number) });
    await update({ providerId: 'other', enabled: true, settingsCiphertext: fixtureCiphertext });
    for (const response of [await read(), await verify()]) {
      expect(response.status, http.logs()).toBe(503);
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({
        error: { code: 'VERIFICATION:PROVIDER:UNAVAILABLE' },
      });
      expect(body).not.toContain(fixtureCiphertext);
    }
    await update({ providerId: 'stub', enabled: false, settingsCiphertext: fixtureCiphertext });
    const result = await verify();
    expect(result.status, http.logs()).toBe(200);
    expect(await result.json()).toMatchObject({ verified: false });
    await update({ providerId: 'stub', enabled: true, settingsCiphertext: null });
    const noSettings = await read();
    expect(noSettings.status).toBe(200);
    expect(await noSettings.json()).toMatchObject({
      config: { enabled: true, settingsConfigured: false },
    });
  } finally {
    await http.pool.query('DELETE FROM app_config WHERE key=$1', [configKey]);
  }
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
