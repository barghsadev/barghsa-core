import { afterEach, expect, it, vi } from 'vitest';
import { documentRequest, documentUrl, putDocumentFile } from './documents.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
});

it('reads the current CSRF cookie while preserving headers and abort signals', async () => {
  document.cookie = 'barghsa_csrf=rotated-token; path=/';
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ documents: [] })));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  await expect(
    documentRequest('/api/documents', {
      headers: new Headers({ 'Accept-Language': 'fa' }),
      signal: controller.signal,
    })
  ).resolves.toEqual({ documents: [] });
  const options = fetcher.mock.calls[0]![1] as RequestInit;
  expect(new Headers(options.headers).get('X-CSRF-Token')).toBe('rotated-token');
  expect(new Headers(options.headers).get('Accept-Language')).toBe('fa');
  expect(options.credentials).toBe('include');
  expect(options.signal).toBe(controller.signal);
});

it.each([
  [403, { error: { code: 'AUTHZ_STEP_UP_REQUIRED' } }, 'AUTHZ_STEP_UP_REQUIRED'],
  [409, { error: 'CONFLICT' }, 'CONFLICT'],
  [500, null, null],
])('keeps request status and safe error identity for %s', async (status, body, code) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
  await expect(documentRequest('/api/documents')).rejects.toMatchObject({ status, code });
});

it('rejects a malformed successful response', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')));
  await expect(documentRequest('/api/documents')).rejects.toMatchObject({ status: 502 });
});

it.each([
  'javascript:alert(1)',
  'data:text/html,test',
  'https://user:secret@example.test/file',
  null,
])('rejects unsafe document links: %s', (url) => expect(() => documentUrl(url)).toThrow());

it('uploads directly to storage with only the signed headers and no session credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const file = new File(['pdf'], 'proof.pdf', { type: 'application/pdf' });
  const upload = {
    presignedUrl: 'https://storage.example.test/file?signature=test',
    headers: { 'Content-Type': 'application/pdf' },
  };
  await putDocumentFile(upload, file, controller.signal);
  expect(fetcher).toHaveBeenCalledWith(upload.presignedUrl, {
    method: 'PUT',
    credentials: 'omit',
    headers: upload.headers,
    body: file,
    signal: controller.signal,
  });
  fetcher.mockResolvedValue(new Response(null, { status: 403 }));
  await expect(putDocumentFile(upload, file, controller.signal)).rejects.toMatchObject({
    status: 403,
  });
  fetcher.mockResolvedValue(new Response(null, { status: 412 }));
  await expect(putDocumentFile(upload, file, controller.signal)).resolves.toBeUndefined();
});
