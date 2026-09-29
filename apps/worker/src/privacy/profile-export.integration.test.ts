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
}, 40000);

afterAll(async () => {
  await pool?.end();
  if (management) {
    await management.query(`DROP DATABASE "${database}"`);
    await management.end();
  }
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
