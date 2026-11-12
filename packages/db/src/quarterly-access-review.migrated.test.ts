import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
let sql: string;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
  sql = await readFile(
    resolve(__dirname, '../../../docs/operations/preflight/quarterly-access-review.sql'),
    'utf8'
  );
}, 40000);
afterAll(async () => {
  await fixture?.close();
}, 15000);

async function exportReview() {
  const results = await fixture.pool.query(sql);
  if (!Array.isArray(results)) throw new Error('Expected a transaction and a report');
  const report = results.find((result) => result.command === 'SELECT')?.rows[0]?.report as {
    schema_version: number;
    database: string;
    read_only: boolean;
    staff_assignments: { user_id: string }[];
    credential_metadata: {
      family: string;
      transport: string;
      credential_kind: string;
      masked_value: string;
      issued_at: string | null;
      last_used_at: string | null;
      last_verified_at: string | null;
      config_created_at: string | null;
    }[];
    database_logins: { role_name: string }[];
  };
  return report;
}

it('exports the correct database and catalog login roles from a read-only transaction', async () => {
  const report = await exportReview();
  const expected = (
    await fixture.pool.query('SELECT current_database() AS database, current_user AS login')
  ).rows[0];
  expect(report).toMatchObject({ schema_version: 1, database: expected.database, read_only: true });
  expect(report.staff_assignments).toEqual(expect.any(Array));
  expect(report.credential_metadata).toEqual([]);
  expect(report.database_logins).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role_name: expected.login, direct_member_of: expect.any(Array) }),
    ])
  );
  expect(report.database_logins.find((row) => row.role_name === expected.login)).not.toHaveProperty(
    'rolpassword'
  );
});

it('includes inactive grants and credential families with no raw credential material or inferred use dates', async () => {
  const accountSecret = 'synthetic-password-hash-for-review';
  await fixture.pool.query(
    `
    INSERT INTO users(user_id, username, password_hash, is_staff, is_admin, disabled_at)
    VALUES ('review-retired','review-retired@example.test',$1,true,false,'2026-01-02T00:00:00Z'),
           ('review-owner','review-owner@example.test',$1,true,true,NULL),
           ('review-customer','review-customer@example.test',$1,false,false,NULL)`,
    [accountSecret]
  );
  await fixture.pool.query(`
    INSERT INTO staff_roles(role_id,name,description)
    VALUES ('review-finance','Review Finance','Fixture');
    INSERT INTO user_roles(user_id,role_id,created_at)
    VALUES ('review-retired','review-finance','2026-01-01T00:00:00Z');`);
  const mailKey = 'synthetic-resend-key-for-review';
  const webhook = 'synthetic-webhook-key-for-review';
  const smtpPassword = 'synthetic-smtp-password-for-review';
  const smsKey = 'synthetic-sms-key-for-review';
  const aiToken = 'synthetic-ai-token-for-review';
  const storageKey = 'synthetic-storage-key-for-review';
  const legacySetting = 'synthetic-verification-setting-for-review';
  const sealedSetting = 'synthetic-sealed-settings-for-review';
  await fixture.pool.query(
    `
    INSERT INTO email_provider_configs(transport,label,config,created_by,created_at,delivery_verified_at)
    VALUES ('resend','Review mail',$1::jsonb,'review-owner','2026-01-01T00:00:00Z','2026-01-03T00:00:00Z'),
           ('smtp','Review SMTP',$2::jsonb,'review-owner','2026-01-02T00:00:00Z',NULL)`,
    [
      JSON.stringify({ api_key: mailKey, webhook_secret: webhook }),
      JSON.stringify({ password: smtpPassword }),
    ]
  );
  await fixture.pool.query(
    `
    INSERT INTO sms_provider_configs(label,config,created_by)
    VALUES ('Review SMS',$1::jsonb,'review-owner')`,
    [JSON.stringify({ api_key: smsKey })]
  );
  await fixture.pool.query(
    `
    INSERT INTO ai_models(title,provider_type,base_url,model_name,api_token,created_by)
    VALUES ('Review model','openai_compatible','https://ai.example.test','fixture',$1,'review-owner')`,
    [aiToken]
  );
  await fixture.pool.query(
    `
    INSERT INTO app_config(key,value)
    VALUES ('storage.active',$1::jsonb),('verification_provider_review_legacy',$2::jsonb),
           ('verification_provider_review_sealed',$3::jsonb)`,
    [
      JSON.stringify({ encryptedSecret: storageKey, accessKeyId: 'private-access-key-id' }),
      JSON.stringify({ enabled: true, settings: { providerCredential: legacySetting } }),
      JSON.stringify({ enabled: false, settingsCiphertext: sealedSetting }),
    ]
  );

  const report = await exportReview();
  expect(report.staff_assignments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user_id: 'review-retired',
        role_id: 'review-finance',
        role_name: 'Review Finance',
        disabled_at: '2026-01-02T00:00:00+00:00',
        assigned_at: '2026-01-01T00:00:00+00:00',
      }),
      expect.objectContaining({ user_id: 'review-owner', role_id: null, is_admin: true }),
    ])
  );
  expect(report.staff_assignments.some((row) => row.user_id === 'review-customer')).toBe(false);
  const credentials = report.credential_metadata;
  expect(
    credentials
      .map(({ family, transport, credential_kind }) => [family, transport, credential_kind])
      .sort()
  ).toEqual([
    ['ai', 'openai_compatible', 'api_token'],
    ['email', 'resend', 'api_key'],
    ['email', 'resend', 'webhook_secret'],
    ['email', 'smtp', 'password'],
    ['sms', 'smsir', 'api_key'],
    ['storage', 's3', 'secret_access_key'],
    ['verification', 'verification', 'settings_bundle'],
    ['verification', 'verification', 'settings_bundle'],
  ]);
  for (const credential of credentials) {
    expect(credential).toMatchObject({
      masked_value: '********',
      issued_at: null,
      last_used_at: null,
    });
  }
  expect(
    credentials.find((row) => row.family === 'email' && row.credential_kind === 'api_key')
  ).toMatchObject({
    config_created_at: '2026-01-01T00:00:00+00:00',
    last_verified_at: '2026-01-03T00:00:00+00:00',
  });
  expect(credentials.find((row) => row.credential_kind === 'webhook_secret')).toMatchObject({
    last_verified_at: null,
  });
  const serialized = JSON.stringify(report);
  for (const marker of [
    accountSecret,
    'review-owner@example.test',
    mailKey,
    webhook,
    smtpPassword,
    smsKey,
    aiToken,
    storageKey,
    legacySetting,
    sealedSetting,
    'private-access-key-id',
    'providerCredential',
  ]) {
    expect(serialized).not.toContain(marker);
  }
});
