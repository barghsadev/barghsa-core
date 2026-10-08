import { QueryProvider } from '../test/query-provider.js';
import { act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ContractsWorkspace } from './ContractsWorkspace.js';
import { DocumentsWorkspace } from './DocumentsWorkspace.js';
import { useListQuery, writeListQuery } from '../hooks/useListQuery.js';
import {
  staffContractsSearch,
  staffDocumentsSearch,
  customerDocumentsSearch,
  staffContractQueryOptions,
  staffDocumentQueryOptions,
  customerDocumentQueryOptions,
} from '../lib/record-list-query.js';
import {
  documentRow,
  documentMore,
  documentProfileId,
  documentDetail,
} from '../test/document-list-fixtures.js';
const captured = vi.hoisted(() => ({
  uploaded: null as null | ((document: typeof documentRow) => void),
  selections: [] as (string | null)[],
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({
    format: (value: string) => value,
    timezone: 'UTC',
    status: 'ready',
    notice: null,
  }),
}));
vi.mock('./ContractDraftEditor.js', () => ({ ContractDraftEditor: () => null }));
vi.mock('./ContractActivationRules.js', () => ({ ContractActivationRules: () => null }));
vi.mock('./ContractRefundQueue.js', () => ({ ContractRefundQueue: () => null }));
vi.mock('./ContractCancellationRequestQueue.js', () => ({
  ContractCancellationRequestQueue: () => null,
}));
vi.mock('./DocumentRetentionPolicies.js', () => ({ DocumentRetentionPolicies: () => null }));
vi.mock('./DocumentDestructionQueue.js', () => ({ DocumentDestructionQueue: () => null }));
vi.mock('./ContractDetail.js', () => ({
  ContractDetail: ({ id, onClose }: { id: string; onClose: () => void }) => (
    <section aria-label="Contract detail">
      {id}
      <button onClick={onClose}>Close contract</button>
    </section>
  ),
}));
vi.mock('./DocumentUpload.js', () => ({
  DocumentUpload: ({ onUploaded }: { onUploaded: (document: typeof documentRow) => void }) => {
    captured.uploaded = onUploaded;
    return <input aria-label="Private upload draft" />;
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
  captured.uploaded = null;
  captured.selections = [];
});
const last = '88888888-8888-4888-8888-888888888888';
async function mount(kind: 'contract' | 'staff' | 'customer', initial: Record<string, unknown>) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const parse =
    kind === 'contract'
      ? staffContractsSearch
      : kind === 'staff'
        ? staffDocumentsSearch
        : customerDocumentsSearch;
  const options =
    kind === 'contract'
      ? staffContractQueryOptions
      : kind === 'staff'
        ? staffDocumentQueryOptions
        : customerDocumentQueryOptions;
  const field = kind === 'contract' ? 'contractId' : 'documentId';
  let current: Record<string, unknown> = {};
  let move!: (raw: Record<string, unknown>) => void;
  function Harness() {
    const [raw, setRaw] = useState(initial);
    move = setRaw;
    current = parse(raw);
    const queue = useListQuery(options, current, (change) =>
      setRaw((value) => parse(change(value)))
    );
    const queries = {
      queue,
      selected: typeof current[field] === 'string' ? (current[field] as string) : null,
      select: (id: string | null, opts: { resetCursor?: boolean } = {}) => {
        captured.selections.push(id);
        setRaw((value) =>
          parse({
            ...value,
            [field]: id ?? undefined,
            ...(opts.resetCursor ? { cursor: undefined } : {}),
          })
        );
      },
      apply: (search: string, filters: Record<string, string>) =>
        setRaw((value) =>
          parse({ ...writeListQuery(value, options, { search, filters }), [field]: undefined })
        ),
    };
    return kind === 'contract' ? (
      <ContractsWorkspace staff queries={queries} />
    ) : (
      <DocumentsWorkspace staff={kind === 'staff'} queries={queries} />
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<QueryProvider>{<Harness />}</QueryProvider>));
  return {
    host,
    raw: () => current,
    move: async (raw: Record<string, unknown>) => {
      await act(async () => move(raw));
    },
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
function button(host: ParentNode, label: string) {
  const item = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label
  );
  expect(item, label).toBeDefined();
  return item!;
}
async function change(host: ParentNode, selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector
  )!;
  await act(async () => {
    if (input.tagName === 'SELECT') {
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!.call(
        input,
        value
      );
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}
function data(url: string, kind: string) {
  const parsed = new URL(url, 'https://local');
  if (parsed.pathname === '/api/profiles') return { activeProfileId: documentProfileId };
  if (parsed.pathname.endsWith('/settings/timezone')) return { timezone: 'UTC' };
  if (parsed.pathname === '/api/admin/document-retention/holds')
    return { holds: [], held: false, canManage: false };
  if (kind === 'contract') {
    const id = parsed.searchParams.has('before') ? documentMore.id : documentRow.id;
    return {
      contracts: [
        {
          id,
          state: 'Active',
          serviceType: 'electricity',
          versionNumber: 1,
          versionId: id,
          updatedAt: documentRow.updatedAt,
          contractNumber: '9223372036854775807',
        },
      ],
      nextBefore: parsed.searchParams.has('before') ? last : documentRow.id,
    };
  }
  if (!parsed.searchParams.has('businessRecordType'))
    return {
      ...documentDetail,
      ...(parsed.pathname.endsWith(documentMore.id) ? documentMore : {}),
    };
  const cursor = parsed.searchParams.get('before');
  return {
    documents: [
      cursor === documentMore.id
        ? { ...documentRow, id: last, originalName: 'Last.pdf' }
        : cursor
          ? documentMore
          : documentRow,
    ],
    nextBefore: cursor === documentMore.id ? null : cursor ? documentMore.id : documentRow.id,
  };
}
for (const kind of ['staff', 'customer'] as const) {
  it(`${kind} restores document criteria and selection; Apply changes them atomically without serializing drafts`, async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return Response.json(data(url, kind));
      })
    );
    const view = await mount(kind, {
      q: 'Review',
      state: 'SubmittedForReview',
      category: 'document',
      cursor: documentRow.id,
      documentId: documentRow.id,
      profileId: documentProfileId,
    });
    try {
      expect(view.host.querySelector<HTMLInputElement>('#documents-search')!.value).toBe('Review');
      expect(view.host.querySelector('[data-slot="list-content"]')!.textContent).toContain(
        'Another.pdf'
      );
      expect(view.host.querySelector('[aria-label="View details"]')).not.toBeNull();
      const queue = calls.find((url) => url.includes('businessRecordType='))!;
      expect(Object.fromEntries(new URL(queue, 'https://local').searchParams)).toMatchObject({
        q: 'Review',
        state: 'SubmittedForReview',
        category: 'document',
        before: documentRow.id,
        profileId: documentProfileId,
      });
      const count = calls.length;
      await change(view.host, '#documents-search', 'Unapplied');
      expect(view.raw().q).toBe('Review');
      expect(calls).toHaveLength(count);
      await act(async () => button(view.host, 'Load more').click());
      expect(view.raw().cursor).toBe(documentMore.id);
      expect(view.host.querySelector('[data-slot="list-content"]')!.textContent).toContain(
        'Another.pdf'
      );
      expect(view.host.querySelector('[data-slot="list-content"]')!.textContent).toContain(
        'Last.pdf'
      );
      await act(async () => button(view.host, 'Apply filters').click());
      expect(view.raw()).toMatchObject({
        q: 'Unapplied',
        cursor: undefined,
        documentId: undefined,
      });
      expect(view.host.querySelector('[aria-label="View details"]')).toBeNull();
      await view.move({ q: 'Review', documentId: documentMore.id, cursor: documentRow.id });
      expect(view.host.querySelector<HTMLInputElement>('#documents-search')!.value).toBe('Review');
      expect(view.host.querySelector('[aria-label="View details"]')!.textContent).toContain(
        'Another.pdf'
      );
      if (kind === 'customer') expect(view.raw()).not.toHaveProperty('profileId');
    } finally {
      await view.close();
    }
  });
}
it('staff contract links preserve exact large numbers and independent detail; invalid form numbers do not navigate', async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return Response.json(data(url, 'contract'));
    })
  );
  const view = await mount('contract', {
    contractNumber: '9223372036854775807',
    state: 'Active',
    serviceType: 'electricity',
    profileId: documentProfileId,
    cursor: documentRow.id,
    contractId: last,
  });
  try {
    expect(view.host.querySelector<HTMLInputElement>('#contracts-number')!.value).toBe(
      '9223372036854775807'
    );
    expect(Object.fromEntries(new URL(calls[0]!, 'https://local').searchParams)).toMatchObject({
      contractNumber: '9223372036854775807',
      state: 'Active',
      serviceType: 'electricity',
      profileId: documentProfileId,
      before: documentRow.id,
    });
    expect(view.host.querySelector('[aria-label="Contract detail"]')!.textContent).toContain(last);
    await change(view.host, '#contracts-number', '9223372036854775808');
    const count = calls.length;
    await act(async () => button(view.host, 'Apply filters').click());
    expect(calls).toHaveLength(count);
    expect(view.raw().contractNumber).toBe('9223372036854775807');
    await change(view.host, '#contracts-number', '42');
    await act(async () => button(view.host, 'Apply filters').click());
    expect(view.raw()).toMatchObject({
      contractNumber: '42',
      cursor: undefined,
      contractId: undefined,
    });
    await view.move({ contractId: last });
    const selectedReads = calls.length;
    await act(async () => button(view.host, 'Close contract').click());
    expect(view.raw().contractId).toBeUndefined();
    expect(calls).toHaveLength(selectedReads);
  } finally {
    await view.close();
  }
});
it('document navigation rejects an old upload receipt and an unmounted upload callback', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => Response.json(data(url, 'customer')))
  );
  const view = await mount('customer', {});
  await act(async () => button(view.host, 'Upload document').click());
  const done = captured.uploaded!;
  await view.move({ documentId: documentMore.id });
  const selections = captured.selections.length;
  await act(async () => done(documentRow));
  expect(view.raw().documentId).toBe(documentMore.id);
  expect(captured.selections).toHaveLength(selections);
  await view.move({});
  await act(async () => button(view.host, 'Upload document').click());
  const unmounted = captured.uploaded!;
  await view.close();
  const after = captured.selections.length;
  await act(async () => unmounted(documentRow));
  expect(captured.selections).toHaveLength(after);
});
for (const kind of ['contract', 'staff', 'customer'] as const)
  it.each([401, 403])(
    `${kind} denial clears URL selection and private details (%s)`,
    async (status) => {
      let denied = false;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          const parsed = new URL(url, 'https://local');
          const list =
            kind === 'contract'
              ? parsed.pathname === '/api/admin/contracts'
              : parsed.searchParams.has('businessRecordType');
          return denied && list ? new Response('{}', { status }) : Response.json(data(url, kind));
        })
      );
      const view = await mount(kind, {
        [kind === 'contract' ? 'contractId' : 'documentId']: documentRow.id,
        ...(kind === 'staff' ? { profileId: documentProfileId } : {}),
      });
      try {
        denied = true;
        await act(async () => button(view.host, 'Refresh').click());
        expect(view.raw()[kind === 'contract' ? 'contractId' : 'documentId']).toBeUndefined();
        expect(view.host.querySelector('[aria-label="Contract detail"]')).toBeNull();
        expect(view.host.querySelector('[aria-label="View details"]')).toBeNull();
        expect(view.host.querySelector('[data-slot="list-content"] li')).toBeNull();
      } finally {
        await view.close();
      }
    }
  );
