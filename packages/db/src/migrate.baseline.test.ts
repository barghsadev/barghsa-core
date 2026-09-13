import { afterEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { runMigrations, verifyMigrationVersion } from './migrate';

const databases: string[] = [];
const folder = resolve(__dirname, '../drizzle/production');
const journalEntries = (
  JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  }
).entries;

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
  it('adds address removal history and ticket categories to populated 0123 data without changing existing fields', async () => {
    if (!process.env.TEST_DATABASE_URL) throw new Error('PostgreSQL setup did not run');
    const name = `test_address_upgrade_${randomUUID().replaceAll('-', '')}`;
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
    const previousFolder = mkdtempSync(resolve(tmpdir(), 'barghsa-address-migrations-'));
    const pool = new Pool({ connectionString: url.toString() });
    try {
      const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'));
      const previousIndex = journal.entries.findIndex(
        (entry: { tag: string }) => entry.tag === '0123_preauth_sessions'
      );
      expect(previousIndex).toBeGreaterThan(0);
      journal.entries = journal.entries.slice(0, previousIndex + 1);
      mkdirSync(resolve(previousFolder, 'meta'));
      writeFileSync(resolve(previousFolder, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries)
        copyFileSync(
          resolve(folder, entry.tag + '.sql'),
          resolve(previousFolder, entry.tag + '.sql')
        );
      expect((await runMigrations({ ...options, migrationsFolder: previousFolder })).ok).toBe(true);
      await pool.query(
        "INSERT INTO users(user_id,username,password_hash) VALUES ('address-upgrade','upgrade@example.test','fixture')"
      );
      const profile = (
        await pool.query("INSERT INTO profiles(user_id) VALUES ('address-upgrade') RETURNING id")
      ).rows[0].id;
      const province = (
        await pool.query(
          "INSERT INTO provinces(name_fa,name_en) VALUES ('استان','Province') RETURNING id"
        )
      ).rows[0].id;
      const city = (
        await pool.query(
          "INSERT INTO cities(province_id,name_fa,name_en) VALUES ($1,'شهر','City') RETURNING id",
          [province]
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES ($1,$2,$3,'Main street','1234567890',true),($1,$2,$3,'Second street','2345678901',false)",
        [profile, province, city]
      );
      const before = (await pool.query('SELECT * FROM addresses ORDER BY id')).rows;
      await pool.query(
        "INSERT INTO tickets(user_id,subject,body,profile_id) VALUES ('address-upgrade','Existing support request','Retain this history',$1)",
        [profile]
      );
      const oldTickets = (await pool.query('SELECT * FROM tickets ORDER BY id')).rows;
      expect(await runMigrations(options)).toEqual({
        ok: true,
        applied: journalEntries.slice(previousIndex + 1).map((entry) => entry.tag),
      });
      expect((await pool.query('SELECT * FROM addresses ORDER BY id')).rows).toEqual(
        before.map((row) => ({ ...row, deleted_at: null }))
      );
      expect((await pool.query('SELECT * FROM tickets ORDER BY id')).rows).toEqual(
        oldTickets.map((row) => ({ ...row, category: 'general' }))
      );
      await expect(pool.query("UPDATE tickets SET category='technical'")).rejects.toMatchObject({
        code: '23514',
        constraint: 'tickets_category_valid',
      });
      await expect(pool.query('UPDATE tickets SET category=NULL')).rejects.toMatchObject({
        code: '23502',
      });
      await pool.query("UPDATE tickets SET category='billing'");
      await pool.query("UPDATE tickets SET category='orders'");
      await expect(
        pool.query('UPDATE addresses SET deleted_at=NOW() WHERE main_address')
      ).rejects.toMatchObject({ code: '23514', constraint: 'addresses_deleted_not_main' });
      await pool.query('UPDATE addresses SET deleted_at=NOW() WHERE NOT main_address');
      const removed = (await pool.query('SELECT * FROM addresses WHERE NOT main_address')).rows[0];
      expect(removed).toMatchObject({
        full_address: 'Second street',
        postal_code: '2345678901',
        deleted_at: expect.any(Date),
      });
      expect(await runMigrations(options)).toEqual({ ok: true, applied: [] });
    } finally {
      await pool.end();
      rmSync(previousFolder, { recursive: true, force: true });
    }
  });
  it('upgrades populated legacy state from a fixed 0125 fixture and preserves its history', async () => {
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
    // Freeze the starting fixture: undoing later migrations by hand would leave
    // newer columns behind and test an impossible migration history.
    const previousFolder = mkdtempSync(resolve(tmpdir(), 'barghsa-legacy-migrations-'));
    const journal = JSON.parse(readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'));
    const cutoff = journal.entries.findIndex(
      (entry: { tag: string }) => entry.tag === '0125_ticket_category'
    );
    expect(cutoff).toBeGreaterThan(0);
    journal.entries = journal.entries.slice(0, cutoff + 1);
    mkdirSync(resolve(previousFolder, 'meta'));
    writeFileSync(resolve(previousFolder, 'meta/_journal.json'), JSON.stringify(journal));
    for (const entry of journal.entries)
      copyFileSync(
        resolve(folder, entry.tag + '.sql'),
        resolve(previousFolder, entry.tag + '.sql')
      );
    try {
      expect(await runMigrations({ ...options, migrationsFolder: previousFolder })).toEqual({
        ok: true,
        applied: journal.entries.map((entry: { tag: string }) => entry.tag),
      });
      expect(await runMigrations({ ...options, migrationsFolder: previousFolder })).toEqual({
        ok: true,
        applied: [],
      });
    } finally {
      rmSync(previousFolder, { recursive: true, force: true });
    }
    expect(await verifyMigrationVersion('0082', options)).toBe(true);
    const pool = new Pool({ connectionString: url.toString() });
    try {
      const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
      expect(tables.rows.length).toBeGreaterThanOrEqual(85);
      // Populate the historical schema with its historical product shape.
      // The current seed requires the current migrations (including zero limits).
      await pool.query(`INSERT INTO products(type,system_key,title)
        SELECT 'electricity',key,'{}'::jsonb FROM unnest(ARRAY['thermal','green','free_market','energy_saving']) key`);
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

      const callbackConstraint = async () =>
        (
          await pool.query(`SELECT pg_get_constraintdef(oid) AS definition
          FROM pg_constraint WHERE conrelid = 'wallet_topup_callback_events'::regclass
          AND conname = 'chk_wallet_topup_callback_events_status'`)
        ).rows[0].definition as string;
      expect(await callbackConstraint()).toContain('processing');
      await pool.query(`ALTER TABLE wallet_topup_callback_events
        DROP CONSTRAINT chk_wallet_topup_callback_events_status;
        ALTER TABLE wallet_topup_callback_events
        ADD CONSTRAINT chk_wallet_topup_callback_events_status
        CHECK (status IN ('credited', 'unpaid', 'duplicate'))`);
      expect(await callbackConstraint()).not.toContain('processing');

      const accountingInvoice = (
        await pool.query(
          `INSERT INTO invoices(profile_id,total_amount)
        VALUES ($1,9007199254740993) RETURNING id,accounting_amount`,
          [profile]
        )
      ).rows[0];
      expect(accountingInvoice.accounting_amount).toBe('9007199254740993');
      await pool.query(`ALTER TABLE invoices ALTER COLUMN accounting_amount DROP EXPRESSION;
        ALTER TABLE invoices DROP COLUMN accounting_amount_legacy`);
      await pool.query('UPDATE invoices SET accounting_amount=123 WHERE id=$1', [
        accountingInvoice.id,
      ]);

      // Representative deployed state: populated current product/finance
      // tables with the old migration journal and missing unjournaled schema.
      await pool.query(
        'ALTER TABLE addresses DROP COLUMN deleted_at CASCADE; DROP TABLE preauth_sessions; ALTER TABLE tickets DROP COLUMN category CASCADE'
      );
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
      await pool.query(
        'ALTER TABLE otp_challenges DROP COLUMN reset_token_hash, DROP COLUMN reset_consumed_at; ALTER TABLE users DROP COLUMN password_reset_challenge_id'
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
      await pool.query(
        'ALTER TABLE notification_templates DROP CONSTRAINT notification_template_supersedes_fk, DROP CONSTRAINT notification_template_version_positive, DROP CONSTRAINT notification_template_supersedes_older'
      );
      await pool.query('DROP INDEX uq_notification_templates_version');
      await pool.query('ALTER TABLE notification_templates DROP COLUMN supersedes_version');
      await pool.query('ALTER TABLE device_trusts DROP COLUMN ip_address');
      await pool.query(
        'DROP FUNCTION rate_limit_rolling(boolean,text,integer,integer,boolean); DROP FUNCTION rate_limit_rolling_reset(boolean,text); DROP TABLE rate_limit_windows'
      );
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
      const legacyUpgrade = await runMigrations(options);
      expect(legacyUpgrade, JSON.stringify(legacyUpgrade)).toMatchObject({ ok: true });
      expect(
        (
          await pool.query('SELECT contact_email,contact_mobile FROM profiles WHERE id=$1', [
            profile,
          ])
        ).rows[0]
      ).toEqual({ contact_email: 'profile-contact@example.test', contact_mobile: '+989121234567' });
      expect(
        (
          await pool.query('SELECT subject,body,attachments,category FROM tickets WHERE id=$1', [
            legacyTicket,
          ])
        ).rows[0]
      ).toEqual({
        subject: 'Legacy question',
        body: 'Existing conversation',
        attachments: [],
        category: 'general',
      });
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
      expect(await callbackConstraint()).toContain('processing');
      expect(
        (
          await pool.query(
            'SELECT accounting_amount,accounting_amount_legacy FROM invoices WHERE id=$1',
            [accountingInvoice.id]
          )
        ).rows[0]
      ).toEqual({ accounting_amount: '9007199254740993', accounting_amount_legacy: '123' });
      await expect(
        pool.query('UPDATE invoices SET accounting_amount=5 WHERE id=$1', [accountingInvoice.id])
      ).rejects.toMatchObject({ code: '428C9' });
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
