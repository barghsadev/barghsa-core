import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PoolClient } from 'pg';
import { createMigratedTestDb } from './test/migrated-db';
import {
  contractActivationRules,
  contractActivationRequirements,
} from './schema/contract-activation';
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
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function seed(service = 'electricity') {
  return tx(async (client) => {
    const actor = randomUUID(),
      profile = randomUUID(),
      contract = randomUUID(),
      version = randomUUID();
    await client.query("INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'test')", [
      actor,
    ]);
    await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    await client.query(
      'INSERT INTO contracts(id,profile_id,service_type,current_version_id) VALUES($1,$2,$3,$4)',
      [contract, profile, service, version]
    );
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,$3::jsonb,'Initial',$4)",
      [version, contract, JSON.stringify({ text: 'Terms' }), actor]
    );
    return { actor, profile, contract, version };
  });
}
async function requirements(version: string) {
  return (
    await fixture.pool.query('SELECT * FROM contract_activation_requirements WHERE version_id=$1', [
      version,
    ])
  ).rows[0];
}
it('matches declared schema and enforces mandatory service requirements', async () => {
  for (const table of [contractActivationRules, contractActivationRequirements]) {
    const config = getTableConfig(table);
    const constraints = (
      await fixture.pool.query('SELECT conname FROM pg_constraint WHERE conrelid=$1::regclass', [
        config.name,
      ])
    ).rows.map((r) => r.conname);
    for (const check of config.checks) expect(constraints).toContain(check.name);
    for (const fk of config.foreignKeys) expect(constraints).toContain(fk.getName().slice(0, 63));
  }
  await expect(
    fixture.pool.query(
      "UPDATE contract_activation_rules SET signature_required=false,revision=revision+1 WHERE service_type='solar'"
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      "UPDATE contract_activation_rules SET payment_required=false,revision=revision+1 WHERE service_type='electricity'"
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query("DELETE FROM contract_activation_rules WHERE service_type='savings'")
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      "UPDATE contract_activation_rules SET signature_required=true WHERE service_type='savings'"
    )
  ).rejects.toMatchObject({ code: '23514' });
});
it('snapshots defaults per service and does not retroactively change existing versions', async () => {
  const e = await seed(),
    s = await seed('savings'),
    solar = await seed('solar');
  expect(await requirements(e.version)).toMatchObject({
    signature_required: false,
    payment_required: true,
    service_start_required: false,
    initial_invoice_id: null,
  });
  expect(await requirements(s.version)).toMatchObject({
    signature_required: false,
    payment_required: false,
  });
  expect(await requirements(solar.version)).toMatchObject({
    signature_required: true,
    payment_required: false,
  });
  const before = await requirements(e.version);
  await fixture.pool.query(
    "UPDATE contract_activation_rules SET signature_required=true,service_start_required=true,revision=revision+1,updated_by=$1 WHERE service_type='electricity'",
    [e.actor]
  );
  expect(await requirements(e.version)).toEqual(before);
  const newVersion = randomUUID();
  await tx(async (client) => {
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,2,$3::jsonb,'Changed',$4)",
      [newVersion, e.contract, JSON.stringify({ text: 'New terms' }), e.actor]
    );
    await client.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [
      e.contract,
      newVersion,
    ]);
  });
  expect(await requirements(newVersion)).toMatchObject({
    signature_required: true,
    service_start_required: true,
    rule_revision: before.rule_revision + 1,
  });
  await expect(
    fixture.pool.query(
      'UPDATE contract_activation_requirements SET signature_required=false WHERE version_id=$1',
      [newVersion]
    )
  ).rejects.toMatchObject({ code: '23514' });
});
it('validates invoice ownership and freezes payment/date context once published', async () => {
  const f = await seed(),
    other = await seed(),
    invoice = randomUUID(),
    wrong = randomUUID();
  await fixture.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,type,state,total_amount) VALUES($1,$2,$3,'manual','Unpaid',100),($4,$5,$6,'manual','Unpaid',100)",
    [invoice, f.profile, f.contract, wrong, other.profile, other.contract]
  );
  await expect(
    fixture.pool.query(
      'UPDATE contract_activation_requirements SET initial_invoice_id=$2 WHERE version_id=$1',
      [f.version, wrong]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await fixture.pool.query(
    "UPDATE contract_activation_requirements SET initial_invoice_id=$2,service_starts_at='2026-10-01T00:00:00Z' WHERE version_id=$1",
    [f.version, invoice]
  );
  expect(await requirements(f.version)).toMatchObject({
    initial_invoice_id: invoice,
    service_starts_at: new Date('2026-10-01T00:00:00Z'),
  });
  await fixture.pool.query("UPDATE contracts SET state='AwaitingStaffReview' WHERE id=$1", [
    f.contract,
  ]);
  await fixture.pool.query(
    'INSERT INTO contract_publications(contract_id,version_id,published_by) VALUES($1,$2,$3)',
    [f.contract, f.version, f.actor]
  );
  await expect(
    fixture.pool.query(
      'UPDATE contract_activation_requirements SET initial_invoice_id=NULL WHERE version_id=$1',
      [f.version]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query(
      'UPDATE contract_activation_requirements SET service_starts_at=NULL WHERE version_id=$1',
      [f.version]
    )
  ).rejects.toMatchObject({ code: '23514' });
  await expect(
    fixture.pool.query('DELETE FROM contract_activation_requirements WHERE version_id=$1', [
      f.version,
    ])
  ).rejects.toMatchObject({ code: '23514' });
});
it('preserves prior draft context on a new version without copying its rule revision', async () => {
  const f = await seed('savings'),
    invoice = randomUUID(),
    next = randomUUID();
  await fixture.pool.query(
    "INSERT INTO invoices(id,profile_id,contract_id,type,state,total_amount) VALUES($1,$2,$3,'manual','Unpaid',100)",
    [invoice, f.profile, f.contract]
  );
  await fixture.pool.query(
    "UPDATE contract_activation_requirements SET initial_invoice_id=$2,service_starts_at='2026-11-01T00:00:00Z' WHERE version_id=$1",
    [f.version, invoice]
  );
  await tx(async (client) => {
    await client.query(
      "INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,2,$3::jsonb,'Changed',$4)",
      [next, f.contract, JSON.stringify({ text: 'Revised' }), f.actor]
    );
    await client.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [
      f.contract,
      next,
    ]);
  });
  expect(await requirements(next)).toMatchObject({
    initial_invoice_id: invoice,
    service_starts_at: new Date('2026-11-01T00:00:00Z'),
  });
  await expect(
    fixture.pool.query(
      'UPDATE contract_activation_requirements SET service_starts_at=NULL WHERE version_id=$1',
      [f.version]
    )
  ).rejects.toMatchObject({ code: '23514' });
});
