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

async function document(
  ageYears = 6,
  businessId: string | null = null,
  businessType = businessId ? 'invoice' : 'standalone',
  category = 'document'
) {
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
    if (businessType === 'contract')
      await client.query('ALTER TABLE documents DISABLE TRIGGER document_commit_guard');
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO documents(id,profile_id,business_record_type,business_record_id,category,state,scan_state,
        upload_key,storage_key,original_name,size_bytes,uploaded_by,uploaded_by_type,removed_at)
       VALUES($1,$2,$8::document_business_type,
         $7,$9,'Removed','Available',$3,$4,'Sensitive proof.pdf',123,$5,'customer',
         NOW()-($6::int * interval '1 year'))`,
      [id, profile, uploadKey, storageKey, user, ageYears, businessId, businessType, category]
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
    if (businessType === 'contract')
      await client.query('ALTER TABLE documents ENABLE TRIGGER document_commit_guard');
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
    ).rows
  ).toEqual([]);
});

it.each(['Paid', 'Cancelled', 'Refunded'])(
  'retains fifty-year-old invoice bytes even after the parent is %s',
  async (state) => {
    const invoiceId = randomUUID();
    await pool.query(
      `INSERT INTO invoices(id,profile_id,state,total_amount,paid_amount,refunded_amount,paid_at,cancelled_at)
       VALUES($1,$2,$3::invoice_state,100,CASE WHEN $3='Cancelled' THEN 0 ELSE 100 END,
         CASE WHEN $3='Refunded' THEN 100 ELSE 0 END,
         CASE WHEN $3='Paid' THEN NOW()-INTERVAL '50 years' ELSE NULL END,
         CASE WHEN $3='Cancelled' THEN NOW()-INTERVAL '50 years' ELSE NULL END)`,
      [invoiceId, profile, state]
    );
    const doc = await document(50, invoiceId);
    expect(await planDocumentDestruction(pool)).toBe(0);
    expect(
      (await pool.query('SELECT * FROM document_retention_eligibility($1)', [doc.id])).rows
    ).toEqual([]);
    expect(await runDocumentDestruction(pool, storage)).toMatchObject({ destroyed: 0, failed: 0 });
    expect(deleteObjectVersions).not.toHaveBeenCalled();
    expect(
      (await pool.query('SELECT storage_key FROM documents WHERE id=$1', [doc.id])).rows[0]
        .storage_key
    ).toBe(doc.storageKey);
  }
);

it.each(['contract', 'invoice', 'order', 'standalone'])(
  'permanently retains old %s bytes and refuses forged destruction approvals',
  async (type) => {
    const doc = await document(
      50,
      type === 'standalone' ? null : randomUUID(),
      type,
      type === 'standalone' ? 'contract' : 'document'
    );
    expect(await planDocumentDestruction(pool)).toBe(0);
    expect(
      (await pool.query('SELECT * FROM document_retention_eligibility($1)', [doc.id])).rows
    ).toEqual([]);
    await expect(
      pool.query(
        `INSERT INTO document_destruction_items
        (document_id,profile_id,policy_id,storage_key,upload_key,retention_deadline)
       SELECT $1,$2,id,$3,$4,NOW()-INTERVAL '1 year' FROM document_retention_policies
       WHERE business_record_type=$5 ORDER BY effective_date DESC LIMIT 1`,
        [doc.id, profile, doc.storageKey, doc.uploadKey, type]
      )
    ).rejects.toThrow('retained permanently');
    await expect(
      pool.query('UPDATE documents SET storage_key=NULL WHERE id=$1', [doc.id])
    ).rejects.toThrow('retained permanently');
    expect(deleteObjectVersions).not.toHaveBeenCalled();
  }
);

it.each(['approved', 'destroying'])(
  'cancels a legacy %s financial manifest before calling the storage provider',
  async (status) => {
    const doc = await document(50, randomUUID());
    const client = await pool.connect();
    try {
      await client.query(
        'ALTER TABLE document_destruction_items DISABLE TRIGGER document_permanent_destruction_guard'
      );
      await client.query(
        `INSERT INTO document_destruction_items
          (document_id,profile_id,policy_id,storage_key,upload_key,retention_deadline,
           status,approved_by,approved_at,destruction_started_at,attempts)
         SELECT $1,$2,id,$3,$4,NOW()-INTERVAL '1 year',$5,$6,NOW(),
           CASE WHEN $5='destroying' THEN NOW() ELSE NULL END,2
         FROM document_retention_policies WHERE business_record_type='invoice'
         ORDER BY effective_date DESC LIMIT 1`,
        [doc.id, profile, doc.storageKey, doc.uploadKey, status, user]
      );
    } finally {
      await client.query(
        'ALTER TABLE document_destruction_items ENABLE TRIGGER document_permanent_destruction_guard'
      );
      client.release();
    }
    expect(await runDocumentDestruction(pool, storage)).toMatchObject({
      destroyed: 0,
      cancelled: 1,
      failed: 0,
    });
    expect(deleteObjectVersions).not.toHaveBeenCalled();
    expect(
      (
        await pool.query(
          'SELECT status,last_error,attempts,approved_by FROM document_destruction_items WHERE document_id=$1',
          [doc.id]
        )
      ).rows[0]
    ).toMatchObject({
      status: 'cancelled',
      last_error: 'permanent_retention',
      attempts: 2,
      approved_by: user,
    });
    expect(
      (await pool.query('SELECT storage_key FROM documents WHERE id=$1', [doc.id])).rows[0]
        .storage_key
    ).toBe(doc.storageKey);
    expect(
      (
        await pool.query("SELECT event FROM audit_log WHERE metadata::jsonb->>'documentId'=$1", [
          doc.id,
        ])
      ).rows
    ).toContainEqual({ event: 'document_destruction_cancelled' });
  }
);

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
