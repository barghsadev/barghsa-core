import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Pool } from 'pg';
import { runMigrations } from './migrate';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import type { PoolClient } from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { contractSignatureRequests, contractSignatures } from './schema/contract-signatures';
let fixture: Awaited<ReturnType<typeof createMigratedTestDb>>;
beforeAll(async () => {
  fixture = await createMigratedTestDb();
}, 30000);
afterAll(async () => {
  await fixture?.close();
}, 30000);
async function tx<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function seed(accepted = true) {
  return tx(async (client) => {
    const actor = randomUUID(),
      profile = randomUUID(),
      contract = randomUUID(),
      version = randomUUID();
    await client.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',true)",
      [actor]
    );
    await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    await client.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'electricity',$3)",
      [contract, profile, version]
    );
    await client.query(
      'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,$4,$5)',
      [version, contract, JSON.stringify({ text: 'Accepted terms' }), 'Initial', actor]
    );
    if (accepted) {
      await client.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [
        contract,
      ]);
      await client.query(
        'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
        [contract, version, actor]
      );
      await client.query(
        'INSERT INTO contract_acceptances(contract_id,version_id,accepted_by) VALUES($1,$2,$3)',
        [contract, version, actor]
      );
    }
    const doc = async (role: string) => {
      const id = randomUUID(),
        upload = 'uploads/' + randomUUID(),
        copy = 'business-documents/' + randomUUID();
      await client.query(
        "INSERT INTO storage_records(storage_key,status,file_name,content_type,file_size,category,metadata) VALUES($1,'removed','copy.pdf','application/pdf',20,'contract',$2::jsonb)",
        [
          upload,
          JSON.stringify({
            uploadedBy: actor,
            provisionalUpload: true,
            uploadContext: { profileId: profile, purpose: 'staff_business_document' },
          }),
        ]
      );
      await client.query(
        "INSERT INTO documents(id,profile_id,business_record_type,business_record_id,category,upload_key,original_name,size_bytes,uploaded_by,uploaded_by_type) VALUES($1,$2,'contract',$3,'contract',$4,'copy.pdf',20,$5,'staff')",
        [id, profile, contract, upload, actor]
      );
      await client.query(
        'INSERT INTO contract_documents(contract_id,contract_version_id,document_id,role) VALUES($1,$2,$3,$4)',
        [contract, version, id, role]
      );
      await client.query(
        "INSERT INTO document_events(document_id,revision,state,actor_id) VALUES($1,1,'Uploading',$2)",
        [id, actor]
      );
      await client.query(
        "INSERT INTO storage_records(storage_key,status,content_type,file_size,signed_at,metadata) VALUES($1,'immutable','application/pdf',20,NOW(),$2::jsonb)",
        [
          copy,
          JSON.stringify({
            sourceKey: upload,
            sha256: 'a'.repeat(64),
            profileId: profile,
            uploadedBy: actor,
          }),
        ]
      );
      let previous = 'Uploading',
        revision = 1;
      for (const state of ['PendingScan', 'Available', 'SubmittedForReview', 'Approved']) {
        if (state === 'PendingScan')
          await client.query("UPDATE documents SET state=$2,scan_state='Pending' WHERE id=$1", [
            id,
            state,
          ]);
        else if (state === 'Available')
          await client.query(
            "UPDATE documents SET state=$2,scan_state='Available',scan_skipped_reason='not_configured',storage_key=$3,checksum=$4,detected_mime='application/pdf' WHERE id=$1",
            [id, state, copy, 'a'.repeat(64)]
          );
        else await client.query('UPDATE documents SET state=$2 WHERE id=$1', [id, state]);
        revision++;
        await client.query(
          'INSERT INTO document_events(document_id,revision,previous_state,state,actor_id) VALUES($1,$2,$3,$4,$5)',
          [id, revision, previous, state, actor]
        );
        previous = state;
      }
      return id;
    };
    const original = await doc('original'),
      signed = await doc('signed');
    return { actor, profile, contract, version, original, signed };
  });
}
type Fixture = Awaited<ReturnType<typeof seed>>;
async function request(f: Fixture, number = 1, document = f.original) {
  return (
    await fixture.pool.query(
      'INSERT INTO contract_signature_requests(contract_id,version_id,request_number,original_document_id,requested_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [f.contract, f.version, number, document, f.actor]
    )
  ).rows[0];
}
async function record(f: Fixture, requestId: string, document = f.signed) {
  return (
    await fixture.pool.query(
      "INSERT INTO contract_signatures(contract_id,version_id,request_id,signed_document_id,recorded_by,recorded_by_type) VALUES($1,$2,$3,$4,$5,'staff') RETURNING *",
      [f.contract, f.version, requestId, document, f.actor]
    )
  ).rows[0];
}
it('matches migrated signature indexes, constraints and foreign keys to the declared schema', async () => {
  for (const table of [contractSignatureRequests, contractSignatures]) {
    const config = getTableConfig(table);
    const constraints = (
      await fixture.pool.query('SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass', [
        config.name,
      ])
    ).rows.map((row) => row.conname);
    const indexes = (
      await fixture.pool.query('SELECT indexname FROM pg_indexes WHERE tablename=$1', [config.name])
    ).rows.map((row) => row.indexname);
    for (const fk of config.foreignKeys) expect(constraints).toContain(fk.getName().slice(0, 63));
    for (const check of config.checks) expect(constraints).toContain(check.name);
    for (const index of config.indexes) expect(indexes).toContain(index.config.name);
  }
});
it('rejects signature flags without immutable evidence and requires accepted original PDFs', async () => {
  const f = await seed(false);
  await expect(request(f)).rejects.toMatchObject({ code: '23514' });
  for (const clause of [
    "state='AwaitingSignature'",
    "state='Signed'",
    "state='Signed',signed_at=NOW()",
  ]) {
    await expect(
      fixture.pool.query(`UPDATE contracts SET ${clause} WHERE id=$1`, [f.contract])
    ).rejects.toMatchObject({ code: '23514' });
  }
  const client = await fixture.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("UPDATE contracts SET state='Signed',signed_at=NOW() WHERE id=$1", [
      f.contract,
    ]);
    await expect(
      client.query("UPDATE contracts SET state='Active' WHERE id=$1", [f.contract])
    ).rejects.toMatchObject({ code: '23514' });
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const accepted = await seed();
  await expect(request(accepted, 1, accepted.signed)).rejects.toMatchObject({ code: '23514' });
  const other = await seed();
  await expect(request(accepted, 1, other.original)).rejects.toMatchObject({ code: '23514' });
  await expect(request(accepted, 2)).rejects.toMatchObject({ code: '23514' });
});
it('binds recording to the latest request and approved signed role of the exact version', async () => {
  const f = await seed(),
    first = await request(f),
    latest = await request(f, 2);
  expect(
    (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [f.contract])).rows[0]
      .state
  ).toBe('AwaitingSignature');
  await expect(record(f, first.id)).rejects.toMatchObject({ code: '23514' });
  await expect(record(f, latest.id, f.original)).rejects.toMatchObject({ code: '23514' });
  const other = await seed();
  await expect(record(f, latest.id, other.signed)).rejects.toMatchObject({ code: '23514' });
  const evidence = await record(f, latest.id);
  expect(evidence.recorded_by).toBe(f.actor);
  expect(evidence.recorded_by_type).toBe('staff');
  expect(
    (await fixture.pool.query('SELECT state,signed_at FROM contracts WHERE id=$1', [f.contract]))
      .rows[0]
  ).toEqual({ state: 'Signed', signed_at: evidence.recorded_at });
  expect(
    (
      await fixture.pool.query(
        'SELECT document_id FROM contract_document_locks WHERE contract_version_id=$1',
        [f.version]
      )
    ).rows
      .map((row) => row.document_id)
      .sort()
  ).toEqual([f.original, f.signed].sort());
  for (const table of ['contract_signature_requests', 'contract_signatures']) {
    await expect(
      fixture.pool.query(`DELETE FROM ${table} WHERE version_id=$1`, [f.version])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      fixture.pool.query(`UPDATE ${table} SET contract_id=contract_id WHERE version_id=$1`, [
        f.version,
      ])
    ).rejects.toMatchObject({ code: '23514' });
  }
  await expect(
    fixture.pool.query('UPDATE contracts SET signed_at=NULL WHERE id=$1', [f.contract])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query("UPDATE documents SET state='Superseded' WHERE id=$1", [f.signed])
  ).rejects.toMatchObject({ code: '23514' });
  await expect(request(f, 3)).rejects.toMatchObject({ code: '23514' });
});
it('refuses a quarantined requested original and serializes concurrent recordings', async () => {
  const f = await seed(),
    r = await request(f);
  await tx(async (client) => {
    await client.query(
      "UPDATE documents SET state='Quarantined',scan_state='Quarantined' WHERE id=$1",
      [f.original]
    );
    await client.query(
      "INSERT INTO document_events(document_id,revision,previous_state,state,actor_id) VALUES($1,6,'Approved','Quarantined',$2)",
      [f.original, f.actor]
    );
  });
  await expect(record(f, r.id)).rejects.toMatchObject({ code: '23514' });
  const good = await seed(),
    pending = await request(good);
  const outcomes = await Promise.allSettled([record(good, pending.id), record(good, pending.id)]);
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(
    (
      await fixture.pool.query(
        'SELECT count(*)::int AS n FROM contract_signatures WHERE version_id=$1',
        [good.version]
      )
    ).rows[0].n
  ).toBe(1);
});

it('upgrades 0140 without inventing evidence for historical signed flags and reruns safely', async () => {
  const production = resolve(__dirname, '../drizzle/production'),
    previous = mkdtempSync(join(tmpdir(), 'signature-before-'));
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 141),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_signature_upgrade_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined,
    created = false;
  try {
    await management.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + name;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    const actor = randomUUID(),
      profile = randomUUID(),
      contract = randomUUID(),
      version = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
        actor,
      ]);
      await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
      await client.query(
        "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'electricity',$3)",
        [contract, profile, version]
      );
      await client.query(
        'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,$4,$5)',
        [version, contract, JSON.stringify({ text: 'Historical terms' }), 'Legacy', actor]
      );
      await client.query("UPDATE contracts SET state='Signed',signed_at='2026-01-01' WHERE id=$1", [
        contract,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const before = (await pool.query('SELECT * FROM contracts WHERE id=$1', [contract])).rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: [
        '0141_contract_signature_evidence',
        '0142_contract_activation_requirements',
        '0143_contract_system_activation',
        '0144_contract_term_completion',
        '0145_contract_cancellation',
      ],
    });
    expect((await pool.query('SELECT * FROM contracts WHERE id=$1', [contract])).rows).toEqual(
      before
    );
    for (const table of ['contract_signature_requests', 'contract_signatures'])
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    expect(
      (
        await pool.query(
          'SELECT rule_revision,signature_required,payment_required,initial_invoice_id FROM contract_activation_requirements WHERE version_id=$1',
          [version]
        )
      ).rows[0]
    ).toEqual({
      rule_revision: 1,
      signature_required: false,
      payment_required: true,
      initial_invoice_id: null,
    });

    await pool.query('UPDATE contracts SET updated_at=NOW() WHERE id=$1', [contract]);
    await expect(
      pool.query("UPDATE contracts SET state='Active' WHERE id=$1", [contract])
    ).rejects.toMatchObject({ code: '23514' });
    for (const state of ['Cancelled']) {
      await pool.query('UPDATE contracts SET state=$2 WHERE id=$1', [contract, state]);
      expect(
        (await pool.query('SELECT state,signed_at FROM contracts WHERE id=$1', [contract])).rows[0]
      ).toEqual({ state, signed_at: before[0].signed_at });
    }
    await expect(
      pool.query('UPDATE contracts SET signed_at=NOW() WHERE id=$1', [contract])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query("UPDATE contracts SET state='Draft' WHERE id=$1", [contract])
    ).rejects.toMatchObject({ code: '23514' });
    expect((await pool.query('SELECT count(*)::int AS n FROM contract_signatures')).rows[0].n).toBe(
      0
    );
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
