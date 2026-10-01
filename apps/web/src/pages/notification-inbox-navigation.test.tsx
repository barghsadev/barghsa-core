import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NotificationCenterPage } from './NotificationCenterPage.js';
import { useListQuery } from '../hooks/useListQuery.js';
import { notificationInboxQueryOptions } from '../lib/notification-inbox-query.js';
import {
  notificationItem as item,
  notificationPage as page,
  notificationCursor,
} from '../test/notification-inbox-fixtures.js';
const { destination } = vi.hoisted(() => ({ destination: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => destination }));
let host: HTMLDivElement, root: Root, navigate: (raw: Record<string, unknown>) => void;
function Bound({ context = 'customer' }: { context?: 'customer' | 'staff' }) {
  const [raw, setRaw] = useState<Record<string, unknown>>({});
  navigate = setRaw;
  const queries = useListQuery(notificationInboxQueryOptions, raw, setRaw);
  return <NotificationCenterPage queries={queries} operatingContext={context} />;
}
beforeEach(() => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  destination.mockClear();
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
const cursor = notificationCursor();
for (const context of ['customer', 'staff'] as const) {
  it(`${context}: failed next pages retry exactly, deduplicate and history restores one window`, async () => {
    let fail = true;
    const reads: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (raw: string) => {
        const url = new URL(raw, 'https://example.test');
        reads.push(url);
        return url.searchParams.has('cursor')
          ? fail
            ? Response.json({}, { status: 503 })
            : Response.json({
                data: [item(), item('Older notice', '10000000-0000-4000-8000-000000000002')],
                next_cursor: null,
                unread_count: 2,
              })
          : Response.json({ ...page(), next_cursor: cursor });
      })
    );
    await act(async () => root.render(<Bound context={context} />));
    await click('Load more');
    expect(host.textContent).toContain('Current notice');
    fail = false;
    await click('Retry');
    expect(reads.at(-1)?.search).toBe(reads.at(-2)?.search);
    expect(reads.at(-1)?.searchParams.get('cursor')).toBe(cursor);
    expect(host.querySelectorAll('ul li')).toHaveLength(2);
    await act(async () => navigate({}));
    expect(host.querySelectorAll('ul li')).toHaveLength(1);
    await act(async () => navigate({ cursor }));
    expect(host.querySelectorAll('ul li')).toHaveLength(2);
  });
  it(`${context}: a delayed mark-read cannot navigate or replace a restored cursor`, async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((raw: string, init?: RequestInit) =>
        init?.method === 'PATCH'
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : Promise.resolve(
              Response.json({
                ...page(
                  new URL(raw, 'https://example.test').searchParams.has('cursor')
                    ? 'Older notice'
                    : 'Linked notice'
                ),
                data: [
                  {
                    ...item(
                      new URL(raw, 'https://example.test').searchParams.has('cursor')
                        ? 'Older notice'
                        : 'Linked notice'
                    ),
                    linkRoute: '/wallet',
                  },
                ],
              })
            )
      )
    );
    await act(async () => root.render(<Bound context={context} />));
    await click('Linked notice');
    await act(async () => navigate({ cursor }));
    await act(async () => finish(Response.json({ unread_count: 0 })));
    expect(destination).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Older notice');
    expect(host.querySelector('ul button')?.hasAttribute('disabled')).toBe(false);
  });
}
it('refreshing a restored page retains accepted rows on failure but returns its URL to the first page', async () => {
  let fail = false;
  const reads: URL[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (raw: string) => {
      const url = new URL(raw, 'https://example.test');
      reads.push(url);
      return fail
        ? Response.json({}, { status: 503 })
        : Response.json(page(url.searchParams.has('cursor') ? 'Older notice' : 'Current notice'));
    })
  );
  await act(async () => root.render(<Bound />));
  await act(async () => navigate({ cursor }));
  expect(host.textContent).toContain('Older notice');
  fail = true;
  await click('Refresh notifications');
  expect(host.textContent).toContain('Older notice');
  expect(reads.at(-1)?.searchParams.has('cursor')).toBe(false);
  fail = false;
  await click('Retry');
  expect(host.textContent).toContain('Current notice');
  expect(host.textContent).not.toContain('Older notice');
});
it('keeps Load more visible and disabled during its pending read', async () => {
  let finish!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      url.includes('cursor=')
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(Response.json({ ...page(), next_cursor: cursor }))
    )
  );
  await act(async () => root.render(<Bound />));
  await click('Load more');
  const more = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Load more')
  );
  expect(more?.disabled).toBe(true);
  expect(host.textContent).toContain('Current notice');
  await act(async () => finish(Response.json(page('Older notice'))));
});
