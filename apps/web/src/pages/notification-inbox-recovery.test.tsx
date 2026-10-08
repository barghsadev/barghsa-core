import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { NotificationCenterPage } from './NotificationCenterPage.js';
import {
  notificationItem as item,
  notificationPage as page,
} from '../test/notification-inbox-fixtures.js';
const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  navigate.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const render = async (context: 'customer' | 'staff' = 'customer') => {
  await act(async () =>
    root.render(
      <QueryProvider>{<NotificationCenterPage operatingContext={context} />}</QueryProvider>
    )
  );
};
async function click(text: string) {
  const node = [...host.querySelectorAll<HTMLButtonElement>('button')].find((n) =>
    n.textContent?.includes(text)
  );
  expect(node, text).toBeDefined();
  await act(async () => node!.click());
}
function arrange(
  read: (url: URL) => Response | Promise<Response>,
  write: () => Response | Promise<Response> = () => reply({ unread_count: 0 })
) {
  const calls = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === 'PATCH' ? write() : read(new URL(String(input), 'https://example.test'))
  );
  vi.stubGlobal('fetch', calls);
  return calls;
}
it('failed next-page retry retains accepted rows and repeats the exact cursor, with unique merged rows', async () => {
  let failed = true;
  const calls = arrange((url) =>
    url.searchParams.has('cursor')
      ? reply(
          {
            data: [item(), item('Older notice', '10000000-0000-4000-8000-000000000002')],
            next_cursor: null,
            unread_count: 2,
          },
          failed ? 503 : 200
        )
      : reply({ ...page(), next_cursor: 'older' })
  );
  await render();
  await click('Load more');
  expect(host.textContent).toContain('Current notice');
  expect(host.querySelector('ul button')?.hasAttribute('disabled')).toBe(true);
  failed = false;
  await click('Retry');
  expect(host.querySelectorAll('ul li')).toHaveLength(2);
  expect(
    calls.mock.calls.map(([u]) =>
      new URL(String(u), 'https://example.test').searchParams.get('cursor')
    )
  ).toEqual([null, 'older', 'older']);
});
it('fresh page refresh failure retains accepted rows until successful recovery', async () => {
  let failed = false;
  arrange(() => reply(page(), failed ? 503 : 200));
  await render();
  failed = true;
  await click('Refresh notifications');
  expect(host.textContent).toContain('Current notice');
  expect(host.querySelector('ul button')?.hasAttribute('disabled')).toBe(true);
  failed = false;
  await click('Retry');
  expect(host.querySelector('ul button')?.hasAttribute('disabled')).toBe(false);
});
it.each(['failure', 'malformed'])(
  'read marking %s restores rows and prevents false navigation',
  async (outcome) => {
    let good = false;
    const linked = { ...item(), linkRoute: '/wallet' };
    arrange(
      () => reply({ ...page(), data: [linked] }),
      () =>
        good
          ? reply({ unread_count: 0 })
          : outcome === 'failure'
            ? reply({}, 503)
            : reply({ unread_count: -1 })
    );
    await render();
    await click('Current notice');
    expect(navigate).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Current notice');
    expect(host.textContent).toContain('not confirmed');
    good = true;
    await click('Retry');
    await click('Current notice');
    expect(navigate).toHaveBeenCalledWith({ to: '/wallet', search: undefined });
  }
);
for (const context of ['customer', 'staff'] as const) {
  it.each([401, 403])(
    `${context}: denied page %s clears private rows and count, retry starts fresh`,
    async (status) => {
      let denied = false;
      arrange(() => reply({ ...page(), next_cursor: 'older' }, denied ? status : 200));
      await render(context);
      denied = true;
      await click('Refresh notifications');
      expect(host.querySelector('ul')).toBeNull();
      expect(host.textContent).not.toContain('Load more');
      denied = false;
      await click('Retry');
      expect(host.textContent).toContain('Current notice');
    }
  );
  it.each([401, 403])(
    `${context}: denied command %s clears optimistic private state`,
    async (status) => {
      arrange(
        () => reply(page()),
        () => reply({}, status)
      );
      await render(context);
      await click('Current notice');
      expect(host.querySelector('ul')).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    }
  );
}
it('changing filter discards a delayed prior page without hiding the new filter results', async () => {
  let resolve!: (r: Response) => void;
  arrange((url) =>
    url.searchParams.get('filter') === 'all'
      ? new Promise<Response>((r) => {
          resolve = r;
        })
      : reply(page('Unread notice'))
  );
  await render();
  await click('Unread only');
  await act(async () => resolve(reply(page('Stale notice'))));
  expect(host.textContent).toContain('Unread notice');
  expect(host.textContent).not.toContain('Stale notice');
});
it('changing operating context discards an obsolete command and prevents navigation', async () => {
  let resolve!: (r: Response) => void;
  arrange(
    () => reply({ ...page(), data: [{ ...item(), linkRoute: '/wallet' }] }),
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      })
  );
  await render();
  await click('Current notice');
  await render('staff');
  await act(async () => resolve(reply({ unread_count: 0 })));
  expect(navigate).not.toHaveBeenCalled();
  expect(host.textContent).toContain('Current notice');
});
it('repeating a pagination cursor pauses the list instead of looping', async () => {
  arrange((url) => reply({ ...page(), next_cursor: url.searchParams.get('cursor') ?? 'older' }));
  await render();
  await click('Load more');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
  expect(host.querySelectorAll('ul li')).toHaveLength(1);
});
it('unread mark-all removes rows only optimistically, restoring them on failed acknowledgement', async () => {
  arrange(
    () => reply(page()),
    () => reply({}, 503)
  );
  await render();
  await click('Unread only');
  await click('Mark all as read');
  expect(host.textContent).toContain('Current notice');
  expect(host.querySelector('[role=alert]')).not.toBeNull();
});

it.each(['customer', 'staff'] as const)(
  'denial clears sibling inboxes only in the same %s context',
  async (otherContext) => {
    let denied = false;
    arrange(() => reply(page(), denied ? 403 : 200));
    await act(async () =>
      root.render(
        <QueryProvider>
          {
            <>
              <NotificationCenterPage />
              <NotificationCenterPage operatingContext={otherContext} />
            </>
          }
        </QueryProvider>
      )
    );
    expect(host.querySelectorAll('ul')).toHaveLength(2);
    denied = true;
    await click('Refresh notifications');
    expect(host.querySelectorAll('ul')).toHaveLength(otherContext === 'customer' ? 0 : 1);
  }
);

it('accepted empty results display the localized empty state', async () => {
  arrange(() => reply({ data: [], next_cursor: null, unread_count: 0 }));
  await render();
  expect(host.textContent).toContain('No notifications');
  await click('Unread only');
  expect(host.textContent).toContain('You have no unread notifications');
});
