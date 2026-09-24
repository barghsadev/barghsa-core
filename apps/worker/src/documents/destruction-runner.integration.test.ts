import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import type { StorageProvider } from '@barghsa/shared/storage';
import { runMigrations } from '../../../../packages/db/src/migrate';
import { planDocumentDestruction, runDocumentDestruction } from './destruction-runner.js';

const database = `test_destruction_${randomUUID().replaceAll('-', '')}`;
let management: Pool;
let pool: Pool;
const user = randomUUID();
const profile = randomUUID();
const deleteObjectVersions = vi.fn(async (_key: string) => 1);
const storage = { deleteObjectVersions } as unknown as StorageProvider;

beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  if (!migration.ok) throw new Error(JSON.stringify(migration));
  pool = new Pool({ connectionString: url.toString() });
  await pool.query('INSERT INTO users(user_id,username,password_hash) VALUES($1,$2,$3)', [
    user,
    `${user}@test.local`,
    'hash',
  ]);
  await pool.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, user]);
}, 40_000);
afterAll(async () => {
  await pool?.end();
  await management.query(`DROP DATABASE "${database}"`);
  await management.end();
});
beforeEach(() => deleteObjectVersions.mockReset().mockResolvedValue(1));

async function document(ageYears = 6, invoiceId: string | null = null) {
  const id = randomUUID();
  const uploadKey = `uploads/${id}`;
  const storageKey = `business-documents/${id}/hash`;
  await pool.query(
    `INSERT INTO storage_records(storage_key,status,file_name,metadata)
     VALUES($1,'active','Sensitive proof.pdf','{"source":"customer"}'::jsonb),
       ($2,'immutable','Sensitive copy.pdf','{"source":"sealed"}'::jsonb)`,
    [uploadKey, storageKey]
  );
  const client = await pool.connect();
  try {
    // Build a historical removed record without waiting five years in the test clock.
    await client.query('ALTER TABLE documents DISABLE TRIGGER document_lifecycle_guard');
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO documents(id,profile_id,business_record_type,business_record_id,category,state,scan_state,
        upload_key,storage_key,original_name,size_bytes,uploaded_by,uploaded_by_type,removed_at)
       VALUES($1,$2,CASE WHEN $7::uuid IS NULL THEN 'standalone' ELSE 'invoice' END::document_business_type,
         $7,'document','Removed','Available',$3,$4,'Sensitive proof.pdf',123,$5,'customer',
         NOW()-($6::int * interval '1 year'))`,
      [id, profile, uploadKey, storageKey, user, ageYears, invoiceId]
    );
    await client.query(
      `INSERT INTO document_events(document_id,revision,state,actor_id,reason)
       VALUES($1,1,'Removed',$2,'historical_fixture')`,
      [id, user]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.query('ALTER TABLE documents ENABLE TRIGGER document_lifecycle_guard');
    client.release();
  }
  return { id, uploadKey, storageKey };
}

async function approve(id: string) {
  await pool.query(
    `UPDATE document_destruction_items SET status='approved',approved_by=$2,approved_at=NOW()
     WHERE document_id=$1 AND status='pending_approval'`,
    [id, user]
  );
}

it('plans only expired documents and destroys approved exact-key versions with an audit trail', async () => {
  const old = await document();
  const recent = await document(1);
  expect(await planDocumentDestruction(pool)).toBe(1);
  expect(await planDocumentDestruction(pool)).toBe(0);
  expect(
    (
      await pool.query('SELECT document_id FROM document_destruction_items WHERE status=$1', [
        'pending_approval',
      ])
    ).rows.map((row) => row.document_id)
  ).toContain(old.id);
  await approve(old.id);
  expect(await runDocumentDestruction(pool, storage)).toMatchObject({ destroyed: 1, failed: 0 });
  expect(deleteObjectVersions.mock.calls).toEqual([[old.storageKey], [old.uploadKey]]);
  expect(
    (
      await pool.query(
        'SELECT state,storage_key,original_name,checksum FROM documents WHERE id=$1',
        [old.id]
      )
    ).rows[0]
  ).toMatchObject({
    state: 'Removed',
    storage_key: null,
    original_name: '[destroyed]',
    checksum: null,
  });
  expect(
    (
      await pool.query(
        'SELECT status,destroyed_at FROM document_destruction_items WHERE document_id=$1',
        [old.id]
      )
    ).rows[0]
  ).toMatchObject({ status: 'destroyed', destroyed_at: expect.any(Date) });
  expect(
    (
      await pool.query(
        'SELECT file_name,metadata,status FROM storage_records WHERE storage_key=$1',
        [old.uploadKey]
      )
    ).rows[0]
  ).toMatchObject({
    file_name: null,
    status: 'removed',
    metadata: expect.objectContaining({ destructionItemId: expect.any(String) }),
  });
  expect(
    (
      await pool.query("SELECT event FROM audit_log WHERE event LIKE 'document_destruction_%'")
    ).rows.map((row) => row.event)
  ).toContain('document_destruction_completed');
  expect(await planDocumentDestruction(pool)).toBe(0);
  expect(recent.id).not.toBe(old.id);
});

it('retains an old removed document while its parent invoice remains open', async () => {
  const invoiceId = randomUUID();
  await pool.query(
    "INSERT INTO invoices(id,profile_id,state,total_amount) VALUES($1,$2,'Draft',100)",
    [invoiceId, profile]
  );
  const doc = await document(20, invoiceId);
  expect(await planDocumentDestruction(pool)).toBe(0);
  expect(
    (
      await pool.query('SELECT retention_deadline FROM document_retention_eligibility($1)', [
        doc.id,
      ])
    ).rows[0].retention_deadline
  ).toBeNull();
});

it('cancels approval when a legal hold arrives before destruction', async () => {
  const doc = await document();
  await planDocumentDestruction(pool);
  await approve(doc.id);
  await pool.query(
    `INSERT INTO document_legal_holds(document_id,reason,initiated_by)
     VALUES($1,'Preserve for legal review',$2)`,
    [doc.id, user]
  );
  expect(await runDocumentDestruction(pool, storage)).toMatchObject({ destroyed: 0, cancelled: 1 });
  expect(deleteObjectVersions).not.toHaveBeenCalled();
  expect(
    (
      await pool.query('SELECT status FROM document_destruction_items WHERE document_id=$1', [
        doc.id,
      ])
    ).rows[0].status
  ).toBe('cancelled');
});

it('retries a partially completed provider deletion without losing the approval manifest', async () => {
  const doc = await document();
  await planDocumentDestruction(pool);
  await approve(doc.id);
  deleteObjectVersions.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('provider outage'));
  expect(await runDocumentDestruction(pool, storage)).toMatchObject({ destroyed: 0, failed: 1 });
  expect(
    (
      await pool.query(
        'SELECT status,attempts FROM document_destruction_items WHERE document_id=$1',
        [doc.id]
      )
    ).rows[0]
  ).toMatchObject({ status: 'destroying', attempts: 1 });
  await expect(
    pool.query(
      `INSERT INTO document_legal_holds(document_id,reason,initiated_by)
       VALUES($1,'Late preservation request',$2)`,
      [doc.id, user]
    )
  ).rejects.toThrow('Document destruction already started');
  await expect(
    pool.query(
      `INSERT INTO document_retention_policies
        (business_record_type,retention_years,legal_hold,approval_note)
       VALUES('standalone',5,true,'Late policy hold')`
    )
  ).rejects.toThrow('Cannot change policy during document destruction');
  expect(await runDocumentDestruction(pool, storage)).toMatchObject({ destroyed: 1, failed: 0 });
  expect(deleteObjectVersions).toHaveBeenCalledTimes(4);
});
