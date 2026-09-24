import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TeamActionDialog } from './TeamActionDialog.js';

vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: (value: number) => String(value) }),
}));
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  document.cookie = 'barghsa_csrf=test-token';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.cookie = 'barghsa_csrf=; Max-Age=0';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('submits a captured multipart action with CSRF and a browser-generated boundary', async () => {
  const body = new FormData();
  body.set('changeSummary', 'New terms');
  body.append('files', new File(['file'], 'terms.pdf', { type: 'application/pdf' }));
  const fetcher = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'saved' }), { status: 201 })
  );
  vi.stubGlobal('fetch', fetcher);
  const onSuccess = vi.fn(async () => {});
  await act(async () =>
    root.render(
      <TeamActionDialog
        action={{
          title: 'Create version',
          description: 'Save selected files',
          path: '/api/admin/document-templates/example/versions',
          method: 'POST',
          body,
        }}
        onClose={vi.fn()}
        onSuccess={onSuccess}
      />
    )
  );
  const confirm = [...document.body.querySelectorAll('button')].find((item) =>
    item.textContent?.includes('Confirm')
  );
  expect(confirm).toBeDefined();
  await act(async () => confirm!.click());
  const options = fetcher.mock.calls[0]![1]!;
  expect(options.body).toBe(body);
  const headers = options.headers as Headers;
  expect(headers.get('content-type')).toBeNull();
  expect(headers.get('x-csrf-token')).toBe('test-token');
  expect(onSuccess).toHaveBeenCalled();
});
