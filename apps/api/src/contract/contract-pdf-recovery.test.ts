import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { beforeEach, expect, it, vi } from 'vitest';
import { StorageObjectNotFound } from '@barghsa/shared/storage';
import type { AuthenticatedRequest } from '../session/session.guard.js';
import { ContractPdfService } from './contract-pdf.service.js';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('@barghsa/db', async (load) => ({
  ...(await load<typeof import('@barghsa/db')>()),
  getDbPool: () => db,
}));
const bytes = Buffer.from('%PDF-1.7 immutable electricity terms');
const renderPdf = vi.hoisted(() => vi.fn());
vi.mock('./contract-pdf.js', () => ({ renderContractPdf: renderPdf }));

const contractId = randomUUID();
const versionId = randomUUID();
const idempotencyKey = randomUUID();
const documentId = randomUUID();
const uploadKey = 'uploads/contract/generated.pdf';
const request = {
  session: { userId: 'fixture-staff', sessionId: randomUUID(), csrfToken: randomUUID() },
} as AuthenticatedRequest;
const version = {
  contract_number: '801',
  version_number: 2,
  profile_id: randomUUID(),
  service_type: 'electricity',
  content: { template: { name: 'Electricity terms', text: 'Saved agreement' } },
  created_at: new Date('2026-11-14T10:00:00Z'),
  amendment_state: null,
};
function make() {
  const documents = {
    get: vi.fn().mockResolvedValue({ id: documentId, state: 'Uploading', revision: 1 }),
    create: vi.fn().mockResolvedValue({ document: { id: documentId }, upload: { key: uploadKey } }),
    confirm: vi.fn().mockResolvedValue({ id: documentId, state: 'Available', revision: 2 }),
    act: vi.fn().mockResolvedValue({ id: documentId, state: 'SubmittedForReview', revision: 3 }),
  };
  const storage = {
    getObject: vi.fn().mockRejectedValue(new StorageObjectNotFound(uploadKey)),
    putObject: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ContractPdfService(documents as never, storage as never);
  return {
    documents,
    storage,
    generate: () => service.generate(contractId, versionId, idempotencyKey, request),
  };
}
beforeEach(() => {
  renderPdf.mockReset().mockResolvedValue(bytes);
  db.query
    .mockReset()
    .mockResolvedValueOnce({ rows: [version] })
    .mockResolvedValueOnce({ rows: [] });
});

it.each([
  null,
  [],
  { template: 'old text' },
  { template: [] },
  { template: { name: 'Terms', text: ' ' } },
])('rejects a missing saved template before storage or document creation (%j)', async (content) => {
  db.query.mockReset().mockResolvedValue({ rows: [{ ...version, content }] });
  const f = make();
  await expect(f.generate()).rejects.toMatchObject({ status: 409 });
  expect(renderPdf).not.toHaveBeenCalled();
  expect(f.documents.create).not.toHaveBeenCalled();
  expect(f.storage.putObject).not.toHaveBeenCalled();
});
it('rejects absent versions and non-electricity terms without reading objects', async () => {
  const f = make();
  db.query.mockReset().mockResolvedValueOnce({ rows: [] });
  await expect(f.generate()).rejects.toMatchObject({ status: 404 });
  db.query.mockResolvedValueOnce({ rows: [{ ...version, service_type: 'savings' }] });
  await expect(f.generate()).rejects.toMatchObject({ status: 409 });
  expect(f.storage.getObject).not.toHaveBeenCalled();
  expect(f.documents.create).not.toHaveBeenCalled();
});

it.each(['SubmittedForReview', 'Approved'])(
  'returns a durable %s result without reconfirming a previous upload',
  async (state) => {
    const f = make();
    const saved = { id: documentId, state, revision: 3 };
    f.documents.get.mockResolvedValue(saved);
    await expect(f.generate()).resolves.toEqual(saved);
    expect(f.storage.getObject).not.toHaveBeenCalled();
    expect(f.documents.confirm).not.toHaveBeenCalled();
    expect(f.documents.act).not.toHaveBeenCalled();
  }
);

it('submits an available PDF with its current revision and rejects terminal states', async () => {
  const f = make();
  f.documents.get.mockResolvedValue({ id: documentId, state: 'Available', revision: 4 });
  await expect(f.generate()).resolves.toMatchObject({
    id: documentId,
    state: 'SubmittedForReview',
  });
  expect(f.documents.act).toHaveBeenCalledExactlyOnceWith(
    documentId,
    'submit',
    { expectedRevision: 4, idempotencyKey },
    request.session,
    true,
    ''
  );
  db.query.mockResolvedValueOnce({ rows: [version] }).mockResolvedValueOnce({ rows: [] });
  f.documents.get.mockResolvedValue({ id: documentId, state: 'Quarantined', revision: 5 });
  await expect(f.generate()).rejects.toMatchObject({ status: 409 });
  expect(f.storage.getObject).not.toHaveBeenCalled();
  expect(f.documents.confirm).not.toHaveBeenCalled();
  expect(f.documents.act).toHaveBeenCalledTimes(1);
});

it('resumes an identical stored upload without replacing bytes or skipping the scan', async () => {
  const f = make();
  f.storage.getObject.mockResolvedValue({ body: Readable.from([bytes]) });
  const pending = { id: documentId, state: 'PendingScan', revision: 2 };
  f.documents.confirm.mockResolvedValue(pending);
  await expect(f.generate()).resolves.toEqual(pending);
  expect(f.storage.putObject).not.toHaveBeenCalled();
  expect(f.documents.confirm).toHaveBeenCalledExactlyOnceWith(
    documentId,
    { expectedRevision: 1, idempotencyKey },
    request,
    true,
    ''
  );
  expect(f.documents.act).not.toHaveBeenCalled();
});

it.each([Buffer.from('changed terms'), Buffer.concat([bytes, Buffer.from('extra bytes')])])(
  'refuses mismatched or truncated stored bytes before confirmation',
  async (stored) => {
    const f = make();
    f.storage.getObject.mockResolvedValue({ body: Readable.from([stored]) });
    await expect(f.generate()).rejects.toMatchObject({ status: 409 });
    expect(f.storage.putObject).not.toHaveBeenCalled();
    expect(f.documents.confirm).not.toHaveBeenCalled();
  }
);

it('surfaces an uncertain read and writes only after a definite missing-object response', async () => {
  const f = make();
  const failure = new Error('Storage read unavailable');
  f.storage.getObject.mockRejectedValueOnce(failure);
  await expect(f.generate()).rejects.toBe(failure);
  expect(f.storage.putObject).not.toHaveBeenCalled();
  expect(f.documents.confirm).not.toHaveBeenCalled();
  db.query.mockResolvedValueOnce({ rows: [version] }).mockResolvedValueOnce({ rows: [] });
  await expect(f.generate()).resolves.toMatchObject({ state: 'SubmittedForReview' });
  expect(f.storage.putObject).toHaveBeenCalledExactlyOnceWith(uploadKey, bytes, 'application/pdf');
  expect(f.documents.act).toHaveBeenCalledExactlyOnceWith(
    documentId,
    'submit',
    { expectedRevision: 2, idempotencyKey },
    request.session,
    true,
    ''
  );
});
