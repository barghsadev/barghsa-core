import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { createStorageProvider, type StorageProvider } from '@barghsa/shared/storage';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>, storage: Server;
const objects = new Map<string, Buffer>();
const requireWorker = createRequire(resolve(__dirname, '../../../worker/package.json'));
const { cleanupStorageObjects } = requireWorker('./dist/storage/cleanup.js') as {
  cleanupStorageObjects(
    pool: Pool,
    storage: StorageProvider
  ): Promise<{ deleted: number; failed: number }>;
};
let cleanupProvider: StorageProvider;
let onPut: (() => Promise<void>) | undefined;
const headers: Record<string, Record<string, string>> = {};
let provinceId: string, cityId: string;
beforeAll(async () => {
  storage = createServer(async (req, res) => {
    const key = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname).replace(
      '/test-evidence/',
      ''
    );
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      objects.set(key, Buffer.concat(chunks));
      await onPut?.();
      res.setHeader('ETag', '"test"');
      res.end();
      return;
    }
    const bytes = objects.get(key);
    if (!bytes) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('Content-Type', 'application/pdf');
    res.end(bytes);
  });
  await new Promise<void>((resolve) => storage.listen(0, '127.0.0.1', resolve));
  cleanupProvider = createStorageProvider({
    type: 's3',
    bucket: 'test-evidence',
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${(storage.address() as { port: number }).port}`,
    accessKeyId: 'test-only-key',
    secretAccessKey: 'test-only-secret',
    forcePathStyle: true,
  });
  vi.stubEnv('DB_POOL_MAX', '1');
  try {
    http = await startHttpFixture(
      process.env.TEST_DATABASE_URL!,
      `http://127.0.0.1:${(storage.address() as { port: number }).port}`
    );
  } finally {
    vi.unstubAllEnvs();
  }
  for (const user of ['owner', 'other']) {
    await http.pool.query(
      "INSERT INTO users(user_id,username,password_hash) VALUES ($1,$2,'test')",
      [user, `${user}@example.test`]
    );
    const session = randomUUID(),
      csrf = randomUUID();
    await http.pool.query(
      "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline) VALUES ($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes')",
      [session, user, csrf, randomUUID()]
    );
    headers[user] = {
      Cookie: `barghsa_session=${session}`,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    };
  }
  provinceId = (
    await http.pool.query(
      "INSERT INTO provinces(name_fa,name_en) VALUES ('استان','Province') RETURNING id"
    )
  ).rows[0].id;
  cityId = (
    await http.pool.query(
      "INSERT INTO cities(province_id,name_fa,name_en) VALUES ($1,'شهر','City') RETURNING id",
      [provinceId]
    )
  ).rows[0].id;
}, 40000);
afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => storage?.close(() => resolve()));
});
it('seals only owned, verified legal documents and serves the immutable copy to the owner', async () => {
  const profileId = (
    await http.pool.query(
      "INSERT INTO profiles(user_id,profile_type,status) VALUES ('owner','LEGAL','DRAFT') RETURNING id"
    )
  ).rows[0].id;
  const key = `uploads/document/${randomUUID()}.pdf`,
    bytes = Buffer.from('%PDF-1.7\nOriginal registration evidence\n%%EOF');
  objects.set(key, bytes);
  const metadata = {
    verified: true,
    uploadedBy: 'owner',
    profileId,
    purpose: 'legal_profile_document',
  };
  await http.pool.query(
    "INSERT INTO storage_records(storage_key,status,metadata,file_size,content_type,category,file_name) VALUES ($1,'active',$2::jsonb,$3,'application/pdf','document','registration.pdf')",
    [key, JSON.stringify(metadata), bytes.length]
  );
  const body = {
    legalName: 'Company',
    nationalIdentifier: '12345678901',
    registrationNumber: '123',
    companyTypeId: 'limited-liability',
    representativeTitle: 'CEO',
    representativeRelationship: 'director',
    officialProvinceId: provinceId,
    officialCityId: cityId,
    officialFullAddress: 'Company Street',
    officialPostalCode: '1234567890',
    representativeFirstName: 'Person',
    representativeLastName: 'Owner',
    representativeNationalId: '1234567891',
    representativeProvinceId: provinceId,
    representativeCityId: cityId,
    representativeFullAddress: 'Street',
    representativePostalCode: '1234567890',
    documents: [key],
  };
  const submit = () =>
    fetch(`${http.base}/api/onboarding/legal/${profileId}`, {
      method: 'POST',
      headers: headers.owner!,
      body: JSON.stringify(body),
    });
  for (const invalid of [
    { ...metadata, uploadedBy: 'other' },
    { ...metadata, purpose: 'ticket_attachment' },
    { ...metadata, profileId: randomUUID() },
    { ...metadata, verified: false },
  ]) {
    await http.pool.query('UPDATE storage_records SET metadata=$2::jsonb WHERE storage_key=$1', [
      key,
      JSON.stringify(invalid),
    ]);
    expect((await submit()).status).toBe(400);
  }
  await http.pool.query('UPDATE storage_records SET metadata=$2::jsonb WHERE storage_key=$1', [
    key,
    JSON.stringify(metadata),
  ]);
  objects.set(key, Buffer.from('not a PDF'));
  expect((await submit()).status).toBe(400);
  objects.set(key, bytes);
  await http.pool.query(
    "CREATE FUNCTION reject_copy_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test reservation failure'; END $$; CREATE TRIGGER reject_copy_reservation BEFORE INSERT ON storage_records FOR EACH ROW WHEN (NEW.metadata->>'provisionalCopy'='true') EXECUTE FUNCTION reject_copy_reservation()"
  );
  expect((await submit()).status).toBe(500);
  expect([...objects.keys()]).toEqual([key]);
  await http.pool.query('DROP TRIGGER reject_copy_reservation ON storage_records');
  // Make the reservation due immediately to exercise a worker during the PUT.
  await http.pool.query(
    "CREATE FUNCTION age_copy_reservation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at=NOW()-INTERVAL '2 minutes'; RETURN NEW; END $$; CREATE TRIGGER age_copy_reservation BEFORE INSERT ON storage_records FOR EACH ROW WHEN (NEW.metadata->>'provisionalCopy'='true') EXECUTE FUNCTION age_copy_reservation()"
  );
  await http.pool.query(
    "CREATE FUNCTION reject_legal_documents_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_legal_documents_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event='legal_profile_saved') EXECUTE FUNCTION reject_legal_documents_audit()"
  );
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  onPut = async () => {
    entered();
    await gate;
  };
  const pendingSubmit = submit();
  await Promise.race([
    started,
    pendingSubmit.then(async (response) => {
      throw new Error(
        `PUT was never reached: ${response.status} ${await response.text()} ${http.logs()}`
      );
    }),
  ]);
  try {
    expect(await cleanupStorageObjects(http.pool, cleanupProvider)).toEqual({
      deleted: 0,
      failed: 0,
    });
  } finally {
    onPut = undefined;
    release();
  }
  expect((await pendingSubmit).status).toBe(500);
  expect((await http.pool.query('SELECT id FROM legal_profiles')).rows).toHaveLength(0);
  expect(
    (await http.pool.query("SELECT storage_key FROM storage_records WHERE status='immutable'")).rows
  ).toHaveLength(0);
  const abandoned = (
    await http.pool.query(
      "SELECT storage_key FROM storage_records WHERE metadata->>'provisionalCopy'='true'"
    )
  ).rows;
  expect(abandoned).toHaveLength(1);
  expect(objects.has(abandoned[0].storage_key)).toBe(true);
  await http.pool.query('DROP TRIGGER reject_legal_documents_audit ON audit_log');
  expect((await submit()).status, http.logs()).toBe(200);
  const sealed = (
    await http.pool.query('SELECT documents FROM legal_profiles WHERE id=$1', [profileId])
  ).rows[0].documents as string[];
  expect(sealed).toHaveLength(1);
  expect(sealed[0]).toMatch(/^legal-profile-documents\//);
  await http.pool.query("UPDATE storage_records SET updated_at=NOW()-INTERVAL '2 minutes'");
  expect(await cleanupStorageObjects(http.pool, cleanupProvider)).toEqual({
    deleted: 1,
    failed: 0,
  });
  expect(objects.has(abandoned[0].storage_key)).toBe(false);
  expect(objects.has(sealed[0]!)).toBe(true);
  expect(objects.has(key)).toBe(true);
  objects.set(key, Buffer.from('%PDF-1.7\nReplaced original'));
  expect(
    (await fetch(`${http.base}/api/onboarding/documents/${profileId}`, { headers: headers.other! }))
      .status
  ).toBe(404);
  const response = await fetch(`${http.base}/api/onboarding/documents/${profileId}`, {
    headers: headers.owner!,
  });
  expect(response.status).toBe(200);
  const data = (await response.json()) as {
    documents: Array<{ key: string; name: string; url: string }>;
  };
  expect(data.documents[0]).toMatchObject({ key: sealed[0], name: 'registration.pdf' });
  expect(new URL(data.documents[0]!.url).searchParams.get('X-Amz-Expires')).toBe('300');
  expect(await (await fetch(data.documents[0]!.url)).text()).toContain(
    'Original registration evidence'
  );
}, 20000);
