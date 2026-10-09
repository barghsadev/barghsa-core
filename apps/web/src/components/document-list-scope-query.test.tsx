import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DocumentResults, type DocumentFilters } from './DocumentsWorkspace.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ format: String, notice: null }),
}));
it('preserves the normalized document reader across reordered and whitespace-equivalent filters', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({ documents: [], nextBefore: null })
  );
  vi.stubGlobal('fetch', fetcher);
  const filters: DocumentFilters = {
    kind: 'standalone',
    state: 'SubmittedForReview',
    category: 'document',
    query: 'Review',
    profileId: '',
    businessRecordId: '',
  };
  const render = async (value: DocumentFilters) =>
    act(async () =>
      root.render(
        <QueryComponentProvider>
          <DocumentResults staff profileId="profile-1" filters={value} />
        </QueryComponentProvider>
      )
    );
  try {
    await render(filters);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const path = String(fetcher.mock.calls[0]![0]);
    await render({
      businessRecordId: '',
      profileId: '',
      query: '  Review  ',
      category: 'document',
      state: 'SubmittedForReview',
      kind: 'standalone',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain('Loading');
    expect(new URL(path, 'http://local').searchParams.get('q')).toBe('Review');
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
