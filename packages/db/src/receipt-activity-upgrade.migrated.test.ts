import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { runMigrations } from './migrate';

it('preserves legacy evidence and captures receipt-bound actors/notes atomically without leaking across transactions', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'receipt-activity-upgrade-')),
    production = resolve('drizzle/production');
  const journal = JSON.parse(readFileSync(join(production, 'meta/_journal.json'), 'utf8'));
  const prior = {
    ...journal,
    entries: journal.entries.filter((entry: { idx: number }) => entry.idx < 237),
  };
  mkdirSync(join(previous, 'meta'));
  writeFileSync(join(previous, 'meta/_journal.json'), JSON.stringify(prior));
  for (const entry of prior.entries)
    copyFileSync(join(production, entry.tag + '.sql'), join(previous, entry.tag + '.sql'));
  const management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! }),
    database = 'test_receipt_activity_' + randomUUID().replaceAll('-', '');
  let pool: Pool | undefined,
    created = false;
  try {
    await management.query(`CREATE DATABASE "${database}"`);
    created = true;
    const url = new URL(process.env.TEST_DATABASE_URL!);
    url.pathname = '/' + database;
    const connection = { pgdirectUrl: url.toString() };
    expect((await runMigrations({ connection, migrationsFolder: previous })).ok).toBe(true);
    pool = new Pool({ connectionString: url.toString() });
    await pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES('customer','private-customer','test'),('staff','private-staff','test')"
    );
    const profile = (
      await pool.query(
        "INSERT INTO profiles(user_id,profile_type,status) VALUES('customer','INDIVIDUAL','ACTIVE') RETURNING id"
      )
    ).rows[0].id;
    const invoice = (
      await pool.query(
        "INSERT INTO invoices(profile_id,state,total_amount) VALUES($1,'Unpaid',1000) RETURNING id",
        [profile]
      )
    ).rows[0].id;
    const legacy = randomUUID();
    const insert =
      "INSERT INTO bank_receipts(id,invoice_id,profile_id,amount,payment_date,payer_reference,attachment_key,customer_note) VALUES($1,$2,$3,100,'2026-09-01','reference',$4,'Original customer note')";
    await pool.query(insert, [legacy, invoice, profile, randomUUID()]);
    await pool.query(
      "UPDATE bank_receipts SET state='Rejected',rejection_reason='Original rejection' WHERE id=$1",
      [legacy]
    );
    await pool.query(
      "INSERT INTO conversation_identities(user_id,display_name,share_in_activity,revision,updated_at) VALUES('staff','Chosen staff',true,7,'2025-01-01T00:00:00Z')"
    );
    const oldHistory = (
      await pool.query('SELECT * FROM bank_receipt_status_events ORDER BY occurred_at,id')
    ).rows;
    const oldReceipt = (await pool.query('SELECT * FROM bank_receipts')).rows;
    const identity = (await pool.query('SELECT * FROM conversation_identities')).rows;
    const checksums = (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id'))
      .rows;
    expect(await runMigrations({ connection })).toEqual({
      ok: true,
      applied: journal.entries
        .filter((entry: { idx: number }) => entry.idx >= 237)
        .map((entry: { tag: string }) => entry.tag),
    });
    expect(
      (await pool.query('SELECT * FROM bank_receipt_status_events ORDER BY occurred_at,id')).rows
    ).toEqual(
      oldHistory.map((row) => ({
        ...row,
        actor_user_id: null,
        actor_type: 'unknown',
        reason: null,
      }))
    );
    expect((await pool.query('SELECT * FROM bank_receipts')).rows).toEqual(oldReceipt);
    expect((await pool.query('SELECT * FROM conversation_identities')).rows).toEqual(
      identity.map((row) => ({ ...row, share_in_payment_activity: false }))
    );
    expect(
      (await pool.query('SELECT * FROM drizzle.__drizzle_migrations ORDER BY id')).rows.slice(
        0,
        checksums.length
      )
    ).toEqual(checksums);
    expect(await runMigrations({ connection })).toEqual({ ok: true, applied: [] });
    await expect(
      pool.query(
        "UPDATE conversation_identities SET display_name=NULL,share_in_activity=false,share_in_payment_activity=true WHERE user_id='staff'"
      )
    ).rejects.toMatchObject({ code: '23514', constraint: 'conversation_identity_payment_name' });
    const receipt = randomUUID(),
      other = randomUUID(),
      unbound = randomUUID(),
      unattributed = randomUUID();
    const client = await pool.connect();
    const bind = async (id: string, userId: string | null, actorType: string) =>
      client.query("SELECT set_config('barghsa.receipt_actor',$1,true)", [
        JSON.stringify({ receiptId: id, userId, actorType }),
      ]);
    try {
      await client.query('BEGIN');
      await bind(receipt, 'customer', 'customer');
      await client.query(insert, [receipt, invoice, profile, randomUUID()]);
      await client.query(insert, [other, invoice, profile, randomUUID()]);
      await bind(receipt, 'staff', 'staff');
      await client.query("UPDATE bank_receipts SET state='UnderReview' WHERE id=ANY($1::uuid[])", [
        [receipt, other],
      ]);
      await bind(unattributed, null, 'staff');
      await client.query(insert, [unattributed, invoice, profile, randomUUID()]);
      await client.query('COMMIT');
      await client.query(insert, [unbound, invoice, profile, randomUUID()]);
      await client.query('BEGIN');
      await bind(receipt, 'staff', 'staff');
      await client.query(
        "UPDATE bank_receipts SET state='Rejected',rejection_reason='Rolled back' WHERE id=$1",
        [receipt]
      );
      await client.query('ROLLBACK');
      expect(
        (
          await client.query(
            'SELECT state FROM bank_receipt_status_events WHERE receipt_id=$1 ORDER BY occurred_at,id',
            [receipt]
          )
        ).rows.map((row) => row.state)
      ).toEqual(['Submitted', 'UnderReview']);
      await client.query('BEGIN');
      await bind(receipt, 'staff', 'staff');
      await client.query(
        "UPDATE bank_receipts SET state='Rejected',rejection_reason='Recorded rejection <script>' WHERE id=$1",
        [receipt]
      );
      await client.query(
        "UPDATE bank_receipts SET state='Rejected',rejection_reason='Later mutable note' WHERE id=$1",
        [receipt]
      );
      await client.query('COMMIT');
      const events = (
        await client.query(
          'SELECT state,actor_user_id,actor_type,reason FROM bank_receipt_status_events WHERE receipt_id=$1 ORDER BY occurred_at,id',
          [receipt]
        )
      ).rows;
      expect(events).toEqual([
        {
          state: 'Submitted',
          actor_user_id: 'customer',
          actor_type: 'customer',
          reason: 'Original customer note',
        },
        { state: 'UnderReview', actor_user_id: 'staff', actor_type: 'staff', reason: null },
        {
          state: 'Rejected',
          actor_user_id: 'staff',
          actor_type: 'staff',
          reason: 'Recorded rejection <script>',
        },
      ]);
      expect(
        (
          await client.query(
            'SELECT actor_type,actor_user_id FROM bank_receipt_status_events WHERE receipt_id=ANY($1::uuid[])',
            [[other, unbound, unattributed]]
          )
        ).rows.every((row) => row.actor_type === 'unknown' && row.actor_user_id === null)
      ).toBe(true);
      await client.query('BEGIN');
      await bind(other, 'staff', 'invalid');
      await expect(
        client.query(
          "UPDATE bank_receipts SET state='Rejected',rejection_reason='Invalid actor' WHERE id=$1",
          [other]
        )
      ).rejects.toMatchObject({ code: '23514', constraint: 'chk_receipt_status_actor_type' });
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await pool.query("DELETE FROM users WHERE user_id='staff'");
    expect(
      (
        await pool.query(
          "SELECT actor_user_id,actor_type FROM bank_receipt_status_events WHERE receipt_id=$1 AND state='Rejected'",
          [receipt]
        )
      ).rows[0]
    ).toEqual({ actor_user_id: null, actor_type: 'staff' });
  } finally {
    await pool?.end();
    try {
      if (created) await management.query(`DROP DATABASE "${database}"`);
    } finally {
      await management.end();
      rmSync(previous, { recursive: true, force: true });
    }
  }
}, 120000);
