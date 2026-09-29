import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileLifecyclePanel } from './ProfileLifecyclePanel.js';

const profileId = '11111111-1111-7111-8111-111111111111';
const ticketId = '22222222-2222-7222-8222-222222222222';
const jobId = '33333333-3333-7333-8333-333333333333';
const preview = {
  profileId,
  blockers: [
    { code: 'legalHold', count: 1, owner: 'legal', nextStep: 'contactSupport' },
    { code: 'walletBalance', count: 0, owner: 'customer', nextStep: 'settleWallet' },
    { code: 'securityReview', count: 1, owner: 'privacy', nextStep: 'staffReview' },
  ],
  requests: [],
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
  await act(async () => root.render(<ProfileLifecyclePanel />));
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

it('reuses the same key when confirmation fails after submission and links the support thread', async () => {
  const submitted: Array<{ type: string; idempotencyKey: string }> = [];
  let posts = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (options?.method === 'POST') {
        if (url.endsWith('/export')) {
          return { ok: posts >= 2, status: posts >= 2 ? 202 : 503 };
        }
        submitted.push(JSON.parse(options.body as string));
        posts += 1;
        return { ok: true, status: 201, json: async () => ({ ticketId }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...preview,
          requests:
            posts >= 2
              ? [
                  {
                    ticketId,
                    type: 'export',
                    status: 'open',
                    createdAt: new Date().toISOString(),
                    exportJobId: null,
                    exportExpiresAt: null,
                  },
                ]
              : [],
        }),
      };
    })
  );
  await render();
  const button = [...container.querySelectorAll('button')].find(
    (item) => item.textContent === 'Request data export'
  )!;
  await act(async () => {
    button.click();
  });
  expect(container.textContent).toContain('The request could not be confirmed.');
  await act(async () => {
    button.click();
  });
  expect(submitted).toHaveLength(2);
  expect(submitted[0]?.type).toBe('export');
  expect(submitted[1]?.idempotencyKey).toBe(submitted[0]?.idempotencyKey);
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
