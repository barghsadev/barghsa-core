import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FilePreview } from './FilePreview.js';
const NativeURL = URL;
const create = vi.fn(),
  revoke = vi.fn();
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  create.mockReset().mockImplementation(() => `blob:http://localhost/${create.mock.calls.length}`);
  revoke.mockReset();
  vi.stubGlobal(
    'URL',
    class extends NativeURL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    }
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
for (const locale of ['en', 'fa'] as const) {
  it(`${locale}: displays verified image derivatives with escaped names and no referrer`, async () => {
    await act(async () =>
      root.render(
        <FilePreview
          name="<script>proof.pdf</script>"
          locale={locale}
          imageUrl="https://storage.example.test/first-page.png"
        />
      )
    );
    const image = host.querySelector('img')!;
    expect(image.src).toBe('https://storage.example.test/first-page.png');
    expect(image.alt).toContain('<script>proof.pdf</script>');
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(host.querySelector('script')).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
}
it.each([
  'javascript:alert(1)',
  'data:image/svg+xml,<svg/>',
  'blob:https://evil.test/file',
  'https://user:secret@storage.example.test/file',
])('rejects untrusted remote source %s', async (imageUrl) => {
  await act(async () => root.render(<FilePreview name="proof" locale="en" imageUrl={imageUrl} />));
  expect(host.querySelector('img,iframe')).toBeNull();
  expect(host.querySelector('[role=img]')).not.toBeNull();
});
it('keeps a document icon after image failure and accepts a fresh authorized source', async () => {
  const error = vi.fn();
  await act(async () =>
    root.render(
      <FilePreview
        name="proof"
        locale="en"
        imageUrl="https://storage.example.test/one"
        onError={error}
      />
    )
  );
  await act(async () => host.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(error).toHaveBeenCalledOnce();
  expect(host.querySelector('img')).toBeNull();
  await act(async () =>
    root.render(
      <FilePreview name="proof" locale="en" imageUrl="https://storage.example.test/two" />
    )
  );
  expect(host.querySelector('img')?.src).toBe('https://storage.example.test/two');
});
it('creates local image URLs only while mounted and revokes obsolete bytes before replacement', async () => {
  const one = new File(['png'], 'one.png', { type: 'image/png' });
  const two = new File(['jpg'], 'two.jpg', { type: 'image/jpeg' });
  await act(async () => root.render(<FilePreview name={one.name} locale="en" file={one} />));
  const old = host.querySelector('img')!.src;
  await act(async () => root.render(<FilePreview name={two.name} locale="en" file={two} />));
  expect(revoke).toHaveBeenCalledWith(old);
  const current = host.querySelector('img')!.src;
  expect(current).not.toBe(old);
  await act(async () => root.render(<></>));
  expect(revoke).toHaveBeenCalledWith(current);
  expect(revoke).toHaveBeenCalledTimes(2);
});
it('renders a bounded first-page image using configured MIME when browser metadata is absent', async () => {
  const file = new File(['%PDF'], 'proof.pdf');
  const fetcher = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
      headers: { 'Content-Type': 'image/png' },
    })
  );
  vi.stubGlobal('fetch', fetcher);
  await act(async () =>
    root.render(
      <FilePreview name={file.name} locale="fa" file={file} contentType="application/pdf" />
    )
  );
  expect((create.mock.calls[0]![0] as Blob).type).toBe('image/png');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]![0]).toBe('/api/upload/preview');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  });
  expect((fetcher.mock.calls[0]![1].body as Blob).type).toBe('application/pdf');
  const image = host.querySelector('img')!;
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(image.alt).toContain(file.name);
  expect(image.src).toMatch(/^blob:/);
  expect(host.querySelector('iframe')).toBeNull();
});

it.each([401, 403, 503])(
  'shows a safe icon for PDF status %s and clears account work only on access denial',
  async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status })));
    const deny = vi.fn();
    await act(async () =>
      root.render(
        <FilePreview
          name="proof.pdf"
          locale="en"
          file={new File(['%PDF'], 'proof.pdf', { type: 'application/pdf' })}
          onAccessDenied={deny}
        />
      )
    );
    expect(host.querySelector('img,iframe')).toBeNull();
    expect(host.querySelector('[role=img]')).not.toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(deny).toHaveBeenCalledTimes(status === 503 ? 0 : 1);
  }
);

it('aborts hidden PDF rendering and never restores an obsolete receipt from a late response', async () => {
  let finish: (response: Response) => void = () => {};
  const fetcher = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', fetcher);
  const file = new File(['%PDF'], 'proof.pdf', { type: 'application/pdf' });
  await act(async () => root.render(<FilePreview name={file.name} locale="en" file={file} />));
  const signal = fetcher.mock.calls[0]![1].signal as AbortSignal;
  await act(async () => root.render(<></>));
  expect(signal.aborted).toBe(true);
  await act(async () =>
    finish(
      new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
        headers: { 'Content-Type': 'image/png' },
      })
    )
  );
  expect(create).not.toHaveBeenCalled();
});
it('does not create executable previews for unknown or SVG local files', async () => {
  const file = new File(['<script>alert(1)</script>'], 'unsafe.svg', { type: 'image/svg+xml' });
  await act(async () => root.render(<FilePreview name={file.name} locale="en" file={file} />));
  expect(create).not.toHaveBeenCalled();
  expect(host.querySelector('img,iframe,script')).toBeNull();
  expect(host.querySelector('[role=img]')).not.toBeNull();
});
