import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { putDocumentFile } from './documents.js';
import { UploadXHR } from '../test/upload-progress-fixture.js';
const file = new File(['abcdefg'], 'proof.pdf', { type: 'application/pdf' });
const upload = { presignedUrl: 'https://storage.test/proof', headers: { 'If-None-Match': '*' } };
beforeEach(() => {
  UploadXHR.instances = [];
  vi.stubGlobal('XMLHttpRequest', UploadXHR);
});
afterEach(() => vi.unstubAllGlobals());
it('reports transferred bytes with only signed storage headers and no credentials', async () => {
  const progress = vi.fn(),
    task = putDocumentFile(upload, file, new AbortController().signal, progress);
  const xhr = UploadXHR.instances[0]!;
  expect(xhr.method).toBe('PUT');
  expect(xhr.withCredentials).toBe(false);
  expect(xhr.headers).toEqual({ 'If-None-Match': '*' });
  expect(xhr.body).toBe(file);
  xhr.progress(3);
  xhr.progress(99);
  xhr.complete();
  await task;
  expect(progress.mock.calls).toEqual([
    [0, 7],
    [3, 7],
    [7, 7],
    [7, 7],
  ]);
});
it('accepts a write-once direct upload replay without treating it as verified document completion', async () => {
  const progress = vi.fn(),
    task = putDocumentFile(upload, file, new AbortController().signal, progress);
  UploadXHR.instances[0]!.complete(412);
  await task;
  expect(progress).toHaveBeenLastCalledWith(7, 7);
});
it('aborts the active transfer and removes progress listeners', async () => {
  const controller = new AbortController(),
    progress = vi.fn(),
    task = putDocumentFile(upload, file, controller.signal, progress);
  controller.abort();
  await expect(task).rejects.toMatchObject({ name: 'AbortError' });
  const xhr = UploadXHR.instances[0]!;
  expect(xhr.aborted).toBe(true);
  expect(xhr.upload.onprogress).toBeNull();
  xhr.progress(7);
  expect(progress).toHaveBeenCalledTimes(1);
});
it('does not start an already abandoned transfer', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(putDocumentFile(upload, file, controller.signal, vi.fn())).rejects.toMatchObject({
    name: 'AbortError',
  });
  expect(UploadXHR.instances).toHaveLength(0);
});
it.each([403, 503])(
  'keeps a storage %s failure separate from account authorization',
  async (status) => {
    const task = putDocumentFile(upload, file, new AbortController().signal, vi.fn());
    UploadXHR.instances[0]!.complete(status);
    await expect(task).rejects.toMatchObject({ status, message: 'Storage upload failed' });
  }
);
it('uses credential-free fetch for a same-origin storage URL', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 200 })),
    progress = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const url = new URL('/signed-file', window.location.origin).href;
  await putDocumentFile(
    { ...upload, presignedUrl: url },
    file,
    new AbortController().signal,
    progress
  );
  expect(UploadXHR.instances).toHaveLength(0);
  expect(fetcher).toHaveBeenCalledWith(url, expect.objectContaining({ credentials: 'omit' }));
  expect(progress.mock.calls).toEqual([
    [0, 7],
    [7, 7],
  ]);
});
it('counts only valid persisted multipart bytes and resumes missing parts with aggregate progress', async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith('/parts')
      ? Response.json({
          status: 'in_progress',
          parts: [
            { partNumber: 1, size: 4 },
            { partNumber: 1, size: 4 },
            { partNumber: 2, size: 99 },
          ],
        })
      : url.includes('/part?')
        ? Response.json({ url: 'https://storage.test/part-2' })
        : Response.json({ status: 'completed' })
  );
  vi.stubGlobal('fetch', fetcher);
  const progress = vi.fn();
  const task = putDocumentFile(
    { uploadId: 'upload', partSize: 4, partCount: 2 },
    file,
    new AbortController().signal,
    progress
  );
  await vi.waitFor(() => expect(UploadXHR.instances).toHaveLength(1));
  const xhr = UploadXHR.instances[0]!;
  expect(xhr.body?.size).toBe(3);
  xhr.progress(2);
  xhr.complete();
  await task;
  expect(progress.mock.calls).toEqual([
    [4, 7],
    [4, 7],
    [6, 7],
    [7, 7],
  ]);
  expect(fetcher.mock.calls.filter(([url]) => url.includes('partNumber=1'))).toHaveLength(0);
  expect(fetcher).toHaveBeenLastCalledWith(
    '/api/v1/files/upload/upload/complete',
    expect.objectContaining({ method: 'POST' })
  );
});
it('reports already completed multipart state without replaying parts', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ status: 'completed', parts: [] }))
  );
  const progress = vi.fn();
  await putDocumentFile(
    { uploadId: 'upload', partSize: 4, partCount: 2 },
    file,
    new AbortController().signal,
    progress
  );
  expect(progress).toHaveBeenCalledWith(7, 7);
  expect(UploadXHR.instances).toHaveLength(0);
});
it('rejects an inconsistent multipart layout before signing or transferring parts', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(
    putDocumentFile(
      { uploadId: 'upload', partSize: 4, partCount: 200 },
      file,
      new AbortController().signal,
      vi.fn()
    )
  ).rejects.toMatchObject({ status: 502 });
  expect(fetcher).not.toHaveBeenCalled();
});
