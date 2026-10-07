import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
let db: Awaited<ReturnType<typeof createMigratedTestDb>>;
let profile: string, contract: string, consultation: string;
const actor = 'invoice-origin-test';
const contractFk = 'invoices_contract_id_contracts_invoice_reference_fk';
// PostgreSQL stores generated identifiers at its63-byte identifier limit.
const consultationFk = 'invoices_consultation_id_consultation_requests_invoice_reference_fk'.slice(
  0,
  63
);
beforeAll(async () => {
  db = await createMigratedTestDb();
  await db.pool.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
    actor,
  ]);
  profile = (
    await db.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES($1,'INDIVIDUAL','ACTIVE') RETURNING id",
      [actor]
    )
  ).rows[0].id;
  contract = randomUUID();
  const version = randomUUID(),
    client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,'solar',$3)",
      [contract, profile, version]
    );
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,'{\"fixture\":true}','Fixture',$3)",
      [version, contract, actor]
    );
    await client.query('COMMIT');
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
  const product = (await db.pool.query("SELECT id FROM products WHERE type='consultation' LIMIT 1"))
    .rows[0].id;
  consultation = (
    await db.pool.query(
      "INSERT INTO consultation_requests(profile_id,product_id,product_snapshot,submitted_by,submission_key) VALUES($1,$2,'{}',$3,$4) RETURNING id",
      [profile, product, actor, randomUUID()]
    )
  ).rows[0].id;
}, 30000);
afterAll(async () => {
  await db?.close();
});
async function invoice(contractId: string | null = null, consultationId: string | null = null) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO invoices(id,profile_id,type,state,total_amount,contract_id,consultation_id) VALUES($1,$2,'manual','Draft',100,$3,$4)",
    [id, profile, contractId, consultationId]
  );
  return id;
}
it('retains nullable origins and existing text values with validated RESTRICT foreign keys', async () => {
  const id = await invoice();
  expect(
    (await db.pool.query('SELECT contract_id,consultation_id FROM invoices WHERE id=$1', [id])).rows
  ).toEqual([{ contract_id: null, consultation_id: null }]);
  const constraints = (
    await db.pool.query(
      "SELECT conname,convalidated,confdeltype,confupdtype FROM pg_constraint WHERE conrelid='invoices'::regclass AND conname=ANY($1::text[]) ORDER BY conname",
      [[contractFk, consultationFk]]
    )
  ).rows;
  expect(constraints).toEqual(
    [consultationFk, contractFk]
      .sort()
      .map((conname) => ({ conname, convalidated: true, confdeltype: 'r', confupdtype: 'a' }))
  );
});
it('accepts current contract and consultation IDs and rejects nonexistent origins without creating invoices', async () => {
  for (const [contractId, consultationId, fk] of [
    [contract, null, contractFk],
    [null, consultation, consultationFk],
  ] as const) {
    const id = await invoice(contractId, consultationId);
    expect(
      (await db.pool.query('SELECT contract_id,consultation_id FROM invoices WHERE id=$1', [id]))
        .rows
    ).toEqual([{ contract_id: contractId, consultation_id: consultationId }]);
    const before = (await db.pool.query('SELECT id FROM invoices ORDER BY id')).rows;
    await expect(
      invoice(contractId ? randomUUID() : null, consultationId ? randomUUID() : null)
    ).rejects.toMatchObject({ code: '23503', constraint: fk });
    expect((await db.pool.query('SELECT id FROM invoices ORDER BY id')).rows).toEqual(before);
  }
});
it('prevents a referenced consultation from being deleted', async () => {
  await invoice(null, consultation);
  await expect(
    db.pool.query('DELETE FROM consultation_requests WHERE id=$1', [consultation])
  ).rejects.toMatchObject({ code: '23503', constraint: consultationFk });
  expect(
    (await db.pool.query('SELECT id FROM consultation_requests WHERE id=$1', [consultation])).rows
  ).toEqual([{ id: consultation }]);
});
it('upgrades existing valid origins without changing history and permits transactional rollback', async () => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query('SELECT * FROM invoices ORDER BY id')).rows;
    await client.query(
      `ALTER TABLE invoices DROP CONSTRAINT ${contractFk}, DROP CONSTRAINT ${consultationFk}`
    );
    await client.query(
      'ALTER TABLE contracts DROP COLUMN invoice_reference; ALTER TABLE consultation_requests DROP COLUMN invoice_reference'
    );
    await client.query('SAVEPOINT before_upgrade');
    await client.query(
      readFileSync(
        resolve('drizzle/production/0259_invoice_origin_foreign_keys.sql'),
        'utf8'
      ).replaceAll('--> statement-breakpoint', '')
    );
    expect((await client.query('SELECT * FROM invoices ORDER BY id')).rows).toEqual(before);
    await client.query('ROLLBACK TO SAVEPOINT before_upgrade');
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM pg_constraint WHERE conrelid='invoices'::regclass AND conname=ANY($1::text[])",
          [[contractFk, consultationFk]]
        )
      ).rows
    ).toEqual([{ count: 0 }]);
    expect((await client.query('SELECT * FROM invoices ORDER BY id')).rows).toEqual(before);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
it('fails validation on legacy orphan references and preserves them for reconciliation', async () => {
  const client = await db.pool.connect(),
    id = randomUUID(),
    missing = randomUUID();
  try {
    await client.query('BEGIN');
    await client.query(
      `ALTER TABLE invoices DROP CONSTRAINT ${contractFk}, DROP CONSTRAINT ${consultationFk}`
    );
    await client.query(
      'ALTER TABLE contracts DROP COLUMN invoice_reference; ALTER TABLE consultation_requests DROP COLUMN invoice_reference'
    );
    await client.query(
      "INSERT INTO invoices(id,profile_id,type,state,total_amount,contract_id) VALUES($1,$2,'manual','Draft',100,$3)",
      [id, profile, missing]
    );
    const before = (await client.query('SELECT * FROM invoices ORDER BY id')).rows;
    await client.query('SAVEPOINT before_upgrade');
    await expect(
      client.query(
        readFileSync(
          resolve('drizzle/production/0259_invoice_origin_foreign_keys.sql'),
          'utf8'
        ).replaceAll('--> statement-breakpoint', '')
      )
    ).rejects.toMatchObject({ code: '23503', constraint: contractFk });
    await client.query('ROLLBACK TO SAVEPOINT before_upgrade');
    expect((await client.query('SELECT * FROM invoices ORDER BY id')).rows).toEqual(before);
    expect(
      (
        await client.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='contracts' AND column_name='invoice_reference'"
        )
      ).rows
    ).toEqual([]);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});
