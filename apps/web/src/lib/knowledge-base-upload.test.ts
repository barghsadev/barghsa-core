import { afterEach, expect, it, vi } from 'vitest';
import { uploadKnowledgeDocument } from './knowledge-base-upload.js';
const key = 'uploads/document/guide.pdf';
afterEach(() => vi.unstubAllGlobals());
function fixture(
  verified: unknown = { key, status: 'confirmed', exists: true },
  recorded: unknown = { key, status: 'recorded' }
) {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ key, presignedUrl: 'https://storage.example.test/guide' })
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(Response.json(verified))
    .mockResolvedValueOnce(Response.json(recorded));
  vi.stubGlobal('fetch', request);
  return request;
}
it('sends only file bytes to storage and checks verification/record identity before attachment', async () => {
  document.cookie = 'barghsa_csrf=fixture-csrf';
  const request = fixture();
  expect(
    await uploadKnowledgeDocument(
      new File(['%PDF'], 'guide.pdf', { type: '' }),
      new AbortController().signal
    )
  ).toBe(key);
  expect(JSON.parse(request.mock.calls[0]![1].body)).toMatchObject({
    contentType: 'application/pdf',
    category: 'document',
  });
  expect(request.mock.calls[1]![1].credentials).toBe('omit');
  expect(new Headers(request.mock.calls[1]![1].headers).get('X-CSRF-Token')).toBeNull();
  for (const i of [0, 2, 3])
    expect(new Headers(request.mock.calls[i]![1].headers).get('X-CSRF-Token')).toBe('fixture-csrf');
  expect(JSON.parse(request.mock.calls[3]![1].body)).toMatchObject({ purpose: 'knowledge_base' });
  expect(JSON.parse(request.mock.calls[3]![1].body)).not.toHaveProperty('profileId');
});
for (const verified of [
  { key, status: 'pending_scan', exists: true },
  { key: 'other', status: 'confirmed', exists: true },
  { key, status: 'confirmed', exists: false },
]) {
  it(`refuses unverified or mismatched uploaded bytes ${JSON.stringify(verified)}`, async () => {
    const request = fixture(verified);
    await expect(
      uploadKnowledgeDocument(new File(['%PDF'], 'guide.pdf'), new AbortController().signal)
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
  });
}
for (const recorded of [
  { key: 'other', status: 'recorded' },
  { key, status: 'pending' },
]) {
  it(`refuses an unconfirmed saved record ${JSON.stringify(recorded)}`, async () => {
    fixture(undefined, recorded);
    await expect(
      uploadKnowledgeDocument(new File(['%PDF'], 'guide.pdf'), new AbortController().signal)
    ).rejects.toThrow();
  });
}
it('rejects unsupported or empty files before reserving storage', async () => {
  const request = fixture();
  for (const file of [new File(['x'], 'x.exe'), new File([], 'empty.pdf')])
    await expect(uploadKnowledgeDocument(file, new AbortController().signal)).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
