import { afterEach, expect, it, vi } from 'vitest';
import { selectedPdfPreview, MAX_PDF_PREVIEW_BYTES } from './file-preview.js';
const file = new File(['%PDF-1.7\nselected bytes'], 'proof.pdf');
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'barghsa_csrf=; Max-Age=0; path=/';
});
it('uses current CSRF with exact selected bytes and accepts only a PNG response', async () => {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(signature, { headers: { 'Content-Type': 'image/png' } }));
  vi.stubGlobal('fetch', fetcher);
  document.cookie = 'barghsa_csrf=preview-token; path=/';
  const signal = new AbortController().signal;
  const blob = await selectedPdfPreview(file, signal);
  expect(blob.type).toBe('image/png');
  const [path, options] = fetcher.mock.calls[0]!;
  expect(path).toBe('/api/upload/preview');
  expect(options).toMatchObject({
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  expect(options.headers.get('X-CSRF-Token')).toBe('preview-token');
  expect(options.headers.get('Content-Type')).toBe('application/pdf');
  expect(options.body.size).toBe(file.size);
  expect(options.body.type).toBe('application/pdf');
});
it.each([0, MAX_PDF_PREVIEW_BYTES + 1])(
  'does not transfer an empty or oversized PDF (%s bytes)',
  async (size) => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const oversized = new File(['x'], 'large.pdf');
    Object.defineProperty(oversized, 'size', { value: size });
    await expect(selectedPdfPreview(oversized, new AbortController().signal)).rejects.toMatchObject(
      { status: 413 }
    );
    expect(fetcher).not.toHaveBeenCalled();
  }
);
it.each(['application/pdf', 'text/html', 'image/png'])(
  'rejects incorrect or corrupted derivative content (%s)',
  async (contentType) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<script>invalid image</script>', {
          headers: { 'Content-Type': contentType },
        })
      )
    );
    await expect(selectedPdfPreview(file, new AbortController().signal)).rejects.toMatchObject({
      status: 502,
    });
  }
);
