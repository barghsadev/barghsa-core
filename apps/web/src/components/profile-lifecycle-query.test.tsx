import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnershipBanner } from './OwnershipBanner.js';
import { ProfileLifecyclePanel } from './ProfileLifecyclePanel.js';
import {
  actualLifecyclePreview,
  lifecycleTicketId,
  lifecycleProfileId,
} from './profile-lifecycle-test-fixture.js';

const route = vi.hoisted(() => ({ pathname: '/dashboard' }));
vi.mock('@tanstack/react-router', () => ({
  useLocation: () => route,
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));
let host: HTMLDivElement, root: Root;
let pending: boolean, signal: AbortSignal, finish: (value: unknown) => void;
let readCount: number, writes: unknown[];
let payload: unknown;
let pendingAfterWrite: boolean;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  route.pathname = '/dashboard';
  pending = true;
  pendingAfterWrite = false;
  readCount = 0;
  writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        writes.push(JSON.parse(String(init.body)));
        return Response.json(
          {
            ticketId: lifecycleTicketId,
            profileId: lifecycleProfileId,
            type: 'closure',
            created: true,
          },
          { status: 201 }
        );
      }
      expect(['/api/profiles/ownership-transfers', '/api/tickets/lifecycle-preview']).toContain(
        String(input)
      );
      readCount++;
      signal = init!.signal as AbortSignal;
      return {
        ok: true,
        status: 200,
        json: () =>
          pending || (pendingAfterWrite && writes.length > 0)
            ? new Promise((resolve) => {
                finish = resolve;
              })
            : Promise.resolve(payload),
      };
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const component = (kind: string) =>
  kind === 'ownership' ? <OwnershipBanner /> : <ProfileLifecyclePanel />;
async function render(kind: string | null, actor = 'owner/opaque') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>{kind && component(kind)}</AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
for (const kind of ['ownership', 'lifecycle']) {
  it.each(['unmount', 'actor', 'profile-context'])(
    'cancels pending ' + kind + ' bytes on %s and refuses late notices',
    async (change) => {
      await render(kind);
      const oldSignal = signal;
      const oldFinish = finish;
      expect(oldSignal.aborted).toBe(false);
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(readCount).toBe(1);
      pending = false;
      payload =
        kind === 'ownership' ? { transfers: [] } : { ...actualLifecyclePreview(), requests: [] };
      if (change === 'unmount') await render(null);
      else if (change === 'actor') await render(kind, 'replacement/opaque');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          kind === 'ownership'
            ? { transfers: [{ direction: 'incoming' }] }
            : {
                ...actualLifecyclePreview(),
                requests: [
                  {
                    ticketId: lifecycleTicketId,
                    type: 'closure',
                    status: 'open',
                    createdAt: '2026-01-01T00:00:00Z',
                    exportJobId: null,
                    exportExpiresAt: null,
                  },
                ],
              }
        )
      );
      expect(host.querySelector('a[href="/settings/team"]')).toBeNull();
      expect(host.querySelector(`a[href="/tickets?ticketId=${lifecycleTicketId}"]`)).toBeNull();
      expect(writes).toHaveLength(0);
    }
  );
}
it('withdraws an old ownership notice while the new route read is pending', async () => {
  pending = false;
  payload = { transfers: [{ direction: 'incoming' }] };
  await render('ownership');
  expect(host.querySelector('a[href="/settings/team"]')).not.toBeNull();
  pending = true;
  route.pathname = '/tickets';
  await render('ownership');
  expect(host.querySelector('a[href="/settings/team"]')).toBeNull();
  await act(async () => finish({ transfers: [] }));
  expect(host.querySelector('a[href="/settings/team"]')).toBeNull();
  expect(writes).toHaveLength(0);
});
it('cancels lifecycle confirmation bytes after an accepted closure without resubmitting the request', async () => {
  pending = false;
  payload = actualLifecyclePreview();
  await render('lifecycle');
  pendingAfterWrite = true;
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.textContent === 'Request profile closure'
  )!;
  await act(async () => button.click());
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ type: 'closure', locale: 'en' });
  const oldSignal = signal;
  const oldFinish = finish;
  expect(oldSignal.aborted).toBe(false);
  await render(null);
  expect(oldSignal.aborted).toBe(true);
  await act(async () =>
    oldFinish({
      ...actualLifecyclePreview(),
      requests: [
        {
          ticketId: lifecycleTicketId,
          type: 'closure',
          status: 'open',
          createdAt: '2026-01-01T00:00:00Z',
          exportJobId: null,
          exportExpiresAt: null,
        },
      ],
    })
  );
  expect(writes).toHaveLength(1);
  expect(host.textContent).toBe('');
});
