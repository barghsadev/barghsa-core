import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import PDFDocument from 'pdfkit';
import yazl from 'yazl';
import { startHttpFixture } from '../test/http-fixture.js';
import { DOCX_MIME, PDF_MIME } from './document-template-extraction.js';

const requireShared = createRequire(resolve(__dirname, '../../../../packages/shared/package.json'));
const { S3Client, CreateBucketCommand } = requireShared('@aws-sdk/client-s3') as {
  S3Client: new (config: Record<string, unknown>) => {
    send(command: unknown): Promise<unknown>;
    destroy(): void;
  };
  CreateBucketCommand: new (input: { Bucket: string }) => unknown;
};
let minio: StartedTestContainer;
let s3: InstanceType<typeof S3Client>;
let http: Awaited<ReturnType<typeof startHttpFixture>>;
const sessions: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  minio = await new GenericContainer(
    'pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372'
  )
    .withEnvironment({ MINIO_ROOT_USER: 'test-only-key', MINIO_ROOT_PASSWORD: 'test-only-secret' })
    .withCommand(['server', '/data'])
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  const endpoint = `http://${minio.getHost()}:${minio.getMappedPort(9000)}`;
  s3 = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test-only-key', secretAccessKey: 'test-only-secret' },
  });
  await s3.send(new CreateBucketCommand({ Bucket: 'test-evidence' }));
  http = await startHttpFixture(process.env.TEST_DATABASE_URL!, endpoint);
  await login('template-admin', true);
  await login('template-customer', false);
}, 60_000);
afterAll(async () => {
  try {
    await http?.close();
  } finally {
    s3?.destroy();
    await minio?.stop();
  }
}, 30_000);

async function login(user: string, staff: boolean) {
  await http.pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$1,'test',$2)",
    [user, staff]
  );
  if (staff)
    await http.pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [
      user,
      'role-legal-contracts',
    ]);
  const session = randomUUID();
  const csrf = randomUUID();
  await http.pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
     VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW()-INTERVAL '1 second')`,
    [session, user, csrf, randomUUID()]
  );
  sessions[user] = { Cookie: `barghsa_session=${session}`, 'X-CSRF-Token': csrf };
}

function request(path: string, user: string, method = 'GET', body?: unknown) {
  const multipart = body instanceof FormData;
  return fetch(`${http.base}/api/admin/document-templates${path}`, {
    method,
    headers: {
      ...sessions[user],
      ...(multipart || body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
  });
}

async function docx(text: string) {
  const archive = new yazl.ZipFile();
  archive.addBuffer(Buffer.from('<Types/>'), '[Content_Types].xml');
  archive.addBuffer(
    Buffer.from(`<w:document><w:p><w:t>${text}</w:t></w:p></w:document>`),
    'word/document.xml'
  );
  const chunks: Buffer[] = [];
  archive.outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) =>
    archive.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
  );
  archive.end();
  return done;
}

async function pdf(text: string) {
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) =>
    document.on('end', () => resolve(Buffer.concat(chunks)))
  );
  document.text(text);
  document.end();
  return done;
}

function versionForm(
  retainedFileIds: string[],
  files: Array<{ name: string; mime: string; bytes: Buffer }>
) {
  const body = new FormData();
  body.set('retainedFileIds', JSON.stringify(retainedFileIds));
  body.set('changeSummary', 'Updated customer terms');
  for (const file of files)
    body.append('files', new Blob([new Uint8Array(file.bytes)], { type: file.mime }), file.name);
  return body;
}

it('versions PDF and DOCX files, extracts merged placeholders, and keeps historical downloads', async () => {
  expect((await request('', 'template-customer')).status).toBe(403);
  const createdResponse = await request('', 'template-admin', 'POST', {
    title: 'Customer agreement',
    description: 'Signed agreement template',
    category: 'contract',
  });
  expect(createdResponse.status, await createdResponse.clone().text()).toBe(201);
  const created = (await createdResponse.json()) as { id: string; versions: unknown[] };
  expect(created.versions).toEqual([]);
  const firstDocx = await docx('Buyer {{customerName}} accepts on {{date}}.');
  const firstPdf = await pdf('Recipient {{customerName}} signs contract {{contractNumber}}.');
  const firstResponse = await request(
    `/${created.id}/versions`,
    'template-admin',
    'POST',
    versionForm(
      [],
      [
        { name: 'terms.docx', mime: DOCX_MIME, bytes: firstDocx },
        { name: 'terms.pdf', mime: PDF_MIME, bytes: firstPdf },
      ]
    )
  );
  expect(firstResponse.status, await firstResponse.clone().text()).toBe(201);
  const first = (await firstResponse.json()) as {
    versions: Array<{
      id: string;
      versionNumber: number;
      placeholders: string[];
      missingRequired: string[];
      conflicts: Array<{ name: string }>;
      files: Array<{ id: string; originalName: string; sizeBytes: number }>;
    }>;
  };
  expect(first.versions[0]).toMatchObject({
    versionNumber: 1,
    placeholders: ['contractNumber', 'customerName', 'date'],
    missingRequired: [],
  });
  expect(first.versions[0]!.conflicts.map((conflict) => conflict.name)).toContain('customerName');
  const originalPdf = first.versions[0]!.files.find((file) => file.originalName === 'terms.pdf')!;
  const originalDocx = first.versions[0]!.files.find((file) => file.originalName === 'terms.docx')!;
  expect(originalDocx.sizeBytes).toBe(firstDocx.length);
  const linkResponse = await request(
    `/${created.id}/versions/${first.versions[0]!.id}/files/${originalPdf.id}/download`,
    'template-admin'
  );
  const link = (await linkResponse.json()) as { url: string };
  expect(Buffer.from(await (await fetch(link.url)).arrayBuffer())).toEqual(firstPdf);

  // A new version reads retained bytes, rather than trusting old extraction metadata.
  await http.pool.query("UPDATE document_template_files SET placeholders='[]'::jsonb WHERE id=$1", [
    originalDocx.id,
  ]);

  const replacement = await pdf('Revised contract {{contractNumber}} on {{date}}.');
  const secondResponse = await request(
    `/${created.id}/versions`,
    'template-admin',
    'POST',
    versionForm([originalDocx.id], [{ name: 'terms.pdf', mime: PDF_MIME, bytes: replacement }])
  );
  expect(secondResponse.status, await secondResponse.clone().text()).toBe(201);
  const second = (await secondResponse.json()) as typeof first;
  expect(second.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
  expect(second.versions[0]!.placeholders).toEqual(['contractNumber', 'customerName', 'date']);
  expect(second.versions[0]!.files.map((file) => file.originalName)).toEqual([
    'terms.docx',
    'terms.pdf',
  ]);
  expect(second.versions[1]!.files.find((file) => file.id === originalPdf.id)).toBeDefined();
  const retainedDocx = second.versions[0]!.files.find(
    (file) => file.originalName === 'terms.docx'
  )!;
  const thirdResponse = await request(
    `/${created.id}/versions`,
    'template-admin',
    'POST',
    versionForm([retainedDocx.id], [])
  );
  expect(thirdResponse.status, await thirdResponse.clone().text()).toBe(201);
  const third = (await thirdResponse.json()) as typeof first;
  expect(third.versions.map((version) => version.versionNumber)).toEqual([3, 2, 1]);
  expect(third.versions[0]).toMatchObject({
    placeholders: ['customerName', 'date'],
    missingRequired: ['contractNumber'],
    conflicts: [],
  });
  const updateResponse = await request(`/${created.id}`, 'template-admin', 'PUT', {
    title: 'Revised customer agreement',
    description: 'Current staff form',
    category: 'contract',
  });
  expect(updateResponse.status).toBe(200);
  expect((await updateResponse.json()) as { title: string }).toMatchObject({
    title: 'Revised customer agreement',
  });
  const filtered = await request('?search=Revised&category=contract', 'template-admin');
  expect(((await filtered.json()) as Array<{ id: string }>).map((row) => row.id)).toContain(
    created.id
  );
  expect(
    (
      await request(
        `/${created.id}/versions`,
        'template-admin',
        'POST',
        versionForm([originalPdf.id], [])
      )
    ).status
  ).toBe(409);
  expect(
    (
      await request(
        `/${created.id}/versions`,
        'template-admin',
        'POST',
        versionForm([], [{ name: 'bad.docx', mime: DOCX_MIME, bytes: Buffer.from('not a zip') }])
      )
    ).status
  ).toBe(400);
  const audit = await http.pool.query<{ event: string }>(
    `SELECT event FROM audit_log WHERE metadata::jsonb->>'templateId'=$1 ORDER BY created_at`,
    [created.id]
  );
  expect(audit.rows.map((row) => row.event).sort()).toEqual(
    [
      'document_template_created',
      'document_template_updated',
      'document_template_version_created',
      'document_template_version_created',
      'document_template_version_created',
    ].sort()
  );
});
