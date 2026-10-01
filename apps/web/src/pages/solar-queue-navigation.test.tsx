import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AdminSolarPostalPage } from './AdminSolarPostalPage.js';
import { AdminSolarDocumentsPage } from './AdminSolarDocumentsPage.js';
import { useListQuery } from '../hooks/useListQuery.js';
import {
  solarPostalQueryOptions,
  solarRequestsQueryOptions,
  solarFilesQueryOptions,
} from '../lib/solar-staff-query.js';
import {
  firstSolar,
  olderSolar,
  solarRequest,
  solarFile,
  solarDocuments,
  solarPostal,
  solarGuidance,
} from '../test/solar-staff-fixtures.js';

let confirmation: {
  action: { title: string };
  onSuccess: () => Promise<void>;
  onClose: () => void;
} | null = null;
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: (props: typeof confirmation) => {
    confirmation = props;
    return <div data-testid="confirmation">{props?.action.title}</div>;
  },
}));
vi.mock('../components/SolarContractForm.js', () => ({
  SolarContractForm: ({ onCreated }: { onCreated: (id: string) => void }) => (
    <button onClick={() => onCreated(olderSolar)}>Create contract</button>
  ),
}));
let host: HTMLDivElement, root: Root;
let navigate: (raw: Record<string, unknown>) => void;
type Kind = 'requests' | 'files' | 'postal';
function Bound({ kind }: { kind: Kind }) {
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  navigate = setRaw;
  const update = (change: (raw: Record<string, unknown>) => Record<string, unknown>) =>
    setRaw(change);
  const postal = useListQuery(solarPostalQueryOptions, raw, update);
  const requests = useListQuery(solarRequestsQueryOptions, raw, update);
  const files = useListQuery(solarFilesQueryOptions, raw, update);
  return kind === 'postal' ? (
    <AdminSolarPostalPage queries={postal} />
  ) : (
    <AdminSolarDocumentsPage queries={{ requests, files, reset: () => setRaw({}) }} />
  );
}
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  confirmation = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function click(label: string) {
  const found = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  expect(found, label).toBeDefined();
  await act(async () => found!.click());
}
it('a contract created on a restored postal page keeps its result link after refreshing the first page', async () => {
  const reads: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname.endsWith('/timezone')) return Response.json({ timezone: 'Asia/Tehran' });
      if (url.pathname.includes('guidance')) return Response.json(solarGuidance);
      reads.push(url);
      return Response.json({
        requests: [{ ...solarPostal(), request_status: 'approved', postal_status: 'received' }],
        nextBefore: null,
      });
    })
  );
  await act(async () => root.render(<Bound kind="postal" />));
  await act(async () => navigate({ cursor: firstSolar }));
  await click('First solar buyer');
  await click('Create contract');
  expect(reads.at(-1)?.searchParams.has('before')).toBe(false);
  expect(host.querySelector<HTMLAnchorElement>('a[href^="/admin/contracts"]')?.href).toContain(
    `contractId=${olderSolar}`
  );
  expect(host.textContent).toContain('Solar contract created');
});
for (const kind of ['requests', 'files', 'postal'] as const) {
  it(`${kind}: pending next page keeps its control disabled and a repeated cursor cannot advance`, async () => {
    const base =
      kind === 'files'
        ? '/api/admin/solar/document-review-queue'
        : kind === 'postal'
          ? '/api/admin/solar/postal-queue'
          : '/api/admin/solar/requests';
    let finish!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(String(input), 'http://localhost');
        if (url.pathname.endsWith('/timezone')) return Response.json({ timezone: 'Asia/Tehran' });
        if (url.pathname.includes('guidance')) return Response.json(solarGuidance);
        if (url.pathname === base && url.searchParams.has('before'))
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return Response.json(
          url.pathname.includes('document-review-queue')
            ? { documents: [solarFile()], nextBefore: firstSolar }
            : {
                requests: [kind === 'postal' ? solarPostal() : solarRequest()],
                nextBefore: firstSolar,
              }
        );
      })
    );
    await act(async () => root.render(<Bound kind={kind} />));
    const list = host.querySelectorAll('[data-slot="list-page"]')[kind === 'requests' ? 1 : 0]!;
    const label = kind === 'files' ? 'More files' : 'More requests';
    const more = () =>
      [...list.querySelectorAll('button')].find((b) => b.textContent?.trim() === label);
    await act(async () => more()!.click());
    expect(more()?.disabled).toBe(true);
    expect(list.querySelector('[data-slot="list-content"]')?.getAttribute('aria-busy')).toBe(
      'true'
    );
    expect(list.textContent).toContain(kind === 'files' ? 'first.pdf' : 'First solar buyer');
    await act(async () =>
      finish(
        Response.json(
          kind === 'files'
            ? { documents: [solarFile(olderSolar)], nextBefore: firstSolar }
            : {
                requests: [kind === 'postal' ? solarPostal(olderSolar) : solarRequest(olderSolar)],
                nextBefore: firstSolar,
              }
        )
      )
    );
    expect(more()).toBeUndefined();
  });
  it(`${kind}: history invalidates old callbacks without closing newer work or rereading guidance`, async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        const url = new URL(String(input), 'http://localhost');
        calls.push(url.pathname + url.search);
        if (url.pathname.endsWith('/timezone')) return Response.json({ timezone: 'Asia/Tehran' });
        if (url.pathname.includes('guidance')) return Response.json(solarGuidance);
        if (url.pathname.endsWith('/documents')) return Response.json(solarDocuments());
        if (url.pathname.includes('document-review-queue'))
          return Response.json({ documents: [solarFile()], nextBefore: firstSolar });
        return Response.json({
          requests: [kind === 'postal' ? solarPostal() : solarRequest()],
          nextBefore: firstSolar,
        });
      })
    );
    await act(async () => root.render(<Bound kind={kind} />));
    await click('First solar buyer');
    await act(async () => host.querySelector<HTMLFormElement>('form')!.requestSubmit());
    const old = confirmation!;
    expect(old).not.toBeNull();
    await act(async () =>
      navigate(kind === 'postal' ? { cursor: olderSolar } : { [`${kind}_cursor`]: olderSolar })
    );
    expect(host.querySelector('[data-testid="confirmation"]')).toBeNull();
    expect(host.querySelector('#solar-review-reason')).toBeNull();
    await act(async () => host.querySelector<HTMLFormElement>('form')!.requestSubmit());
    const count = calls.length;
    await act(async () => {
      await old.onSuccess();
      old.onClose();
    });
    expect(calls).toHaveLength(count);
    expect(host.querySelector('[data-testid="confirmation"]')).not.toBeNull();
    expect(calls.filter((path) => path.includes('guidance'))).toHaveLength(1);
  });
}
