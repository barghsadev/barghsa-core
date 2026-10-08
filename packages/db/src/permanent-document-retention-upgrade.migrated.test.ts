import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runMigrations } from './migrate';

const production = resolve('drizzle/production');
const previous = mkdtempSync(join(tmpdir(), 'permanent-retention-prior-'));
const scoped = mkdtempSync(join(tmpdir(), 'permanent-retention-scoped-'));
const name = 'test_permanent_retention_' + randomUUID().replaceAll('-', '');
let management: Pool, pool: Pool, connection: { pgdirectUrl: string };
beforeAll(async () => {
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  for (const [folder, max] of [
    [previous, 271],
    [scoped, 272],
  ] as const) {
    const version = {
      ...journal,
      entries: journal.entries.filter((e: { idx: number }) => e.idx <= max),
    };
    mkdirSync(join(folder, 'meta'));
    writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(version));
    for (const entry of version.entries)
      copyFileSync(join(production, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
  }
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${name}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = '/' + name;
  connection = { pgdirectUrl: url.toString() };
  expect(await runMigrations({ connection, migrationsFolder: previous })).toMatchObject({
    ok: true,
  });
  pool = new Pool({ connectionString: url.toString() });
}, 40000);
afterAll(async () => {
  await pool?.end();
  try {
    if (management) await management.query(`DROP DATABASE "${name}"`);
  } finally {
    await management?.end();
    rmSync(previous, { recursive: true, force: true });
    rmSync(scoped, { recursive: true, force: true });
  }
});
async function snapshot() {
  const rows: Record<string, unknown> = {};
  for (const { tablename } of (
    await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
  ).rows)
    rows[tablename] = (
      await pool.query(
        `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM "${tablename.replaceAll('"', '""')}" t`
      )
    ).rows[0].rows;
  return rows;
}

it('cancels only protected legacy manifests, preserves bytes and approvals, audits once and safely replays', async () => {
  const user = randomUUID(),
    profile = randomUUID();
  await pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')", [
    user,
  ]);
  await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
  // Historical, already removed rows have no need to simulate upload/scanner transitions.
  await pool.query('ALTER TABLE documents DISABLE TRIGGER document_lifecycle_guard');
  await pool.query('ALTER TABLE documents DISABLE TRIGGER document_commit_guard');
  const protectedIds: string[] = [];
  try {
    for (const { type, category, protectedRecord } of [
      ...['contract', 'invoice', 'order'].map((type) => ({
        type,
        category: 'document',
        protectedRecord: true,
      })),
      { type: 'standalone', category: 'contract', protectedRecord: true },
      { type: 'standalone', category: 'document', protectedRecord: false },
    ]) {
      for (const status of ['pending_approval', 'approved', 'destroying']) {
        const id = randomUUID(),
          upload = 'uploads/' + id,
          sealed = 'business-documents/' + id + '/hash';
        if (protectedRecord) protectedIds.push(id);
        await pool.query(
          "INSERT INTO storage_records(storage_key,status) VALUES($1,'active'),($2,'immutable')",
          [upload, sealed]
        );
        await pool.query(
          `INSERT INTO documents(id,profile_id,business_record_type,business_record_id,category,
           state,scan_state,upload_key,storage_key,original_name,size_bytes,uploaded_by,uploaded_by_type,removed_at)
           VALUES($1,$2,$3,$4,$5,'Removed','Available',$6,$7,'Historical.pdf',123,$8,'customer',NOW()-INTERVAL '50 years')`,
          [
            id,
            profile,
            type,
            type === 'standalone' ? null : randomUUID(),
            category,
            upload,
            sealed,
            user,
          ]
        );
        await pool.query(
          `INSERT INTO document_destruction_items(document_id,profile_id,policy_id,storage_key,upload_key,
           retention_deadline,status,approved_by,approved_at,destruction_started_at,attempts,last_error)
           SELECT $1,$2,id,$3,$4,NOW()-INTERVAL '1 year',$5,
            CASE WHEN $5='pending_approval' THEN NULL ELSE $6 END,
            CASE WHEN $5='pending_approval' THEN NULL ELSE NOW() END,
            CASE WHEN $5='destroying' THEN NOW() ELSE NULL END,2,'old_retry'
           FROM document_retention_policies WHERE business_record_type=$7 ORDER BY effective_date DESC LIMIT 1`,
          [id, profile, sealed, upload, status, user, type]
        );
        await pool.query(
          "INSERT INTO document_events(document_id,revision,state,actor_id,reason) VALUES($1,1,'Removed',$2,'historical_fixture')",
          [id, user]
        );
      }
    }
  } finally {
    await pool.query('ALTER TABLE documents ENABLE TRIGGER document_lifecycle_guard');
    await pool.query('ALTER TABLE documents ENABLE TRIGGER document_commit_guard');
  }
  const before = await snapshot();
  const definitions = (
    await pool.query(
      "SELECT p.oid,p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.oid"
    )
  ).rows;
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: ['0272_permanent_document_retention'],
  });
  const after = await snapshot();
  const currentDefinitions = (
    await pool.query(
      "SELECT p.oid,p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.oid"
    )
  ).rows;
  for (const definition of definitions)
    if (definition.proname !== 'document_retention_eligibility')
      expect(currentDefinitions.find((row) => row.oid === definition.oid)).toEqual(definition);
  expect(currentDefinitions).toHaveLength(definitions.length + 3);
  for (const [table, rows] of Object.entries(before))
    if (!['document_destruction_items', 'audit_log'].includes(table))
      expect(after[table], table).toEqual(rows);
  const oldItems = before.document_destruction_items as Array<Record<string, unknown>>;
  const newItems = after.document_destruction_items as Array<Record<string, unknown>>;
  expect(newItems).toHaveLength(15);
  for (const old of oldItems) {
    const current = newItems.find((i) => i.id === old.id)!;
    expect(current).toMatchObject(
      protectedIds.includes(old.document_id as string)
        ? {
            ...old,
            status: 'cancelled',
            last_error: 'permanent_retention',
            updated_at: expect.any(String),
          }
        : old
    );
  }
  const oldAudit = before.audit_log as Array<Record<string, unknown>>;
  const newAudit = after.audit_log as Array<Record<string, unknown>>;
  expect(newAudit).toHaveLength(oldAudit.length + 12);
  for (const row of oldAudit) expect(newAudit).toContainEqual(row);
  for (const id of protectedIds) {
    expect(
      (await pool.query('SELECT * FROM document_retention_eligibility($1)', [id])).rows
    ).toEqual([]);
    expect(newAudit.filter((r) => JSON.parse(r.metadata as string)?.documentId === id)).toEqual([
      expect.objectContaining({ event: 'document_destruction_cancelled', ip: 'migration' }),
    ]);
  }
  expect(await runMigrations({ connection, migrationsFolder: scoped })).toEqual({
    ok: true,
    applied: [],
  });
  expect(await snapshot()).toEqual(after);
}, 40000);
