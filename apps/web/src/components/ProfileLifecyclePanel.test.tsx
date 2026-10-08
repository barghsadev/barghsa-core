import { QueryProvider } from '../test/query-provider.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileLifecyclePanel } from './ProfileLifecyclePanel.js';

import { AccountUserProvider } from '../hooks/useAccountUser.js';
import {
  actualLifecyclePreview,
  lifecycleTicketId as ticketId,
  lifecycleJobId as jobId,
  lifecycleProfileId as profileId,
} from './profile-lifecycle-test-fixture.js';
const preview = actualLifecyclePreview();
preview.blockers = preview.blockers.map((b) => (b.code === 'legalHold' ? { ...b, count: 1 } : b));
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value="owner/opaque">
            <ProfileLifecyclePanel />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
  await act(async () => {
    await Promise.resolve();
  });
}

it('shows distinct export and closure actions with blockers and the responsible team', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => preview }))
  );
  await render();
  expect(container.textContent).toContain('Request data export');
  expect(container.textContent).toContain('Request profile closure');
  expect(container.textContent).toContain('Legal document holds');
  expect(container.textContent).toContain('Owner: Legal');
  expect(container.textContent).toContain(
    'Support will verify identity and access before closure.'
  );
  expect(container.textContent).toContain('No outstanding items');
  await act(async () => {
    document.documentElement.lang = 'fa';
  });
  expect(container.textContent).toContain('درخواست دریافت داده');
  expect(container.textContent).toContain('نگهداری قانونی اسناد');
});

it('retries only the saved export ticket after a confirmed request and links its support thread', async () => {
  const submitted: Array<{ type: string; idempotencyKey: string }> = [];
  let exports = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        if (url.endsWith('/export')) {
          if (++exports === 1) return Response.json({}, { status: 503 });
          return Response.json({ ticketId, jobId, created: false }, { status: 202 });
        }
        submitted.push(JSON.parse(options.body as string));
        return Response.json(
          { ticketId, profileId, type: 'export', created: true },
          { status: 201 }
        );
      }
      if (url.startsWith('/api/jobs/'))
        return Response.json({
          id: jobId,
          type: 'profile-export',
          status: 'queued',
          progress_pct: 0,
          result_url: null,
          error_message: null,
          created_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
        });
      return Response.json({
        ...preview,
        requests:
          exports >= 2
            ? [
                {
                  ticketId,
                  type: 'export',
                  status: 'open',
                  createdAt: new Date().toISOString(),
                  exportJobId: jobId,
                  exportExpiresAt: null,
                },
              ]
            : [],
      });
    })
  );
  await render();
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Request data export'
  )!;
  await act(async () => button.click());
  expect(container.textContent).toContain('The result is not confirmed');
  expect(button.disabled).toBe(true);
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Retry the original request')!
      .click()
  );
  expect(submitted).toHaveLength(1);
  expect(submitted[0]?.type).toBe('export');
  expect(submitted[0]?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(exports).toBe(2);
  expect(container.querySelector(`a[href="/tickets?ticketId=${ticketId}"]`)).toBeTruthy();
});

it('shows live export progress beside its support request', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        url.startsWith('/api/jobs/')
          ? {
              id: jobId,
              type: 'profile-export',
              status: 'queued',
              progress_pct: 0,
              result_url: null,
              error_message: null,
              created_at: new Date().toISOString(),
              started_at: null,
              completed_at: null,
            }
          : {
              ...preview,
              requests: [
                {
                  ticketId,
                  type: 'export',
                  status: 'open',
                  createdAt: new Date().toISOString(),
                  exportJobId: jobId,
                  exportExpiresAt: null,
                },
              ],
            },
    }))
  );
  await render();
  await act(async () => {
    await Promise.resolve();
  });
  expect(container.textContent).toContain('Queued');
  expect(container.querySelector(`a[href="/tickets?ticketId=${ticketId}"]`)).toBeTruthy();
});

it('holds the original create key, locale and type across an unknown response and language change', async () => {
  const writes: Record<string, unknown>[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        writes.push(JSON.parse(String(options.body)));
        return writes.length === 1
          ? Response.json({ ticketId }, { status: 201 })
          : Response.json(
              { ticketId, profileId, type: 'closure', created: false },
              { status: 201 }
            );
      }
      return Response.json({
        ...preview,
        requests:
          writes.length > 1
            ? [
                {
                  ticketId,
                  type: 'closure',
                  status: 'open',
                  createdAt: new Date().toISOString(),
                  exportJobId: null,
                  exportExpiresAt: null,
                },
              ]
            : [],
      });
    })
  );
  await render();
  const closure = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Request profile closure'
  )!;
  await act(async () => {
    closure.click();
    closure.click();
  });
  expect(writes).toHaveLength(1);
  expect(
    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Request data export')!
      .disabled
  ).toBe(true);
  await act(async () => {
    document.documentElement.lang = 'fa';
  });
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'تلاش دوباره با همان درخواست')!
      .click()
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0]).toMatchObject({ type: 'closure', locale: 'en' });
});
it('rejects a partial blocker preview and retries an authorized complete read', async () => {
  let reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json(
        ++reads === 1 ? { ...preview, blockers: preview.blockers.slice(0, 6) } : preview
      )
    )
  );
  await render();
  expect(container.querySelector('[role=alert]')).not.toBeNull();
  expect(container.textContent).not.toContain('Request profile closure');
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(container.textContent).toContain('Request profile closure');
  expect(reads).toBe(2);
});
it('discards a late preview and retired controls when the current account changes', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn(
    async () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', fetcher);
  await render();
  const old = finish;
  await act(async () =>
    root.render(
      <QueryProvider>
        {
          <AccountUserProvider value="another/opaque">
            <ProfileLifecyclePanel />
          </AccountUserProvider>
        }
      </QueryProvider>
    )
  );
  await act(async () => old(Response.json(preview)));
  expect(container.textContent).not.toContain('Request profile closure');
  await act(async () =>
    finish(Response.json({ ...preview, profileId: '22222222-2222-4222-8222-222222222222' }))
  );
  expect(container.textContent).toContain('Request profile closure');
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('withdraws lifecycle actions on a current authorization denial', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? Response.json({}, { status: 403 }) : Response.json(preview)
    )
  );
  await render();
  await act(async () =>
    [...container.querySelectorAll('button')]
      .find((b) => b.textContent === 'Request profile closure')!
      .click()
  );
  expect(container.textContent).not.toContain('Request profile closure');
  expect(container.querySelector('[role=alert]')).not.toBeNull();
});
