import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startHttpFixture } from '../test/http-fixture.js';
let http: Awaited<ReturnType<typeof startHttpFixture>>, storage: Server;
const objects = new Map<string, Buffer>();
let headers: Record<string, string>;
beforeAll(async () => {
  storage = createServer((req, res) => {
    const key = decodeURIComponent(new URL(req.url!, 'http://localhost').pathname).replace(
      '/test-evidence/',
      ''
    );
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
  http = await startHttpFixture(
    process.env.TEST_DATABASE_URL!,
    `http://127.0.0.1:${(storage.address() as { port: number }).port}`
  );
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_admin,is_staff) VALUES ('storage-actor','storage-actor@example.test','test-only',true,true)"
  );
  const session = randomUUID(),
    csrf = randomUUID();
  await http.pool.query(
    "INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at) VALUES ($1,'storage-actor',$2,$3,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())",
    [session, csrf, randomUUID()]
  );
  headers = {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}, 40000);
afterAll(async () => {
  await http?.close();
  await new Promise<void>((resolve) => storage?.close(() => resolve()));
});
async function seed() {
  const key = `uploads/document/${randomUUID()}.pdf`;
  objects.set(key, Buffer.from('%PDF-1.7 test'));
  await http.pool.query(
    "INSERT INTO storage_records(storage_key,status,file_name,content_type,file_size,category) VALUES ($1,'active','evidence.pdf','application/pdf',13,'document')",
    [key]
  );
  return key;
}
function request(key: string, method = 'GET', body?: unknown) {
  return fetch(
    `${http.base}/api/admin/storage/records/${encodeURIComponent(key)}${method === 'POST' ? '/sign' : ''}`,
    { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }
  );
}
async function row(key: string) {
  return (await http.pool.query('SELECT * FROM storage_records WHERE storage_key=$1', [key]))
    .rows[0];
}
it('reads real metadata and binds an idempotent signature to the authenticated actor', async () => {
  const key = await seed();
  expect(await (await request(key)).json()).toMatchObject({
    key,
    status: 'active',
    fileName: 'evidence.pdf',
    contentType: 'application/pdf',
    fileSize: 13,
  });
  expect((await request(key, 'POST', { signedBy: 'forged' })).status).toBe(400);
  const signed = await request(key, 'POST', {});
  expect(signed.status, http.logs()).toBe(200);
  expect(await signed.json()).toMatchObject({ status: 'immutable', signedBy: 'storage-actor' });
  const first = await row(key);
  expect((await request(key, 'POST', {})).status).toBe(200);
  expect((await row(key)).signed_at).toEqual(first.signed_at);
  expect(
    (
      await http.pool.query(
        "SELECT id FROM audit_log WHERE event='storage_record_signed' AND metadata::jsonb->>'storageKey'=$1",
        [key]
      )
    ).rows
  ).toHaveLength(1);
});
it('queues active deletion after commit and retains signed files with truthful repeat responses', async () => {
  const active = await seed(),
    signed = await seed();
  expect((await request(active, 'DELETE')).status).toBe(204);
  expect(await row(active)).toMatchObject({
    status: 'removed',
    metadata: { deletionRequested: true },
  });
  expect(objects.has(active)).toBe(true);
  expect((await request(active, 'POST', {})).status).toBe(409);
  expect((await request(signed, 'POST', {})).status).toBe(200);
  expect((await request(signed, 'DELETE')).status).toBe(409);
  expect(await row(signed)).toMatchObject({
    status: 'removed',
    signed_by: 'storage-actor',
    metadata: { deletionRequested: false },
  });
  expect((await request(signed, 'DELETE')).status).toBe(204);
  expect(objects.has(signed)).toBe(true);
});
it('rolls back signatures and removal requests when audit persistence fails', async () => {
  await http.pool.query(
    "CREATE FUNCTION reject_storage_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER reject_storage_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.event IN ('storage_record_signed','storage_record_removed')) EXECUTE FUNCTION reject_storage_audit()"
  );
  try {
    for (const method of ['POST', 'DELETE']) {
      const key = await seed();
      expect((await request(key, method, method === 'POST' ? {} : undefined)).status).toBe(500);
      expect(await row(key)).toMatchObject({ status: 'active', signed_at: null, removed_at: null });
      expect((await row(key)).metadata?.deletionRequested).not.toBe(true);
      expect(objects.has(key)).toBe(true);
    }
  } finally {
    await http.pool.query('DROP TRIGGER reject_storage_audit ON audit_log');
  }
});
it('does not sign missing files or create history for unknown records', async () => {
  const key = await seed();
  objects.delete(key);
  expect((await request(key, 'POST', {})).status).toBe(404);
  expect((await row(key)).status).toBe('active');
  expect((await request('unknown', 'DELETE')).status).toBe(404);
});

it('authenticates every upload step and requires CSRF before storage access', async () => {
  const bytes = Buffer.from('%PDF-1.7 test');
  const body = {
    fileName: 'upload.pdf',
    contentType: 'application/pdf',
    fileSize: bytes.length,
    category: 'document',
  };
  for (const suffix of [
    'presigned-url',
    `${encodeURIComponent('uploads/document/test.pdf')}/verify`,
    `${encodeURIComponent('uploads/document/test.pdf')}/record`,
  ]) {
    const url = `${http.base}/api/upload/${suffix}`;
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(401);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Cookie: headers.Cookie!, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(403);
  }
  const presigned = await fetch(`${http.base}/api/upload/presigned-url`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  expect(presigned.status).toBe(200);
  const upload = (await presigned.json()) as {
    key: string;
    presignedUrl: string;
    expiresIn: number;
  };
  expect(upload.key).toMatch(/^uploads\/document\/[a-f0-9-]+\.pdf$/);
  expect(upload.expiresIn).toBe(3600);
  objects.set(upload.key, bytes);
  const verify = await fetch(`${http.base}/api/upload/${encodeURIComponent(upload.key)}/verify`, {
    method: 'POST',
    headers,
    body: '{}',
  });
  expect(verify.status).toBe(200);
  expect(await verify.json()).toMatchObject({ status: 'confirmed' });
  const record = await fetch(`${http.base}/api/upload/${encodeURIComponent(upload.key)}/record`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  expect(record.status).toBe(200);
  expect((await row(upload.key)).metadata).toMatchObject({
    uploadedBy: 'storage-actor',
    verified: true,
  });
});
