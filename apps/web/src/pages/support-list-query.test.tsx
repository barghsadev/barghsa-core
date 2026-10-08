import { QueryProvider } from '../test/query-provider.js';
import { act, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { StaffTicketsPage, CustomerTicketsPage } from './TicketsPage.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';
import { useListQuery, writeListQuery } from '../hooks/useListQuery.js';
import {
  customerTicketsSearch,
  staffTicketsSearch,
  consultationSearch,
  ticketQueryOptions,
  consultationQueryOptions,
} from '../lib/support-list-query.js';
import {
  supportTicket,
  supportQueue,
  supportComments,
  supportPeople,
  supportTeams as fixtureTeams,
} from '../test/support-queue-fixtures.js';
import { firstWork, olderWork, consultationWork } from '../test/staff-business-fixtures.js';
const route = vi.hoisted(() => ({ search: {} as Record<string, unknown> }));
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => route.search,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('../components/TeamActionDialog.js', () => ({
  TeamActionDialog: () => <div role="dialog" />,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  route.search = {};
  document.documentElement.lang = 'fa';
});
const supportTeams = fixtureTeams.map((team) => ({
  ...team,
  id: '33333333-3333-4333-8333-333333333333',
}));
const otherTicket = '87000000-0000-4000-8000-000000000001';
async function mount(
  kind: 'staff' | 'customer' | 'consultation',
  initial: Record<string, unknown>
) {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const parse =
    kind === 'staff'
      ? staffTicketsSearch
      : kind === 'customer'
        ? customerTicketsSearch
        : consultationSearch;
  const options = kind === 'consultation' ? consultationQueryOptions : ticketQueryOptions;
  const selectedKey = kind === 'consultation' ? 'requestId' : 'ticketId';
  let move!: (raw: Record<string, unknown>) => void;
  let current: Record<string, unknown> = {};
  function Harness() {
    const [raw, setRaw] = useState(initial);
    move = setRaw;
    current = raw;
    route.search = parse(raw);
    const queue = useListQuery(options, route.search, (update) =>
      setRaw((value) => parse(update(value)))
    );
    const selected =
      typeof route.search[selectedKey] === 'string' ? String(route.search[selectedKey]) : null;
    const queries = {
      queue,
      selected,
      select: (id: string | null) =>
        setRaw((value) => ({ ...value, [selectedKey]: id ?? undefined })),
    };
    if (kind === 'consultation')
      return (
        <AdminConsultationsPage
          queries={{
            ...queries,
            setFilters: (filters) =>
              setRaw((value) => ({
                ...writeListQuery(value, options, { filters }),
                requestId: undefined,
              })),
          }}
        />
      );
    const Page = kind === 'staff' ? StaffTicketsPage : CustomerTicketsPage;
    return (
      <AccountUserProvider value={kind === 'staff' ? 'staff' : 'customer'}>
        <Page queries={queries} />
      </AccountUserProvider>
    );
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<QueryProvider>{<Harness />}</QueryProvider>));
  return {
    host,
    raw: () => current,
    move: (value: Record<string, unknown>) => act(async () => move(value)),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}
async function change(host: ParentNode, selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    selector
  )!;
  expect(field).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value')?.set?.call(field, value);
    field.dispatchEvent(
      new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })
    );
  });
}
function button(host: ParentNode, label: string) {
  const found = Array.from(host.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label
  );
  expect(found, label).toBeDefined();
  return found!;
}
function ticketData(url: string) {
  const parsed = new URL(url, 'http://localhost');
  if (parsed.pathname.endsWith('/settings/timezone')) return { timezone: 'UTC' };
  if (parsed.pathname.endsWith('/comments')) return supportComments;
  if (parsed.pathname.endsWith('/assignees')) return supportPeople;
  if (parsed.pathname.endsWith('/teams')) return supportTeams;
  if (parsed.pathname.endsWith(otherTicket))
    return { ...supportTicket, id: otherTicket, subject: 'Another question' };
  if (parsed.pathname.endsWith(supportTicket.id)) return supportTicket;
  return supportQueue;
}
for (const kind of ['staff', 'customer'] as const) {
  it(`${kind}: restores every ticket criterion and keeps selected replies independent of page/filter navigation`, async () => {
    const reads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        reads.push(url);
        return Response.json(ticketData(url));
      })
    );
    const view = await mount(kind, {
      q: 'Delivery',
      status: 'active',
      order: 'asc',
      page: 2,
      ticketId: supportTicket.id,
      ...(kind === 'customer' ? { scope: 'active' } : {}),
    });
    try {
      const query = new URL(
        reads.find((url) => url.includes('?page='))!,
        'http://localhost'
      ).searchParams;
      expect(Object.fromEntries(query)).toMatchObject({
        page: '2',
        search: 'Delivery',
        status: 'active',
        sortOrder: 'asc',
        ...(kind === 'customer' ? { scope: 'active' } : {}),
      });
      expect(view.host.querySelector<HTMLInputElement>('#ticket-search')!.value).toBe('Delivery');
      await change(view.host, '#ticket-reply', 'Private draft');
      const details = reads.filter((url) => url.endsWith(supportTicket.id)).length;
      await act(async () => button(view.host, 'Next').click());
      expect(view.raw().page).toBe(3);
      expect(reads.filter((url) => url.endsWith(supportTicket.id))).toHaveLength(details);
      expect(view.host.querySelector<HTMLTextAreaElement>('#ticket-reply')!.value).toBe(
        'Private draft'
      );
      await change(view.host, '#ticket-filter', 'resolved');
      expect(view.raw().page).toBeUndefined();
      expect(view.raw().ticketId).toBe(supportTicket.id);
      expect(view.host.querySelector<HTMLTextAreaElement>('#ticket-reply')!.value).toBe(
        'Private draft'
      );
      await view.move({ ticketId: otherTicket, page: 2 });
      expect(view.host.querySelector('article h2')!.textContent).toBe('Another question');
      expect(view.host.querySelector<HTMLTextAreaElement>('#ticket-reply')!.value).toBe('');
      expect(view.host.querySelector<HTMLInputElement>('#ticket-search')!.value).toBe('');
    } finally {
      await view.close();
    }
  });
  it(`${kind}: a delayed reply receipt reloads the current queue and cannot reopen its old ticket`, async () => {
    let finish!: (response: Response) => void;
    const reads: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST')
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        reads.push(url);
        return Response.json(ticketData(url));
      })
    );
    const view = await mount(kind, { ticketId: supportTicket.id });
    try {
      await change(view.host, '#ticket-reply', 'Captured reply');
      await act(async () => {
        button(view.host, 'Send reply').click();
        await vi.dynamicImportSettled();
      });
      expect(finish).toBeDefined();
      await view.move({ ticketId: otherTicket, status: 'closed' });
      const oldReads = reads.filter((url) => url.endsWith(supportTicket.id)).length;
      await act(async () =>
        finish(
          Response.json(
            {
              id: '44444444-4444-4444-8444-444444444444',
              ticketId: supportTicket.id,
              authorId: kind === 'staff' ? 'staff' : 'customer',
              body: 'Captured reply',
              visibility: 'public',
              bodyFormat: 'markdown',
              authorContext: kind === 'staff' ? 'staff' : 'customer',
              author: null,
              attachments: [],
              attachmentCount: 0,
              createdAt: supportTicket.updatedAt,
              updatedAt: supportTicket.updatedAt,
            },
            { status: 201 }
          )
        )
      );
      expect(view.raw().ticketId).toBe(otherTicket);
      expect(view.host.querySelector('article h2')!.textContent).toBe('Another question');
      expect(view.host.querySelector<HTMLTextAreaElement>('#ticket-reply')!.value).toBe('');
      expect(reads.filter((url) => url.endsWith(supportTicket.id))).toHaveLength(oldReads);
      const lastQueueRead = reads
        .filter((url) => new URL(url, 'http://localhost').searchParams.has('page'))
        .at(-1)!;
      expect(new URL(lastQueueRead, 'http://localhost').searchParams.get('status')).toBe('closed');
    } finally {
      await view.close();
    }
  });
  it.each([401, 403])(`${kind}: discards private ticket work on %s`, async (status) => {
    let denied = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (denied && new URL(url, 'http://localhost').searchParams.has('page'))
          return new Response('{}', { status });
        return Response.json(ticketData(url));
      })
    );
    const view = await mount(kind, { ticketId: supportTicket.id });
    try {
      await change(view.host, '#ticket-reply', 'Private draft');
      denied = true;
      await act(async () => button(view.host, 'Refresh tickets').click());
      expect(view.host.querySelector('article')).toBeNull();
      expect(view.host.querySelector('#ticket-reply')).toBeNull();
      expect(view.raw().ticketId).toBeUndefined();
      expect(view.host.textContent).not.toContain('Delivery question');
    } finally {
      await view.close();
    }
  });
}
it('consultation restores queue and detail together, and filter edits atomically reset cursor and selection', async () => {
  const reads: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      reads.push(url);
      const parsed = new URL(url, 'http://localhost');
      if (url.endsWith('/settings/timezone')) return Response.json({ timezone: 'UTC' });
      if (url.endsWith('/teams')) return Response.json({ teams: [] });
      if (parsed.pathname.endsWith(firstWork) || parsed.pathname.endsWith(olderWork))
        return Response.json({
          request: consultationWork(parsed.pathname.endsWith(firstWork) ? firstWork : olderWork),
          history: [],
        });
      return Response.json({
        requests: [consultationWork(parsed.searchParams.has('after') ? olderWork : firstWork)],
        nextAfter: parsed.searchParams.has('after') ? olderWork : firstWork,
      });
    })
  );
  const view = await mount('consultation', {
    status: 'under_review',
    assignment: 'mine',
    priority: 'high',
    minAgeDays: 7,
    cursor: firstWork,
    requestId: olderWork,
  });
  try {
    const content = view.host.querySelector('[data-slot="list-content"]')!;
    expect(content.textContent).toContain('Older buyer');
    expect(content.textContent).not.toContain('First buyer');
    expect(view.host.querySelector('#consultation-reason')).not.toBeNull();
    const queueRead = reads.find((url) => url.includes('/requests?'))!;
    expect(Object.fromEntries(new URL(queueRead, 'http://localhost').searchParams)).toMatchObject({
      status: 'under_review',
      assignment: 'mine',
      priority: 'high',
      minAgeDays: '7',
      after: firstWork,
    });
    const select = Array.from(
      view.host.querySelectorAll<HTMLSelectElement>('[data-slot="list-toolbar"] select')
    ).find((node) => node.value === 'high')!;
    expect(select).toBeDefined();
    await act(async () => {
      select.value = 'normal';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(view.raw().cursor).toBeUndefined();
    expect(view.raw().requestId).toBeUndefined();
    expect(view.host.querySelector('#consultation-reason')).toBeNull();
    expect(content.textContent).toContain('First buyer');
    expect(content.textContent).not.toContain('Older buyer');
  } finally {
    await view.close();
  }
});
