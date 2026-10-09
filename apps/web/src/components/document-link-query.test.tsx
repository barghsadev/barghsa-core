import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { documentText } from '@barghsa/i18n/documents';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { DocumentDetail } from './DocumentDetail.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', notice: null, format: String }),
}));
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: () => ({ number: String, money: String }),
}));
const doc = {
  id: 'document-1',
  profileId: 'profile-1',
  businessRecordType: 'standalone',
  businessRecordId: null,
  contractVersionId: null,
  contractRole: null,
  category: 'document',
  state: 'Available',
  originalName: 'current.pdf',
  detectedMime: 'application/pdf',
  sizeBytes: 100,
  checksum: 'a'.repeat(64),
  uploadedBy: 'user-1',
  uploadedByType: 'customer',
  supersedesDocumentId: null,
  rejectionReason: null,
  reviewComment: null,
  permissions: { download: true, write: false, remove: false, replace: false },
  revision: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  history: [],
};
let host: HTMLDivElement,
  root: Root,
  link: string,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  signal = undefined;
  finish = undefined;
  let first = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(init?.credentials).toBe('include');
      if (path.endsWith('/' + link)) {
        if (first) {
          first = false;
          signal = init!.signal as AbortSignal;
          return {
            ok: true,
            status: 200,
            json: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          } as Response;
        }
        return Response.json({ url: 'https://files.example.test/current.pdf' });
      }
      expect(path).toMatch(/^\/api\/documents\/document-[12]$/);
      return Response.json({ ...doc, id: path.split('/').at(-1) });
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'account-one', id = 'document-1') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present && (
            <DocumentDetail
              id={id}
              staff={false}
              onClose={() => {}}
              onChanged={() => {}}
              onPrevious={() => {}}
              onReplace={() => {}}
            />
          )}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function click() {
  const button = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === documentText(link, 'en')
  )!;
  expect(button).toBeDefined();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
for (const kind of ['download', 'preview'])
  it.each(['unmount', 'actor', 'profile-context', 'document'])(
    'cancels actual ' + kind + ' JSON on %s without obsolete signed URLs or writes',
    async (change) => {
      link = kind;
      await render();
      await click();
      await vi.waitFor(() => expect(finish).toBeDefined());
      const oldSignal = signal!,
        oldFinish = finish!;
      expect(oldSignal.aborted).toBe(false);
      const count = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(count);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'account-two');
      else if (change === 'profile-context') await act(async () => refreshProfileContext());
      else await render(true, 'account-one', 'document-2');
      expect(oldSignal.aborted).toBe(true);
      await act(async () => oldFinish({ url: 'https://files.example.test/obsolete-private.pdf' }));
      expect(host.innerHTML).not.toContain('obsolete-private.pdf');
      if (change !== 'unmount' && kind === 'download') {
        await click();
        expect(
          host.querySelector('a[href="https://files.example.test/current.pdf"]')
        ).not.toBeNull();
      }
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
