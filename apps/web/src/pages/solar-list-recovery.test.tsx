import { QueryComponentProvider } from '../test/query-provider.js';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminSolarDocumentsPage as Documents } from './AdminSolarDocumentsPage.js';
import { AdminSolarPostalPage as Postal } from './AdminSolarPostalPage.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { solarPostalQueryOptions } from '../lib/solar-staff-query.js';
import {
  firstSolar,
  olderSolar,
  solarRequest,
  solarFile,
  solarDocuments,
  solarPostal,
  solarGuidance,
} from '../test/solar-staff-fixtures.js';

vi.mock('../components/DocumentDetail.js', () => ({
  DocumentDetail: ({ id }: { id: string }) => <div data-testid="preview">{id}</div>,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});
const cases = [
  {
    name: 'files',
    Page: Documents,
    base: '/api/admin/solar/document-review-queue',
    key: 'documents',
    row: solarFile,
    slot: 0,
    more: 'More files',
  },
  {
    name: 'requests',
    Page: Documents,
    base: '/api/admin/solar/requests',
    key: 'requests',
    row: solarRequest,
    slot: 1,
    more: 'More requests',
  },
  {
    name: 'postal',
    Page: Postal,
    base: '/api/admin/solar/postal-queue',
    key: 'requests',
    row: solarPostal,
    slot: 0,
    more: 'More requests',
  },
];
function button(container: ParentNode, label: string) {
  const found = Array.from(container.querySelectorAll('button')).find((item) =>
    item.textContent?.includes(label)
  );
  expect(found, label).toBeDefined();
  return found!;
}
function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function mount(Page: () => ReturnType<typeof Documents>) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(<QueryComponentProvider>{<Page />}</QueryComponentProvider>));
  return {
    container,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
function defaultData(url: string) {
  if (url.endsWith('/settings/timezone')) return { timezone: 'UTC' };
  if (url.includes('guidance')) return solarGuidance;
  if (url.endsWith('/documents'))
    return solarDocuments(url.includes(olderSolar) ? olderSolar : firstSolar);
  if (url.includes('document-review-queue')) return { documents: [solarFile()], nextBefore: null };
  return {
    requests: [url.includes('postal-queue') ? solarPostal() : solarRequest()],
    nextBefore: null,
  };
}
for (const { name, Page, base, key, row, slot, more } of cases)
  for (const deniedStatus of [401, 403]) {
    it(`${name}: exact page retry preserves selected review, guidance and sibling resources; ${deniedStatus} removes stale work`, async () => {
      let status = 503;
      const queries: string[] = [],
        otherReads: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          const parsed = new URL(url, 'http://localhost');
          if (parsed.pathname !== base) {
            otherReads.push(url);
            return Response.json(defaultData(url));
          }
          queries.push(url);
          if (parsed.searchParams.has('before') && status !== 200)
            return new Response('{}', { status });
          const next = parsed.searchParams.has('before');
          return Response.json({
            [key]: [row(next ? olderSolar : firstSolar)],
            nextBefore: next ? olderSolar : firstSolar,
          });
        })
      );
      const { container, close } = await mount(Page);
      try {
        await act(async () =>
          button(container, name === 'files' ? 'first.pdf' : 'First solar buyer').click()
        );
        const input =
          name === 'postal'
            ? container.querySelector<HTMLTextAreaElement>('section textarea')!
            : container.querySelector<HTMLInputElement>('#solar-review-reason')!;
        const guidance = container.querySelector<HTMLTextAreaElement>('form textarea')!;
        await act(async () => {
          fill(input, 'Keep this explanation');
          fill(guidance, 'Keep this guidance draft');
        });
        if (name !== 'postal') {
          expect(container.textContent).toContain('Awaiting review');
          expect(container.textContent).toContain('Pending staff review');
          expect(container.textContent).not.toContain('documents_under_review');
          expect(container.textContent).not.toContain('SubmittedForReview');
        }
        const otherCount = otherReads.length;
        await act(async () => button(container, more).click());
        const content = container.querySelectorAll('[data-slot="list-content"]')[slot]!;
        expect(content.querySelector('[role="alert"]')).not.toBeNull();
        const failed = queries.at(-1);
        status = 200;
        await act(async () => button(content, 'Try again').click());
        expect(queries.at(-1)).toBe(failed);
        expect(content.textContent).toContain(name === 'files' ? 'older.pdf' : 'Older solar buyer');
        expect(input.value).toBe('Keep this explanation');
        expect(guidance.value).toBe('Keep this guidance draft');
        expect(otherReads).toHaveLength(otherCount);
        if (name === 'files')
          expect(container.querySelector('[data-testid="preview"]')?.textContent).toBe(firstSolar);
        status = deniedStatus;
        await act(async () => button(container, more).click());
        expect(content.querySelector('button')).toBeNull();
        expect(container.querySelector('#solar-review-reason')).toBeNull();
        expect(container.querySelector('section textarea')).toBeNull();
        expect(container.querySelector('[data-testid="preview"]')).toBeNull();
        expect(guidance.value).toBe('Keep this guidance draft');
      } finally {
        await close();
      }
    });
  }
it('document detail failure leaves both queues available and retries only the selected documents', async () => {
  let fail = true;
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return url.endsWith('/documents') && fail
        ? new Response('{}', { status: 503 })
        : Response.json(defaultData(url));
    })
  );
  const { container, close } = await mount(Documents);
  try {
    await act(async () => button(container, 'First solar buyer').click());
    expect(container.textContent).toContain('Could not load this request’s documents.');
    await act(async () => button(container, 'First solar buyer').click());
    expect(container.textContent).toContain('Could not load this request’s documents.');
    for (const content of container.querySelectorAll('[data-slot="list-content"]'))
      expect(content.querySelector('[role="alert"]')).toBeNull();
    const reads = calls.length;
    fail = false;
    await act(async () => button(container, 'Try again').click());
    expect(calls.slice(reads)).toEqual([`/api/admin/solar/requests/${firstSolar}/documents`]);
    expect(container.querySelector('#solar-review-reason')).not.toBeNull();
  } finally {
    await close();
  }
});
for (const Page of [Documents, Postal]) {
  it(`${Page.name}: guidance failure and retry do not reload the queue or erase the selected review draft`, async () => {
    let fail = true;
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return url.includes('guidance') && fail
          ? new Response('{}', { status: 503 })
          : Response.json(defaultData(url));
      })
    );
    const { container, close } = await mount(Page);
    try {
      await act(async () => button(container, 'First solar buyer').click());
      const input =
        Page === Postal
          ? container.querySelector<HTMLTextAreaElement>('section textarea')!
          : container.querySelector<HTMLInputElement>('#solar-review-reason')!;
      await act(async () => fill(input, 'Preserve note'));
      const reads = calls.length;
      fail = false;
      await act(async () => button(container, 'Try again').click());
      expect(calls.slice(reads)).toEqual([
        `/api/admin/solar/${Page === Postal ? 'postal' : 'document'}-guidance`,
      ]);
      expect(input.value).toBe('Preserve note');
      expect(container.querySelector('form')).not.toBeNull();
    } finally {
      await close();
    }
  });
}
it('successful guidance save clears its owned validation error', async () => {
  const writes: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'PUT') writes.push(url);
      return Response.json(defaultData(url));
    })
  );
  const { container, close } = await mount(Documents);
  try {
    const form = container.querySelector('form')!;
    const input = form.querySelector('textarea')!;
    await act(async () => fill(input, ''));
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    await act(async () => fill(input, solarGuidance.fa));
    await act(async () =>
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    );
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    await act(async () => button(document, 'Confirm').click());
    expect(writes).toEqual(['/api/admin/solar/document-guidance']);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await close();
  }
});
for (const kind of ['document-set', 'postal', 'final'] as const) {
  it(`discards a delayed ${kind} decision review after selecting another request`, async () => {
    let finish: ((response: Response) => void) | undefined;
    const writes: string[] = [];
    let restoreLane: (() => void) | undefined;
    function PostalRoute() {
      const [search, setSearch] = useState<Record<string, unknown>>({});
      restoreLane = () => setSearch({ lane: 'all' });
      const queries = useListQuery(solarPostalQueryOptions, search, (update) =>
        setSearch((current) => update(current))
      );
      return <Postal queries={queries} />;
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith('/review') || url.endsWith('/review-set-decision'))
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        if (init?.method === 'POST') writes.push(url);
        const data = defaultData(url);
        if (url.includes('postal-queue'))
          return Response.json({
            requests: [
              solarPostal(),
              {
                ...solarPostal(olderSolar),
                request_status: kind === 'final' ? 'final_review' : 'waiting_for_postal_submission',
              },
            ].map((item) =>
              kind === 'final'
                ? { ...item, request_status: 'final_review', postal_status: 'received' }
                : item
            ),
            nextBefore: null,
          });
        if (new URL(url, 'http://localhost').pathname === '/api/admin/solar/requests')
          return Response.json({
            requests: [solarRequest(), solarRequest(olderSolar)],
            nextBefore: null,
          });
        return Response.json(data);
      })
    );
    const { container, close } = await mount(kind === 'document-set' ? Documents : PostalRoute);
    try {
      await act(async () => button(container, 'First solar buyer').click());
      await act(async () =>
        button(
          container,
          kind === 'document-set'
            ? 'advance to postal stage'
            : kind === 'postal'
              ? 'Confirm receipt'
              : 'Approve request'
        ).click()
      );
      expect(finish).toBeDefined();
      await act(async () => button(container, 'Older solar buyer').click());
      if (kind !== 'document-set') {
        expect(button(container, 'First solar buyer').classList.contains('border-primary')).toBe(
          true
        );
        expect(button(container, 'Older solar buyer').classList.contains('border-primary')).toBe(
          false
        );
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        // A restored route scope cancels the read-only preparation before another row is chosen.
        await act(async () => restoreLane!());
        await act(async () => button(container, 'Older solar buyer').click());
        expect(button(container, 'Older solar buyer').classList.contains('border-primary')).toBe(
          true
        );
      }
      await act(async () =>
        finish!(
          Response.json({
            hash: 'a'.repeat(64),
            data: {
              requestId: firstSolar,
              currentStatus: 'final_review',
              currentRequestStatus: 'waiting_for_postal_submission',
              currentPostalStatus: 'shipped',
              documents: [],
              existingRequests: [],
              description: null,
              nextStatus: 'waiting_for_postal_submission',
              outcome: 'approved',
              postalStatus: 'received',
              trackingNumber: null,
              courier: null,
              sendDate: null,
              receiptImageId: null,
              reason: null,
              postalOutcome: 'received',
              requestOutcome: 'postal_documents_received',
            },
          })
        )
      );
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      if (kind !== 'document-set') {
        expect(button(container, 'Older solar buyer').classList.contains('border-primary')).toBe(
          true
        );
        expect(writes).toEqual([]);
      }
    } finally {
      await close();
    }
  });
}
