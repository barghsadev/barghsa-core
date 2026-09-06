import { afterEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { runMigrations, verifyMigrationVersion } from './migrate';
import { runSeed } from './seed';

const databases: string[] = [];
const folder = resolve(__dirname, '../drizzle/production');

afterEach(async () => {
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    for (const name of databases.splice(0))
      await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await pool.end();
  }
});

describe('complete production schema baseline', () => {
  it('creates the declared schema in an empty database without test-only prerequisite tables', async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
    const name = `test_baseline_${randomUUID().replaceAll('-', '')}`;
    const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    try {
      await management.query(`CREATE DATABASE "${name}"`);
      databases.push(name);
    } finally {
      await management.end();
    }
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    const options = { connection: { pgdirectUrl: url.toString() } };
    expect(await runMigrations(options)).toEqual({
      ok: true,
      applied: [
        '0080_complete_schema',
        '0081_restore_domain_constraints',
        '0082_restore_foundation_constraints',
        '0083_staff_identity',
        '0084_staff_capabilities',
        '0085_otp_purpose_binding',
        '0086_auth_delivery_outbox',
        '0087_authentication_version',
        '0088_staff_activation_delivery',
        '0089_pending_profile_verification',
        '0090_user_profile_context',
        '0091_additive_agent_roles',
        '0092_notification_delivery_identity',
        '0093_notification_window_snapshot',
        '0094_notification_claim_fencing',
        '0095_notification_message_snapshot',
        '0096_unified_notification_inbox',
        '0097_notification_recipient_backfill',
        '0098_ticket_attachments',
        '0099_ticket_team',
        '0100_staff_assignment',
        '0101_account_notification_recipients',
        '0102_service_breach_constraints',
        '0103_staff_team_leads',
        '0104_restore_inline_domain_constraints',
        '0105_optional_foreign_key_defaults',
        '0106_username_challenge_pair',
        '0107_profile_contact_details',
        '0108_legal_representative',
        '0109_onboarding_drafts',
        '0110_legal_documents',
        '0111_account_login_identifiers',
      ],
    });
    expect(await runMigrations(options)).toEqual({ ok: true, applied: [] });
    expect(await verifyMigrationVersion('0082', options)).toBe(true);
    const pool = new Pool({ connectionString: url.toString() });
    try {
      const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      expect(tables.rows.length).toBeGreaterThanOrEqual(85);
      expect(await runSeed(false, drizzle(pool))).toMatchObject({ ok: true, errors: [] });
      expect(await runSeed(false, drizzle(pool))).toMatchObject({ ok: true, errors: [] });
      expect((await pool.query('SELECT count(*)::int AS count FROM products')).rows[0].count).toBe(
        4
      );
      await expect(
        pool.query('DELETE FROM products WHERE system_key IS NOT NULL')
      ).rejects.toMatchObject({ code: 'P0001' });
      await expect(
        pool.query(
          "INSERT INTO addresses(profile_id, province_id, city_id, full_address, postal_code) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'address', '1234567890')"
        )
      ).rejects.toMatchObject({ code: '23503' });
      await pool.query(
        "INSERT INTO users(user_id, username, password_hash) VALUES ('baseline-user', 'baseline@example.test', 'test-only')"
      );
      const profile = (
        await pool.query(
          "INSERT INTO profiles(user_id, is_default) VALUES ('baseline-user', true) RETURNING id"
        )
      ).rows[0].id;
      await expect(
        pool.query("INSERT INTO profiles(user_id, is_default) VALUES ('baseline-user', true)")
      ).rejects.toMatchObject({ code: '23505' });
      await expect(
        pool.query('INSERT INTO wallets(profile_id, posted_balance) VALUES ($1, -1)', [profile])
      ).rejects.toMatchObject({ code: '23514' });
      await pool.query('INSERT INTO wallets(profile_id, posted_balance) VALUES ($1, $2)', [
        profile,
        '9007199254740993',
      ]);

      for (const purpose of ['unknown', 'login', 'registration']) {
        await expect(
          pool.query(
            `INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at,purpose)
          VALUES ($1,'invalid@example.test','test-hash',NOW()+INTERVAL '1 day',$2)`,
            [randomUUID(), purpose]
          )
        ).rejects.toMatchObject({ code: '23514' });
      }

      // Representative deployed state: populated current product/finance
      // tables with the old migration journal and missing unjournaled schema.
      await pool.query(
        "UPDATE users SET email='profile-contact@example.test',mobile='+989121234567' WHERE user_id='baseline-user'"
      );
      await pool.query(
        'ALTER TABLE profiles DROP COLUMN contact_email; ALTER TABLE profiles DROP COLUMN contact_mobile'
      );
      const oldSql = readFileSync(
        resolve(folder, '../0079_create_bank_receipt_attachment_claims.sql'),
        'utf8'
      );
      await pool.query(oldSql);
      await pool.query(
        'ALTER TABLE staff_teams DROP COLUMN lead_user_id; DROP TABLE staff_assignment_cursors; ALTER TABLE verification_cases DROP COLUMN assigned_to CASCADE; ALTER TABLE verification_cases DROP COLUMN assigned_team_id CASCADE; DROP INDEX tickets_assigned_open_idx'
      );
      await pool.query(
        'ALTER TABLE tickets DROP COLUMN attachments CASCADE; ALTER TABLE tickets DROP COLUMN assigned_team_id CASCADE'
      );
      const legacyTicket = (
        await pool.query(
          "INSERT INTO tickets(user_id,subject,body) VALUES ('baseline-user','Legacy question','Existing conversation') RETURNING id"
        )
      ).rows[0].id;
      await pool.query('DROP INDEX idx_profile_agents_profile_user_role');
      await pool.query(
        'ALTER TABLE notification_outbox DROP CONSTRAINT notification_outbox_recipient_check; ALTER TABLE notification_outbox ALTER COLUMN profile_id SET NOT NULL; ALTER TABLE notification_outbox ALTER COLUMN profile_id SET DEFAULT uuid_generate_v7()'
      );
      await pool.query(
        'ALTER TABLE in_app_notifications DROP COLUMN recipient_user_id CASCADE; ALTER TABLE in_app_notifications DROP COLUMN localized_content; ALTER TABLE in_app_notifications ALTER COLUMN profile_id SET NOT NULL; ALTER TABLE in_app_notifications ALTER COLUMN profile_id SET DEFAULT uuid_generate_v7()'
      );
      await pool.query(
        'ALTER TABLE in_app_notifications DROP COLUMN delivery_key CASCADE; ALTER TABLE notification_outbox DROP COLUMN idempotency_version; ALTER TABLE notification_job DROP COLUMN provider_ref; ALTER TABLE notification_job DROP COLUMN delivery_window; ALTER TABLE notification_outbox DROP COLUMN lease_token; ALTER TABLE notification_job DROP COLUMN delivery_payload'
      );
      await pool.query(
        'DROP TABLE user_profile_contexts; DROP TABLE auth_delivery_outbox; DROP INDEX users_activation_token_idx'
      );
      await pool.query(
        'DROP FUNCTION bump_user_auth_version() CASCADE; DROP FUNCTION bind_otp_auth_version() CASCADE'
      );
      await pool.query(
        'ALTER TABLE users DROP COLUMN auth_version; ALTER TABLE otp_challenges DROP COLUMN auth_version'
      );
      await pool.query('ALTER TABLE otp_challenges DROP COLUMN previous_challenge_id CASCADE');
      await pool.query('ALTER TABLE otp_challenges DROP COLUMN purpose CASCADE');
      await pool.query(
        "INSERT INTO otp_challenges(challenge_id,destination,otp_hash,expires_at) VALUES ('legacy-otp','old@example.test','test-hash',NOW()+INTERVAL '1 day')"
      );
      await pool.query(
        'ALTER TABLE legal_profiles DROP COLUMN representative_honorific CASCADE, DROP COLUMN representative_first_name CASCADE, DROP COLUMN representative_last_name CASCADE, DROP COLUMN representative_national_id CASCADE, DROP COLUMN representative_province_id CASCADE, DROP COLUMN representative_city_id CASCADE, DROP COLUMN representative_full_address CASCADE, DROP COLUMN representative_postal_code CASCADE'
      );
      await pool.query(
        'DROP FUNCTION synchronize_account_login_identifiers() CASCADE; DROP FUNCTION validate_account_login_identifier() CASCADE; DROP TABLE account_login_identifiers'
      );
      await pool.query('ALTER TABLE legal_profiles DROP COLUMN documents');
      await pool.query('DROP TABLE profile_onboarding_drafts');
      await pool.query('DELETE FROM drizzle.__drizzle_migrations');
      await pool.query(
        'INSERT INTO drizzle.__drizzle_migrations(hash, created_at) VALUES ($1, $2)',
        [createHash('sha256').update(oldSql).digest('hex'), '1789776000000']
      );
      await pool.query('ALTER TABLE users DROP COLUMN password_change_token');
      await pool.query('ALTER TABLE users DROP COLUMN is_staff');
      await pool.query(
        "INSERT INTO users(user_id, username, password_hash, is_admin) VALUES ('legacy-admin', 'legacy-admin@example.test', 'test-only', true)"
      );
      await pool.query(
        "INSERT INTO user_roles(user_id, role_id) VALUES ('baseline-user', 'role-finance')"
      );
      await pool.query(
        `UPDATE staff_roles SET permissions='["legal:read"]' WHERE role_id='role-legal-contracts'`
      );
      await pool.query('DROP TABLE sms_provider_configs');
      const oldHistory = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations')).rows;
      const productsBefore = (await pool.query('SELECT * FROM products ORDER BY id')).rows;
      expect((await runMigrations(options)).ok).toBe(true);
      expect(
        (
          await pool.query('SELECT contact_email,contact_mobile FROM profiles WHERE id=$1', [
            profile,
          ])
        ).rows[0]
      ).toEqual({ contact_email: 'profile-contact@example.test', contact_mobile: '+989121234567' });
      expect(
        (
          await pool.query('SELECT subject,body,attachments FROM tickets WHERE id=$1', [
            legacyTicket,
          ])
        ).rows[0]
      ).toEqual({ subject: 'Legacy question', body: 'Existing conversation', attachments: [] });
      expect(
        (
          await pool.query(
            "SELECT purpose,attempts_remaining,consumed_at IS NOT NULL AS consumed FROM otp_challenges WHERE challenge_id='legacy-otp'"
          )
        ).rows[0]
      ).toEqual({ purpose: 'legacy_invalid', attempts_remaining: 0, consumed: true });
      expect(
        (await pool.query("SELECT is_admin, is_staff FROM users WHERE user_id='legacy-admin'"))
          .rows[0]
      ).toEqual({ is_admin: true, is_staff: true });
      expect(
        (await pool.query("SELECT is_admin, is_staff FROM users WHERE user_id='baseline-user'"))
          .rows[0]
      ).toEqual({ is_admin: false, is_staff: true });
      expect(
        (
          await pool.query(
            "SELECT permissions FROM staff_roles WHERE role_id='role-legal-contracts'"
          )
        ).rows[0].permissions
      ).toBe('["legal:read"]');
      expect((await pool.query('SELECT * FROM products ORDER BY id')).rows).toEqual(productsBefore);
      expect(
        (
          await pool.query(
            'SELECT posted_balance::text AS balance FROM wallets WHERE profile_id=$1',
            [profile]
          )
        ).rows[0].balance
      ).toBe('9007199254740993');
      expect(
        (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows[0]
      ).toEqual(oldHistory[0]);
      expect(await runMigrations(options)).toEqual({ ok: true, applied: [] });
    } finally {
      await pool.end();
    }
  }, 30_000);
});
