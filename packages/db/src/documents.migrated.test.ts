import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import { createDbClient } from './index';
import { documents, documentEvents, type Document } from './schema/documents';
import { eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { Pool } from 'pg';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runMigrations } from './migrate';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { contractDocuments, contractDocumentLocks } from './schema/documents';

let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
}, 30000);

it('matches declared document indexes, checks and foreign keys to the migrated database', async () => {
  for (const table of [documents, documentEvents, contractDocuments, contractDocumentLocks]) {
    const config = getTableConfig(table);
    const actualIndexes = (
      await fixture.pool.query(
        "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename=$1",
        [config.name]
      )
    ).rows.map((row) => row.indexname);
    expect(actualIndexes).toEqual(
      expect.arrayContaining(config.indexes.map((index) => index.config.name))
    );
    const actualConstraints = (
      await fixture.pool.query(`SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass`, [
        config.name,
      ])
    ).rows.map((row) => row.conname);
    expect(actualConstraints).toEqual(
      expect.arrayContaining(config.checks.map((check) => check.name))
    );
    for (const fk of config.foreignKeys) {
      expect(fk.reference().foreignColumns.length).toBeGreaterThan(0);
      expect(actualConstraints).toContain(fk.getName().slice(0, 63));
    }
  }
});
async function transaction<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error instanceof Error && error.cause ? error.cause : error;
  } finally {
    client.release();
  }
}
async function seed(contract = false) {
  return transaction(async (client) => {
    const owner = randomUUID(),
      profile = randomUUID(),
      contractId = randomUUID(),
      version = randomUUID(),
      key = `uploads/document/${randomUUID()}.pdf`;
    await client.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      owner,
    ]);
    await client.query(
      "INSERT INTO profiles(id,user_id,profile_type,is_default) VALUES($1,$2,'LEGAL',true)",
      [profile, owner]
    );
    if (contract) {
      await client.query(
        "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'electricity',$3)",
        [contractId, profile, version]
      );
      await client.query(
        'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,\'{"text":"Original"}\',\'Initial\',$3)',
        [version, contractId, owner]
      );
    }
    await client.query(
      `INSERT INTO storage_records(storage_key,status,file_name,content_type,file_size,category,metadata)
      VALUES($1,'removed','proof.pdf','application/pdf',20,'document',$2::jsonb)`,
      [
        key,
        JSON.stringify({
          uploadedBy: owner,
          provisionalUpload: true,
          uploadContext: { profileId: profile, purpose: 'staff_business_document' },
        }),
      ]
    );
    const doc = (
      await createDbClient(client)
        .insert(documents)
        .values({
          profileId: profile,
          businessRecordType: contract ? 'contract' : 'standalone',
          businessRecordId: contract ? contractId : null,
          category: 'document',
          uploadKey: key,
          originalName: 'proof.pdf',
          sizeBytes: 20,
          uploadedBy: owner,
          uploadedByType: 'staff',
        })
        .returning()
    )[0]!;
    if (contract)
      await client.query(
        "INSERT INTO contract_documents(contract_id,contract_version_id,document_id,role) VALUES($1,$2,$3,'signed')",
        [contractId, version, doc.id]
      );
    await event(client, doc, null);
    return { doc, owner, profile, contractId, version };
  });
}
async function event(client: PoolClient, doc: Document, previous: Document['state'] | null) {
  await createDbClient(client).insert(documentEvents).values({
    documentId: doc.id,
    revision: doc.revision,
    state: doc.state,
    previousState: previous,
    actorId: doc.uploadedBy,
  });
}
async function move(id: string, state: Document['state'], extra: Partial<Document> = {}) {
  return transaction(async (client) => {
    const old = (
      await createDbClient(client).select().from(documents).where(eq(documents.id, id))
    )[0]!;
    const update: Partial<Document> = { ...extra, state };
    if (state === 'PendingScan') update.scanState = 'Pending';
    if (state === 'Available' && !old.storageKey) {
      const key = `business-documents/${randomUUID()}/${'a'.repeat(64)}`;
      await client.query(
        `INSERT INTO storage_records(storage_key,status,file_size,content_type,signed_at,metadata)
        VALUES($1,'immutable',20,'application/pdf',NOW(),$2::jsonb)`,
        [
          key,
          JSON.stringify({
            sourceKey: old.uploadKey,
            sha256: 'a'.repeat(64),
            profileId: old.profileId,
            uploadedBy: old.uploadedBy,
          }),
        ]
      );
      Object.assign(update, {
        storageKey: key,
        detectedMime: 'application/pdf',
        checksum: 'a'.repeat(64),
        scanState: 'Available',
        scanSkippedReason: 'not_configured',
      });
    }
    const doc = (
      await createDbClient(client)
        .update(documents)
        .set(update)
        .where(eq(documents.id, id))
        .returning()
    )[0]!;
    await event(client, doc, old.state);
    return doc;
  });
}
async function ready(contract = false) {
  const f = await seed(contract);
  await move(f.doc.id, 'PendingScan');
  f.doc = await move(f.doc.id, 'Available');
  return f;
}

it('applies the production lifecycle with a separate scan state and contiguous immutable audit history', async () => {
  const f = await ready();
  await move(f.doc.id, 'SubmittedForReview');
  await expect(move(f.doc.id, 'Rejected')).rejects.toMatchObject({ code: '23514' });
  f.doc = await move(f.doc.id, 'Rejected', { rejectionReason: 'Unreadable' });
  expect(f.doc).toMatchObject({
    revision: 5,
    state: 'Rejected',
    scanState: 'Available',
    rejectionReason: 'Unreadable',
  });
  expect(
    (
      await fixture.pool.query(
        'SELECT revision,state FROM document_events WHERE document_id=$1 ORDER BY revision',
        [f.doc.id]
      )
    ).rows
  ).toEqual([
    { revision: 1, state: 'Uploading' },
    { revision: 2, state: 'PendingScan' },
    { revision: 3, state: 'Available' },
    { revision: 4, state: 'SubmittedForReview' },
    { revision: 5, state: 'Rejected' },
  ]);
  await expect(
    fixture.pool.query("UPDATE document_events SET reason='rewritten' WHERE document_id=$1", [
      f.doc.id,
    ])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM document_events WHERE document_id=$1', [f.doc.id])
  ).rejects.toMatchObject({ code: '23514' });
});

it('rejects out-of-order transitions, missing events and fabricated future events', async () => {
  const f = await ready();
  await expect(move(f.doc.id, 'Approved')).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query("UPDATE documents SET state='SubmittedForReview' WHERE id=$1", [f.doc.id])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      "INSERT INTO document_events(document_id,revision,state,previous_state,actor_id) VALUES($1,4,'Approved','Available',$2)",
      [f.doc.id, f.owner]
    )
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await fixture.pool.query('SELECT state,revision FROM documents WHERE id=$1', [f.doc.id]))
      .rows[0]
  ).toEqual({ state: 'Available', revision: 3 });
});

it('protects file identity, immutable content and replacement pointers against direct writes', async () => {
  const f = await ready();
  for (const change of [
    "original_name='changed.pdf'",
    "checksum=repeat('b',64)",
    'storage_key=NULL',
    'supersedes_document_id=id',
  ])
    await expect(
      fixture.pool.query(`UPDATE documents SET ${change},state='SubmittedForReview' WHERE id=$1`, [
        f.doc.id,
      ])
    ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM documents WHERE id=$1', [f.doc.id])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(move(f.doc.id, 'Superseded')).rejects.toMatchObject({ code: '23514' });
});

it('requires a reason when staff return a document for changes', async () => {
  const f = await ready();
  await move(f.doc.id, 'SubmittedForReview');
  await expect(move(f.doc.id, 'Available')).rejects.toMatchObject({ code: '23514' });
  expect(
    await move(f.doc.id, 'Available', { reviewComment: 'Please correct the scan' })
  ).toMatchObject({ state: 'Available', reviewComment: 'Please correct the scan' });
});

it('retains the signed-version lock even after a later contract version becomes current', async () => {
  const f = await ready(true);
  await move(f.doc.id, 'SubmittedForReview');
  await move(f.doc.id, 'Approved');
  await fixture.pool.query("UPDATE contracts SET state='Signed',signed_at=NOW() WHERE id=$1", [
    f.contractId,
  ]);
  expect(
    (
      await fixture.pool.query(
        'SELECT contract_version_id FROM contract_document_locks WHERE document_id=$1',
        [f.doc.id]
      )
    ).rows
  ).toEqual([{ contract_version_id: f.version }]);
  await transaction(async (client) => {
    const next = randomUUID();
    await client.query("UPDATE contracts SET state='Draft' WHERE id=$1", [f.contractId]);
    await client.query(
      'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,2,\'{"text":"Amendment"}\',\'Amendment\',$3)',
      [next, f.contractId, f.owner]
    );
    await client.query("UPDATE contracts SET current_version_id=$2,state='Draft' WHERE id=$1", [
      f.contractId,
      next,
    ]);
  });
  await expect(move(f.doc.id, 'Superseded')).rejects.toMatchObject({ code: '23514' });
  await move(f.doc.id, 'Quarantined', { scanState: 'Quarantined' });
  await expect(move(f.doc.id, 'Removed')).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM contract_document_locks WHERE document_id=$1', [f.doc.id])
  ).rejects.toMatchObject({ code: '23514' });
});

it('upgrades the actual 139 schema and reruns without fabricating documents or changing legacy storage', async () => {
  const production = resolve(__dirname, '../drizzle/production');
  const previous = mkdtempSync(join(tmpdir(), 'documents-before-'));
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 140),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  const name = 'test_document_upgrade_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined;
  let created = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(`INSERT INTO storage_records(storage_key,status,file_name,file_size,content_type,signed_at,signed_by,metadata)
      VALUES('legacy-evidence','immutable','existing.pdf',20,'application/pdf','2026-01-01','legacy-actor','{"legacy":true}')`);
    const before = (
      await pool.query("SELECT * FROM storage_records WHERE storage_key='legacy-evidence'")
    ).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0140_document_lifecycle'],
    });
    expect(
      (await pool.query("SELECT * FROM storage_records WHERE storage_key='legacy-evidence'")).rows
    ).toEqual(before);
    for (const table of [
      'documents',
      'document_events',
      'contract_documents',
      'contract_document_locks',
    ])
      expect((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count).toBe(
        0
      );
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${name}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 30000);
