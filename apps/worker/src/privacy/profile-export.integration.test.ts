import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import yauzl from 'yauzl';
import type { StorageProvider } from '@barghsa/shared/storage';
import { runMigrations } from '../../../../packages/db/src/migrate.js';
import { cleanupExpiredProfileExports, generateProfileExport } from './profile-export.js';

const database = `test_profile_export_${randomUUID().replaceAll('-', '')}`;
const userId = 'profile-export-owner';
let management: Pool;
let pool: Pool;
let profileId: string;
let ticketId: string;
let jobId: string;
let leaseToken: string;
let portfolio: { savingId: string; solarId: string; consultationId: string };
const objects = new Map<string, Buffer>();
const scheduled = new Set<string>();
const provider = {
  async putObject(key: string, body: ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    objects.set(key, Buffer.concat(chunks));
  },
  async getObject() {
    return {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from('customer document'));
          controller.close();
        },
      }),
    };
  },
  async deleteObject(key: string) {
    objects.delete(key);
  },
  async scheduleExpiration(key: string) {
    scheduled.add(key);
    return { eligibleVersions: 1, heldVersions: 0 };
  },
} as unknown as StorageProvider;

async function seedPortfolio(ownedProfile: string, label: string) {
  const province = (
    await pool.query("INSERT INTO provinces(name_fa,name_en) VALUES('استان',$1) RETURNING id", [
      label,
    ])
  ).rows[0].id;
  const city = (
    await pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES($1,'شهر',$2) RETURNING id",
      [province, label]
    )
  ).rows[0].id;
  const address = (
    await pool.query(
      "INSERT INTO addresses(profile_id,province_id,city_id,full_address,postal_code,main_address) VALUES($1,$2,$3,$4,'1234567890',true) RETURNING id",
      [ownedProfile, province, city, label + ' address']
    )
  ).rows[0].id;
  const product = async (type: string) =>
    (
      await pool.query(
        "INSERT INTO products(type,title,status,price) VALUES($1,$2::jsonb,'active',100000) RETURNING id",
        [type, JSON.stringify({ en: label })]
      )
    ).rows[0].id;
  const plan = await product('saving_plan'),
    hardware = await product('hardware'),
    consultation = await product('consultation');
  const agreement = (
    await pool.query(
      "INSERT INTO saving_plan_agreement_versions(plan_id,title,body,status,effective_from,created_by) VALUES($1,'Agreement',$2,'draft',NULL,$3) RETURNING id",
      [plan, label + ' accepted saving terms', userId]
    )
  ).rows[0].id;
  await pool.query(
    "UPDATE saving_plan_agreement_versions SET status='active',effective_from=now() WHERE id=$1",
    [agreement]
  );
  const order = (
    await pool.query(
      "INSERT INTO orders(profile_id,product_id,order_type,user_id,snapshot_province_id,snapshot_city_id,snapshot_full_address,snapshot_postal_code) VALUES($1,$2,'savings',$3,$4,$5,$6,'1234567890') RETURNING id",
      [ownedProfile, plan, userId, province, city, label + ' original order address']
    )
  ).rows[0].id;
  const savingId = (
    await pool.query(
      `INSERT INTO saving_orders(order_id,profile_id,saving_plan_id,hardware_product_id,bill_identifier,installation_address_id,agreement_version_id,agreement_snapshot,address_snapshot,pricing_snapshot,verification_result)
    VALUES($1,$2,$3,$4,'1234567890',$5,$6,$7,$8::jsonb,'{"total":"9007199254740993"}','{"providerSecret":"PROVIDER_PRIVATE"}') RETURNING id`,
      [
        order,
        ownedProfile,
        plan,
        hardware,
        address,
        agreement,
        label + ' accepted saving terms',
        JSON.stringify({ fullAddress: label + ' original saving address' }),
      ]
    )
  ).rows[0].id as string;
  await pool.query(
    "INSERT INTO saving_order_lines(order_id,description,amount,type) VALUES($1,$2,9007199254740993,'plan_price')",
    [savingId, label + ' plan']
  );
  await pool.query(
    "INSERT INTO saving_fulfillment_stages(order_id,stage,status,explanation) VALUES($1,'request_confirmation','in_progress',$2)",
    [savingId, label + ' fulfillment']
  );
  await pool.query(
    "INSERT INTO saving_fulfillment_events(order_id,stage,from_status,to_status,actor_user_id,explanation) VALUES($1,'request_confirmation','pending','in_progress',$2,$3)",
    [savingId, userId, label + ' fulfillment']
  );
  await pool.query(
    'INSERT INTO saving_order_comments(order_id,author_user_id,body) VALUES($1,$2,$3)',
    [savingId, userId, label + ' customer comment']
  );
  const solarId = (
    await pool.query(
      `INSERT INTO solar_construction_requests(profile_id,submitted_by,submission_key,building_type,grid_type,property_form,structural_frame,building_completion_date,agreement_accepted,agreement_version,agreement_snapshot,agreement_accepted_at,submission_review)
    VALUES($1,$2,$3,'building_apartment','off_grid','villa','concrete','2020-01-01',true,'v1',$4,now(),$5::jsonb) RETURNING id`,
      [
        ownedProfile,
        userId,
        randomUUID(),
        label + ' accepted solar terms',
        JSON.stringify({
          data: { siteAddress: label + ' original solar address' },
          internalSecret: 'SOLAR_REVIEW_PRIVATE',
        }),
      ]
    )
  ).rows[0].id as string;
  await pool.query(
    'INSERT INTO solar_document_requests(request_id,description,requested_by) VALUES($1,$2,$3)',
    [solarId, label + ' document request', userId]
  );
  await pool.query(
    "INSERT INTO solar_construction_postal(request_id,status,courier,tracking_number,send_date,staff_notes) VALUES($1,'shipped',$2,'TRACKING-1',now(),'POSTAL_INTERNAL_PRIVATE')",
    [solarId, label + ' courier']
  );
  const consultationId = (
    await pool.query(
      `INSERT INTO consultation_requests(profile_id,product_id,product_snapshot,submitted_by,submission_key,status,fee,scope,deliverables,expected_next_step,offer_valid_until,staff_team)
    VALUES($1,$2,$3::jsonb,$4,$5,'offer_pending',9007199254740993,$6,$7,$8,now()+interval '1 day','ASSIGNMENT_PRIVATE') RETURNING id`,
      [
        ownedProfile,
        consultation,
        JSON.stringify({ title: label }),
        userId,
        randomUUID(),
        label + ' scope',
        label + ' deliverables',
        label + ' next step',
      ]
    )
  ).rows[0].id as string;
  await pool.query(
    "INSERT INTO consultation_request_events(request_id,status,actor_user_id,reason) VALUES($1,'offer_pending',$2,$3)",
    [consultationId, userId, label + ' published offer']
  );
  return { savingId, solarId, consultationId };
}

async function unzip(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, archive) => {
      if (error || !archive) return reject(error ?? new Error('Invalid archive'));
      const files = new Map<string, Buffer>();
      archive.on('error', reject);
      archive.on('end', () => resolve(files));
      archive.on('entry', (entry) => {
        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) return reject(streamError ?? new Error('Missing entry'));
          const chunks: Buffer[] = [];
          stream.on('error', reject);
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => {
            files.set(entry.fileName, Buffer.concat(chunks));
            archive.readEntry();
          });
        });
      });
      archive.readEntry();
    });
  });
}

beforeAll(async () => {
  management = new Pool({ connectionString: process.env.TEST_DATABASE_URL! });
  await management.query(`CREATE DATABASE "${database}"`);
  const url = new URL(process.env.TEST_DATABASE_URL!);
  url.pathname = `/${database}`;
  const migration = await runMigrations({ connection: { pgdirectUrl: url.toString() } });
  if (!migration.ok) throw new Error(JSON.stringify(migration));
  pool = new Pool({ connectionString: url.toString() });
  await pool.query(
    `INSERT INTO users(user_id,username,password_hash,email)
     VALUES($1,'owner@example.test','secret-password-hash','owner@example.test')`,
    [userId]
  );
  profileId = (
    await pool.query(
      `INSERT INTO profiles(user_id,profile_type,status,is_default,first_name)
       VALUES($1,'INDIVIDUAL','ACTIVE',true,'Customer') RETURNING id`,
      [userId]
    )
  ).rows[0].id as string;
  ticketId = randomUUID();
  jobId = randomUUID();
  leaseToken = randomUUID();
  await pool.query(
    `INSERT INTO async_jobs(id,type,payload,created_by,status,attempts,lease_token,lease_until)
     VALUES($1,'profile-export',$2::jsonb,$3,'processing',1,$4,now()+interval '1 minute')`,
    [jobId, JSON.stringify({ ticketId, profileId, userId }), userId, leaseToken]
  );
  await pool.query(
    `INSERT INTO tickets(id,user_id,profile_id,subject,body,category,privacy_request_type,
                         privacy_request_key,privacy_export_job_id)
     VALUES($1,$2,$3,'Export','Customer requested export','privacy','export',$4,$5)`,
    [ticketId, userId, profileId, randomUUID(), jobId]
  );
  await pool.query(
    `INSERT INTO storage_records(storage_key,status,file_name,file_size,category,content_type,metadata)
     VALUES
       ('test-upload','removed','statement.txt',17,'document','text/plain',$1::jsonb),
       ('test-sealed','immutable','statement.txt',17,'document','text/plain',$2::jsonb)`,
    [
      JSON.stringify({
        uploadedBy: userId,
        uploadContext: { profileId, purpose: 'business_document' },
        provisionalUpload: true,
      }),
      JSON.stringify({
        sourceKey: 'test-upload',
        sha256: 'a'.repeat(64),
        profileId,
        uploadedBy: userId,
      }),
    ]
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const documentId = (
      await client.query(
        `INSERT INTO documents(profile_id,business_record_type,category,state,scan_state,
                              upload_key,original_name,size_bytes,uploaded_by,uploaded_by_type)
         VALUES($1,'standalone','document','Uploading','Uploading','test-upload',
                'statement.txt',17,$2,'customer') RETURNING id`,
        [profileId, userId]
      )
    ).rows[0].id as string;
    async function event(revision: number, state: string, previous: string | null) {
      await client.query(
        `INSERT INTO document_events(id,document_id,revision,state,previous_state,actor_id)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [randomUUID(), documentId, revision, state, previous, userId]
      );
    }
    await event(1, 'Uploading', null);
    await client.query(
      `UPDATE documents SET state='PendingScan',scan_state='Pending' WHERE id=$1`,
      [documentId]
    );
    await event(2, 'PendingScan', 'Uploading');
    await client.query(
      `UPDATE documents SET storage_key='test-sealed',detected_mime='text/plain',checksum=$2
       WHERE id=$1`,
      [documentId, 'a'.repeat(64)]
    );
    await event(3, 'PendingScan', 'PendingScan');
    await client.query(
      `UPDATE documents SET state='Available',scan_state='Available' WHERE id=$1`,
      [documentId]
    );
    await event(4, 'Available', 'PendingScan');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  portfolio = await seedPortfolio(profileId, 'customer');
  const otherProfile = (
    await pool.query(
      "INSERT INTO profiles(user_id,profile_type,status,is_default) VALUES($1,'LEGAL','ACTIVE',false) RETURNING id",
      [userId]
    )
  ).rows[0].id as string;
  await seedPortfolio(otherProfile, 'OTHER_PROFILE_PRIVATE');
}, 40000);

afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE "${database}"`);
    await management.end();
  }
});

it('refuses to publish a customer export from a staff-context job', async () => {
  await pool.query(`UPDATE async_jobs SET operating_context='staff' WHERE id=$1`, [jobId]);
  await expect(
    generateProfileExport(
      { ticketId, profileId, userId },
      { jobId, leaseToken, setProgress: async () => undefined },
      pool,
      provider
    )
  ).rejects.toThrow('Profile export no longer authorized');
  expect(objects.size).toBe(0);
  await pool.query(`UPDATE async_jobs SET operating_context='customer' WHERE id=$1`, [jobId]);
});

it('creates a private archive with customer fields and eligible document bytes, then expires it', async () => {
  const progress: number[] = [];
  const result = await generateProfileExport(
    { ticketId, profileId, userId },
    {
      jobId,
      leaseToken,
      setProgress: async (value) => {
        progress.push(value);
      },
    },
    pool,
    provider
  );
  expect(result.resultUrl).toBe(`/api/tickets/lifecycle-requests/${ticketId}/export`);
  expect(progress).toEqual([10, 90]);
  const row = (
    await pool.query(
      `SELECT privacy_export_storage_key,privacy_export_expires_at FROM tickets WHERE id=$1`,
      [ticketId]
    )
  ).rows[0];
  expect(row.privacy_export_expires_at).toBeInstanceOf(Date);
  expect(row.privacy_export_storage_key).toMatch(/^tmp\/profile-exports\//);
  expect(scheduled.has(row.privacy_export_storage_key)).toBe(true);
  const bytes = objects.get(row.privacy_export_storage_key);
  expect(bytes).toBeDefined();
  const files = await unzip(bytes!);
  const data = JSON.parse(files.get('data.json')!.toString()) as Record<string, unknown>;
  expect((data.profile as Record<string, unknown>[])[0]).toMatchObject({ first_name: 'Customer' });
  expect((data.account as Record<string, unknown>[])[0]).not.toHaveProperty('password_hash');
  expect(
    files
      .get('documents/' + (data.documents as { id: string }[])[0]!.id + '/statement.txt')
      ?.toString()
  ).toBe('customer document');
  expect(JSON.stringify(data)).not.toContain('secret-password-hash');
  expect(data.savingOrders).toEqual([
    expect.objectContaining({
      id: portfolio.savingId,
      agreement_snapshot: 'customer accepted saving terms',
      address_snapshot: { fullAddress: 'customer original saving address' },
    }),
  ]);
  expect(data.savingOrderLines).toEqual([
    expect.objectContaining({ order_id: portfolio.savingId, amount: '9007199254740993' }),
  ]);
  expect(data.savingFulfillmentStages).toEqual([
    expect.objectContaining({ order_id: portfolio.savingId, explanation: 'customer fulfillment' }),
  ]);
  expect(data.savingFulfillmentEvents).toEqual([
    expect.objectContaining({ order_id: portfolio.savingId, explanation: 'customer fulfillment' }),
  ]);
  expect(data.savingOrderComments).toEqual([
    expect.objectContaining({ order_id: portfolio.savingId, body: 'customer customer comment' }),
  ]);
  expect(data.solarRequests).toEqual([
    expect.objectContaining({
      id: portfolio.solarId,
      site_address: 'customer original solar address',
      agreement_snapshot: 'customer accepted solar terms',
    }),
  ]);
  expect(data.solarDocumentRequests).toEqual([
    expect.objectContaining({
      request_id: portfolio.solarId,
      description: 'customer document request',
    }),
  ]);
  expect(data.solarPostal).toEqual([
    expect.objectContaining({
      request_id: portfolio.solarId,
      courier: 'customer courier',
      tracking_number: 'TRACKING-1',
    }),
  ]);
  expect(data.consultations).toEqual([
    expect.objectContaining({
      id: portfolio.consultationId,
      fee: '9007199254740993',
      scope: 'customer scope',
      deliverables: 'customer deliverables',
    }),
  ]);
  expect(data.consultationEvents).toEqual([
    expect.objectContaining({
      request_id: portfolio.consultationId,
      reason: 'customer published offer',
    }),
  ]);
  for (const protectedValue of [
    'OTHER_PROFILE_PRIVATE',
    'PROVIDER_PRIVATE',
    'SOLAR_REVIEW_PRIVATE',
    'POSTAL_INTERNAL_PRIVATE',
    'ASSIGNMENT_PRIVATE',
  ])
    expect(JSON.stringify(data)).not.toContain(protectedValue);

  expect(
    (
      await pool.query(
        `SELECT count(*)::int AS count FROM audit_log WHERE event='profile_export_generated'`
      )
    ).rows[0].count
  ).toBe(1);
  await pool.query(
    `UPDATE tickets SET privacy_export_expires_at=now()-interval '1 second' WHERE id=$1`,
    [ticketId]
  );
  expect(await cleanupExpiredProfileExports(pool, provider)).toBe(1);
  expect(objects.has(row.privacy_export_storage_key)).toBe(false);
  expect(await cleanupExpiredProfileExports(pool, provider)).toBe(0);
});

it.each(['lease change', 'audit failure'] as const)(
  'removes an uploaded archive without publishing it after %s',
  async (failure) => {
    const before = (
      await pool.query(
        "SELECT count(*)::int AS count FROM audit_log WHERE event='profile_export_generated'"
      )
    ).rows[0].count;
    let uploadedKey = '';
    const intercepted = {
      ...provider,
      async putObject(key: string, body: ReadableStream) {
        await provider.putObject(key, body, 'application/zip');
        uploadedKey = key;
        if (failure === 'lease change')
          await pool.query('UPDATE async_jobs SET lease_token=$2 WHERE id=$1', [
            jobId,
            randomUUID(),
          ]);
        else
          await pool.query(`CREATE FUNCTION reject_export_audit() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN IF NEW.event='profile_export_generated' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$;
          CREATE TRIGGER reject_export_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_export_audit()`);
      },
    } as StorageProvider;
    try {
      await expect(
        generateProfileExport(
          { ticketId, profileId, userId },
          { jobId, leaseToken, setProgress: async () => undefined },
          pool,
          intercepted
        )
      ).rejects.toThrow(failure === 'lease change' ? 'authorization changed' : 'audit unavailable');
      expect(uploadedKey).toMatch(/^tmp\/profile-exports\//);
      expect(objects.has(uploadedKey)).toBe(false);
      expect(
        (await pool.query('SELECT privacy_export_storage_key FROM tickets WHERE id=$1', [ticketId]))
          .rows[0].privacy_export_storage_key
      ).toBeNull();
      expect(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM audit_log WHERE event='profile_export_generated'"
          )
        ).rows[0].count
      ).toBe(before);
    } finally {
      await pool.query('UPDATE async_jobs SET lease_token=$2 WHERE id=$1', [jobId, leaseToken]);
      if (failure === 'audit failure')
        await pool.query(
          'DROP TRIGGER IF EXISTS reject_export_audit ON audit_log; DROP FUNCTION IF EXISTS reject_export_audit()'
        );
    }
  }
);

it('does not generate an export after the owner switches active profiles', async () => {
  const second = (
    await pool.query(
      `INSERT INTO profiles(user_id,profile_type,status,is_default)
       VALUES($1,'LEGAL','ACTIVE',false) RETURNING id`,
      [userId]
    )
  ).rows[0].id as string;
  await pool.query(`INSERT INTO user_profile_contexts(user_id,profile_id) VALUES($1,$2)`, [
    userId,
    second,
  ]);
  await expect(
    generateProfileExport(
      { ticketId, profileId, userId },
      { jobId, leaseToken, setProgress: async () => undefined },
      pool,
      provider
    )
  ).rejects.toThrow('no longer authorized');
});
