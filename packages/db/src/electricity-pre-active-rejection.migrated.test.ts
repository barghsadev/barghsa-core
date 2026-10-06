import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createMigratedTestDb } from './test/migrated-db';
import type { PoolClient } from 'pg';
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
      version = randomUUID(),
      order = randomUUID();
    await client.query(
      "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',true)",
      [actor]
    );
    await client.query('INSERT INTO profiles(id,user_id) VALUES($1,$2)', [profile, actor]);
    const product = (
      await client.query(
        "INSERT INTO products(type,system_key,title,status,price) VALUES('electricity','thermal','{\"en\":\"Thermal\"}','active',100) ON CONFLICT(system_key) DO UPDATE SET status='active',price=100 RETURNING id"
      )
    ).rows[0].id;
    await client.query(
      "INSERT INTO orders(id,user_id,profile_id,product_id,order_type,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,$3,$4,'electricity','test','test','Test address','1234567890')",
      [order, actor, profile, product]
    );
    await client.query(
      "INSERT INTO electricity_orders(id,profile_id,settings_snapshot,status,period_start,period_end,submitted_at,pricing_snapshot,total_kwh,average_power_kw,green_rule_applied,submitted_by) VALUES($1,$2,'{}','approved',NOW()+INTERVAL '2 days',NOW()+INTERVAL '9 days',NOW(),'{}',10,1,false,$3)",
      [order, profile, actor]
    );
    await client.query(
      "INSERT INTO contracts(id,profile_id,service_type,current_version_id,order_id) VALUES($1,$2,'electricity',$3,$4)",
      [contract, profile, version, order]
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
    return { actor, profile, contract, version, original, signed, order };
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

it.each([false, true])(
  'retains complete signature evidence when a pre-active electricity contract is rejected, signed=%s',
  async (signed) => {
    const f = await seed();
    const req = await request(f);
    if (signed) await record(f, req.id);
    const before = (
      await fixture.pool.query(
        `SELECT c.current_version_id,c.accepted_at,c.signed_at,
    (SELECT jsonb_agg(to_jsonb(v)) FROM contract_versions v WHERE v.contract_id=c.id) AS versions,
    (SELECT jsonb_agg(to_jsonb(p)) FROM contract_publications p WHERE p.contract_id=c.id) AS publications,
    (SELECT jsonb_agg(to_jsonb(a)) FROM contract_acceptances a WHERE a.contract_id=c.id) AS acceptances,
    (SELECT jsonb_agg(to_jsonb(r)) FROM contract_signature_requests r WHERE r.contract_id=c.id) AS requests,
    (SELECT jsonb_agg(to_jsonb(s)) FROM contract_signatures s WHERE s.contract_id=c.id) AS signatures
    FROM contracts c WHERE id=$1`,
        [f.contract]
      )
    ).rows[0];
    await fixture.pool.query("UPDATE contracts SET state='Rejected' WHERE id=$1", [f.contract]);
    expect(
      (await fixture.pool.query('SELECT state FROM contracts WHERE id=$1', [f.contract])).rows[0]
        .state
    ).toBe('Rejected');
    const after = (
      await fixture.pool.query(
        `SELECT c.current_version_id,c.accepted_at,c.signed_at,
    (SELECT jsonb_agg(to_jsonb(v)) FROM contract_versions v WHERE v.contract_id=c.id) AS versions,
    (SELECT jsonb_agg(to_jsonb(p)) FROM contract_publications p WHERE p.contract_id=c.id) AS publications,
    (SELECT jsonb_agg(to_jsonb(a)) FROM contract_acceptances a WHERE a.contract_id=c.id) AS acceptances,
    (SELECT jsonb_agg(to_jsonb(r)) FROM contract_signature_requests r WHERE r.contract_id=c.id) AS requests,
    (SELECT jsonb_agg(to_jsonb(s)) FROM contract_signatures s WHERE s.contract_id=c.id) AS signatures
    FROM contracts c WHERE id=$1`,
        [f.contract]
      )
    ).rows[0];
    expect(after).toEqual(before);
    for (const state of ['Draft', 'AwaitingStaffReview', 'Active', 'Cancelled'])
      await expect(
        fixture.pool.query('UPDATE contracts SET state=$2 WHERE id=$1', [f.contract, state])
      ).rejects.toMatchObject({ code: '23514' });
    await expect(
      fixture.pool.query('UPDATE contracts SET current_version_id=$2 WHERE id=$1', [
        f.contract,
        randomUUID(),
      ])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      fixture.pool.query('UPDATE contracts SET accepted_at=NOW() WHERE id=$1', [f.contract])
    ).rejects.toMatchObject({ code: '23514' });
    if (signed)
      await expect(
        fixture.pool.query('UPDATE contracts SET signed_at=NOW() WHERE id=$1', [f.contract])
      ).rejects.toMatchObject({ code: '23514' });
  }
);
it('refuses fabricated signatures and inconsistent active-order rejection', async () => {
  const f = await seed();
  await expect(
    tx(async (client) => {
      await client.query("UPDATE contracts SET state='Signed',signed_at=NOW() WHERE id=$1", [
        f.contract,
      ]);
      await client.query("UPDATE contracts SET state='Rejected' WHERE id=$1", [f.contract]);
    })
  ).rejects.toMatchObject({ code: '23514' });
  expect(
    (await fixture.pool.query('SELECT state,signed_at FROM contracts WHERE id=$1', [f.contract]))
      .rows[0]
  ).toEqual({ state: 'Accepted', signed_at: null });
  await fixture.pool.query("UPDATE electricity_orders SET status='active' WHERE id=$1", [f.order]);
  await expect(
    fixture.pool.query("UPDATE contracts SET state='Rejected' WHERE id=$1", [f.contract])
  ).rejects.toMatchObject({ code: '23514' });
});
