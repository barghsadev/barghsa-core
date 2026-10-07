import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';

it('preserves legacy reasons, requires new review reasons and rolls the additive guard back without losing data', async () => {
  const production = resolve('drizzle/production'),
    previous = mkdtempSync(join(tmpdir(), 'increase-reason-upgrade-'));
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((e: { idx: number }) => e.idx < 262),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const e of prior.entries)
    copyFileSync(join(production, e.tag + '.sql'), join(previous, e.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    name = 'test_increase_reason_' + randomUUID().replaceAll('-', '');
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
      order = randomUUID(),
      contract = randomUUID(),
      version = randomUUID();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO users(user_id,username,password_hash) VALUES($1,$1,'fixture')",
        [actor]
      );
      await client.query("INSERT INTO profiles(id,user_id,profile_type) VALUES($1,$2,'LEGAL')", [
        profile,
        actor,
      ]);
      const product = (
        await client.query(
          "INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','thermal','{\"en\":\"Fixture\"}','active',100) RETURNING id"
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','province','city','Fixture address','1234567890')",
        [order, actor, profile, product]
      );
      await client.query(
        "INSERT INTO electricity_orders(id,profile_id,status,settings_snapshot,period_start,period_end,total_kwh) VALUES($1,$2,'draft','{}','2050-01-01','2051-01-01',10)",
        [order, profile]
      );
      await client.query(
        "INSERT INTO contracts(id,profile_id,order_id,service_type,current_version_id) VALUES($1,$2,$3,'electricity',$4)",
        [contract, profile, order, version]
      );
      await client.query(
        'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,\'{"text":"Legacy terms"}\',\'Initial\',$3)',
        [version, contract, actor]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const seed = async () => {
      const id = randomUUID();
      await pool!.query(
        "INSERT INTO electricity_quantity_increase_requests(id,contract_id,order_id,profile_id,version_id,requested_by,original_kwh,requested_kwh,max_percentage,effective_from,period_end) VALUES($1,$2,$3,$4,$5,$6,10,12,20,'2050-01-02','2051-01-01')",
        [id, contract, order, profile, version, actor]
      );
      return id;
    };
    const row = async (id: string) =>
      (await pool!.query('SELECT * FROM electricity_quantity_increase_requests WHERE id=$1', [id]))
        .rows;
    const review = async (id: string, reason: string | null, status = 'awaiting_signature') =>
      pool!.query(
        "UPDATE electricity_quantity_increase_requests SET status=$2,reviewed_by=$3,reviewed_at=NOW(),review_reason=$4,amendment_document=CASE WHEN $2='rejected' THEN NULL ELSE '{\"legacy\":true}'::jsonb END,amendment_sha256=CASE WHEN $2='rejected' THEN NULL ELSE $5 END WHERE id=$1",
        [id, status, actor, reason, 'a'.repeat(64)]
      );
    const legacy = await seed();
    await review(legacy, null);
    const before = await row(legacy);
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: ['0262_electricity_increase_approval_reason'],
    });
    expect(await row(legacy)).toEqual(before);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    await expect(
      pool.query(
        "UPDATE electricity_quantity_increase_requests SET review_reason='Invented history' WHERE id=$1",
        [legacy]
      )
    ).rejects.toMatchObject({ code: '23514' });
    expect(await row(legacy)).toEqual(before);
    // Historical reviewed rows remain undeletable.
    await expect(
      pool.query('DELETE FROM electricity_quantity_increase_requests WHERE id=$1', [legacy])
    ).rejects.toMatchObject({ code: '23514' });
    const lock = await pool.connect();
    try {
      await lock.query('BEGIN');
      await lock.query(
        'DROP TRIGGER electricity_increase_decision_reason_guard ON electricity_quantity_increase_requests'
      );
      await lock.query('DROP FUNCTION guard_electricity_increase_decision_reason()');
      expect(
        (
          await lock.query('SELECT * FROM electricity_quantity_increase_requests WHERE id=$1', [
            legacy,
          ])
        ).rows
      ).toEqual(before);
      await lock.query('ROLLBACK');
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    await expect(
      pool.query(
        "UPDATE electricity_quantity_increase_requests SET review_reason='Still immutable' WHERE id=$1",
        [legacy]
      )
    ).rejects.toMatchObject({ code: '23514' });
    // One fixture transaction creates a fresh linked contract for the new decision.
    const newContract = randomUUID(),
      newVersion = randomUUID(),
      pending = randomUUID(),
      c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        "INSERT INTO contracts(id,profile_id,order_id,service_type,current_version_id) VALUES($1,$2,$3,'electricity',$4)",
        [newContract, profile, order, newVersion]
      );
      await c.query(
        'INSERT INTO contract_versions(id,contract_id,version_number,content,change_description,created_by) VALUES($1,$2,1,\'{"text":"Current terms"}\',\'Initial\',$3)',
        [newVersion, newContract, actor]
      );
      await c.query(
        "INSERT INTO electricity_quantity_increase_requests(id,contract_id,order_id,profile_id,version_id,requested_by,original_kwh,requested_kwh,max_percentage,effective_from,period_end) VALUES($1,$2,$3,$4,$5,$6,10,12,20,'2050-01-02','2051-01-01')",
        [pending, newContract, order, profile, newVersion, actor]
      );
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      c.release();
    }
    const pendingBefore = await row(pending);
    for (const state of ['approved', 'awaiting_signature', 'rejected']) {
      await expect(review(pending, null, state)).rejects.toMatchObject({ code: '23514' });
      expect(await row(pending)).toEqual(pendingBefore);
    }
    await review(pending, 'Capacity reviewed');
    const approved = await row(pending);
    expect(approved[0]).toMatchObject({
      status: 'awaiting_signature',
      review_reason: 'Capacity reviewed',
    });
    await expect(
      pool.query(
        "UPDATE electricity_quantity_increase_requests SET review_reason='Changed reason' WHERE id=$1",
        [pending]
      )
    ).rejects.toMatchObject({ code: '23514' });
    expect(await row(pending)).toEqual(approved);
    expect(await row(legacy)).toEqual(before);
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
