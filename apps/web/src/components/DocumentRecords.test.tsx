import { QueryComponentProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { documentText } from '@barghsa/i18n/documents';
import { DocumentRecords } from './DocumentRecords.js';
import { DocumentStatusBadge } from './DocumentStatusBadge.js';
import { documentRow } from '../test/document-list-fixtures.js';
import { documentStates, type BusinessDocument } from '../lib/documents.js';
import type { ListView } from '@barghsa/ui';
vi.mock('../hooks/useNumberFormatting.js', () => ({
  useNumberFormatting: (locale: string) => ({
    number: (value: number, options: Intl.NumberFormatOptions) =>
      new Intl.NumberFormat(locale === 'fa' ? 'fa-IR' : 'en-US', options).format(value),
  }),
}));
const actionHarness = vi.hoisted(() => ({
  action: null as import('./TeamActionDialog.js').TeamAction | null,
}));
vi.mock('./TeamActionDialog.js', () => ({
  TeamActionDialog: ({
    action,
    onSuccess,
    onClose,
  }: {
    action: import('./TeamActionDialog.js').TeamAction;
    onSuccess: () => Promise<void>;
    onClose: () => void;
  }) => {
    actionHarness.action = action;
    return (
      <div role="dialog">
        <button onClick={() => void onSuccess()}>Confirm removal</button>
        <button onClick={onClose}>Cancel removal</button>
      </div>
    );
  },
}));
const onReplace = vi.fn(),
  onChanged = vi.fn();
let container: HTMLDivElement, root: Root;
const fetcher = vi.fn<typeof fetch>();
const onSelect = vi.fn();
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  fetcher.mockReset();
  onSelect.mockReset();
  onReplace.mockReset();
  onChanged.mockReset();
  actionHarness.action = null;
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(
  items: BusinessDocument[] = [documentRow],
  view: ListView = 'table',
  staff = false,
  locale: 'en' | 'fa' = 'en'
) {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {
          <DocumentRecords
            items={items}
            view={view}
            staff={staff}
            locale={locale}
            selectedId={documentRow.id}
            onSelect={onSelect}
            onReplace={onReplace}
            onChanged={onChanged}
            formatDate={(value) => `account time: ${value}`}
          />
        }
      </QueryComponentProvider>
    )
  );
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (element) => element.textContent === text
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
}
function deferred() {
  let resolve!: (response: Response) => void;
  return {
    promise: new Promise<Response>((yes) => {
      resolve = yes;
    }),
    resolve: (result: Response) => resolve(result),
  };
}
for (const view of ['table', 'card'] as const)
  for (const locale of ['en', 'fa'] as const)
    it(`shows useful metadata, safe statuses and selection in ${locale} ${view} without fetching file contents`, async () => {
      const items = documentStates.map((state, index) => ({
        ...documentRow,
        id: String(index),
        state,
        originalName: `${state}.pdf`,
        rejectionReason:
          state === 'Rejected' ? '<script>review note</script>' : 'private scanner signature',
      }));
      await render(items, view, false, locale);
      expect(container.textContent).toContain(documentText('quarantinedNotice', locale));
      expect(container.textContent).not.toContain('private scanner signature');
      expect(container.textContent).not.toContain('Removed.pdf');
      expect(container.querySelector('script')).toBeNull();
      expect(container.textContent).toContain('<script>review note</script>');
      expect(container.textContent).toContain('account time: 2026-09-24');
      expect(container.querySelectorAll('time')).toHaveLength(8);
      expect(container.querySelectorAll('button').length).toBeGreaterThan(8);
      await click('Approved.pdf');
      expect(onSelect).toHaveBeenCalledWith('4');
      expect(fetcher).not.toHaveBeenCalled();
      if (view === 'table') expect(container.querySelectorAll('th[scope="col"]')).toHaveLength(6);
      else expect(container.querySelectorAll('dl')).toHaveLength(8);
    });
it('gives all known statuses meaningful badges and handles an unknown status safely', async () => {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        {
          <>
            {[...documentStates, '__proto__'].map((state) => (
              <DocumentStatusBadge
                key={state}
                state={state}
                locale="en"
                reason="private scanner signature"
              />
            ))}
          </>
        }
      </QueryComponentProvider>
    )
  );
  expect(
    container.querySelector('[data-document-state="PendingScan"] svg')?.getAttribute('class')
  ).toContain('motion-safe:animate-pulse');
  expect(
    container.querySelector('[data-document-state="Removed"]')?.getAttribute('class')
  ).toContain('line-through');
  expect(
    container.querySelector('[data-document-state="Quarantined"]')?.getAttribute('title')
  ).not.toContain('private scanner');
  expect(container.querySelector('[data-document-state="unknown"]')?.textContent).toContain(
    'Status unavailable'
  );
  expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(10);
});
it('uses localized rounded sizes and handles missing or unsafe metadata', async () => {
  await render(
    [1048576, 1536, -1, Number.MAX_SAFE_INTEGER + 1].map((sizeBytes, index) => ({
      ...documentRow,
      id: String(index),
      sizeBytes,
    })),
    'card',
    false,
    'fa'
  );
  expect(container.textContent).toContain('۱ مگابایت');
  expect(container.textContent).toContain('۱٫۵ کیلوبایت');
  expect(container.textContent?.match(/ثبت نشده/g)).toHaveLength(2);
});
it('offers a removed file download only to staff and never offers its preview', async () => {
  await render([{ ...documentRow, state: 'Removed' }], 'card', true);
  expect(container.textContent).toContain('Get download link');
  expect(container.textContent).not.toContain('Preview');
});
it('keeps lazy preview and download receipts across layouts and hides without another request', async () => {
  fetcher.mockImplementation(async (input) =>
    response({
      url: String(input).endsWith('/preview')
        ? 'https://files.test/thumbnail.png'
        : 'https://files.test/proof.pdf',
    })
  );
  await render();
  await click('Preview');
  await click('Get download link');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.querySelector('img')?.getAttribute('src')).toContain('thumbnail');
  expect(container.querySelector('a')?.rel).toBe('noopener noreferrer');
  await render([documentRow], 'card');
  expect(container.querySelector('img')).not.toBeNull();
  await click('Hide preview');
  expect(container.querySelector('img')).toBeNull();
  await click('Preview');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.querySelector('img')?.getAttribute('referrerpolicy')).toBe('no-referrer');
});
it('refetches an expired signed link', async () => {
  const now = Date.now();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  fetcher.mockResolvedValue(response({ url: 'https://files.test/first.png' }));
  await render();
  await click('Preview');
  await click('Hide preview');
  vi.spyOn(Date, 'now').mockReturnValue(now + 300001);
  fetcher.mockResolvedValue(response({ url: 'https://files.test/second.png' }));
  await click('Preview');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.querySelector('img')?.getAttribute('src')).toContain('second');
});
it('retries a temporary preview failure and invalid derivative without replaying downloads', async () => {
  fetcher
    .mockResolvedValueOnce(response({}, 503))
    .mockResolvedValueOnce(response({ url: 'https://files.test/preview.png' }))
    .mockResolvedValueOnce(response({ url: 'https://files.test/fresh.png' }));
  await render();
  await click('Preview');
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not open');
  await click('Preview');
  await act(async () => container.querySelector('img')!.dispatchEvent(new Event('error')));
  expect(container.querySelector('img')).toBeNull();
  await click('Preview');
  expect(container.querySelector('img')?.getAttribute('src')).toContain('fresh');
  expect(fetcher).toHaveBeenCalledTimes(3);
});
for (const url of ['javascript:alert(1)', 'https://user:secret@files.test/file'])
  it(`rejects an unsafe file URL ${url.split(':')[0]}`, async () => {
    fetcher.mockResolvedValue(response({ url }));
    await render();
    await click('Preview');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
it('aborts both concurrent accesses on denial so a late download cannot restore a private link', async () => {
  const preview = deferred(),
    download = deferred();
  let downloadSignal: AbortSignal | undefined;
  fetcher.mockImplementation((input, options) => {
    if (String(input).endsWith('/preview')) return preview.promise;
    downloadSignal = options?.signal as AbortSignal;
    return download.promise;
  });
  await render();
  await click('Preview');
  await click('Get download link');
  await act(async () => preview.resolve(response({}, 403)));
  expect(downloadSignal?.aborted).toBe(true);
  await act(async () => download.resolve(response({ url: 'https://files.test/private.pdf' })));
  expect(container.querySelector('a')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('no longer available');
});
it('discards cached links and ignores in-flight responses when a document changes revision or becomes quarantined', async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  fetcher.mockImplementation((_input, options) => {
    signal = options?.signal as AbortSignal;
    return pending.promise;
  });
  await render();
  await click('Preview');
  await render([
    { ...documentRow, revision: 4, state: 'Quarantined', rejectionReason: 'private scanner' },
  ]);
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response({ url: 'https://files.test/private.png' })));
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).not.toContain('private scanner');
  expect(container.textContent).not.toContain('Get download link');
});
it('aborts requests when its parent profile scope unmounts', async () => {
  const pending = deferred();
  let signal: AbortSignal | undefined;
  fetcher.mockImplementation((_input, options) => {
    signal = options?.signal as AbortSignal;
    return pending.promise;
  });
  await render();
  await click('Preview');
  await act(async () => root.render(<QueryComponentProvider>{null}</QueryComponentProvider>));
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(response({ url: 'https://files.test/private.png' })));
  expect(container.innerHTML).toBe('');
});

it('clears other cached document URLs when account authority is denied', async () => {
  const other = { ...documentRow, id: 'other' };
  fetcher.mockImplementation(async (input) =>
    String(input).includes('/other/')
      ? response({}, 401)
      : response({ url: 'https://files.test/cached.pdf' })
  );
  await render([documentRow, other]);
  const buttons = () =>
    [...container.querySelectorAll('button')].filter(
      (element) => element.textContent === 'Get download link'
    );
  await act(async () => buttons()[0]!.click());
  expect(container.querySelector('a')).not.toBeNull();
  await act(async () => buttons()[1]!.click());
  expect(container.querySelector('a')).toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('no longer available');
});

for (const view of ['table', 'card'] as const)
  it(`never reopens quarantined bytes or notes after replacement in ${view}`, async () => {
    await render(
      [
        {
          ...documentRow,
          state: 'Superseded',
          scanState: 'Quarantined',
          rejectionReason: 'private scanner signature',
        },
      ],
      view,
      true
    );
    expect(container.textContent).toContain(documentText('Superseded', 'en'));
    expect(container.textContent).toContain('This file cannot be accepted.');
    expect(container.textContent).not.toContain('private scanner');
    expect(container.textContent).not.toContain('Get download link');
    expect(container.textContent).not.toContain('Preview');
    expect(fetcher).not.toHaveBeenCalled();
  });

for (const view of ['table', 'card'] as const)
  for (const locale of ['en', 'fa'] as const)
    it(`binds inline remove and replace to the accepted ${locale} ${view} record without fetching detail`, async () => {
      const item = {
        ...documentRow,
        state: 'Superseded' as const,
        permissions: { download: true, write: true, remove: true, replace: true },
      };
      await render([item], view, false, locale);
      await click(documentText('replace', locale));
      expect(onReplace).toHaveBeenCalledWith(item);
      await click(documentText('remove', locale));
      const proposal = actionHarness.action;
      expect(proposal).toMatchObject({
        path: `/api/documents/${item.id}/remove`,
        method: 'POST',
        body: { expectedRevision: item.revision, idempotencyKey: expect.any(String) },
      });
      expect(fetcher).not.toHaveBeenCalled();
      await render([item], view === 'table' ? 'card' : 'table', false, locale);
      expect(container.querySelector('[role=dialog]')).not.toBeNull();
      expect(actionHarness.action).toBe(proposal);
      await click('Confirm removal');
      expect(onChanged).toHaveBeenCalledOnce();
      expect(container.querySelector('[role=dialog]')).toBeNull();
    });
it.each(['revoked', 'revised', 'removed'] as const)(
  'invalidates a removal proposal when its row is %s',
  async (change) => {
    const item = {
      ...documentRow,
      permissions: { download: true, write: true, remove: true, replace: true },
    };
    await render([item]);
    await click(documentText('remove', 'en'));
    await render(
      change === 'removed'
        ? []
        : [
            change === 'revoked'
              ? { ...item, permissions: { ...item.permissions, remove: false } }
              : { ...item, revision: item.revision + 1 },
          ]
    );
    expect(container.querySelector('[role=dialog]')).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
    await render([item]);
    expect(container.querySelector('[role=dialog]')).toBeNull();
  }
);
it('hides unknown or denied mutation permissions and does not reuse file receipts after permission revocation', async () => {
  await render([documentRow]);
  expect(container.textContent).not.toContain(documentText('remove', 'en'));
  expect(container.textContent).not.toContain(documentText('replace', 'en'));
  const item = {
    ...documentRow,
    permissions: { download: true, write: false, remove: false, replace: false },
  };
  fetcher.mockResolvedValue(response({ url: 'https://storage.test/proof.pdf' }));
  await render([item]);
  await click(documentText('download', 'en'));
  expect(container.querySelector('a')).not.toBeNull();
  await render([{ ...item, permissions: { ...item.permissions, download: false } }]);
  expect(container.querySelector('a')).toBeNull();
  expect(container.textContent).not.toContain(documentText('download', 'en'));
  expect(container.textContent).not.toContain(documentText('preview', 'en'));
});

it('aborts pending file access when removal succeeds and ignores its late receipt', async () => {
  const pending = deferred();
  fetcher.mockReturnValue(pending.promise);
  const item = {
    ...documentRow,
    state: 'Superseded' as const,
    permissions: { download: true, write: true, remove: true, replace: false },
  };
  await render([item]);
  await click(documentText('download', 'en'));
  const signal = fetcher.mock.calls[0]![1]!.signal as AbortSignal;
  await click(documentText('remove', 'en'));
  await click('Confirm removal');
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response({ url: 'https://storage.test/removed.pdf' })));
  expect(container.querySelector('a')).toBeNull();
  expect(onChanged).toHaveBeenCalledWith(item.id);
});
