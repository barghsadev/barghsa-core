import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from './AdminDashboard.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
    search,
    ...props
  }: {
    children: ReactNode;
    to: string;
    params?: { profileId: string };
    search?: { verification?: string };
    className?: string;
    'aria-label'?: string;
  }) => (
    <a
      href={`${to.replace('$profileId', params?.profileId ?? '')}${search?.verification ? `?verification=${search.verification}` : ''}`}
      className={props.className}
      aria-label={props['aria-label']}
    >
      {children}
    </a>
  ),
}));

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AdminDashboard staff widgets', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.documentElement.lang = 'en';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows recent pending profiles with detail links and a localized fallback name', async () => {
    document.documentElement.lang = 'fa';
    const legalId = '11111111-1111-4111-8111-111111111111';
    const individualId = '22222222-2222-4222-8222-222222222222';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/crm/dashboard/pending-verification'))
          return {
            ok: true,
            json: async () => ({
              enabled: true,
              count: 2,
              profiles: [
                {
                  id: legalId,
                  profileType: 'LEGAL',
                  firstName: null,
                  lastName: null,
                  legalName: 'Solar Co',
                  createdAt: '2026-09-01T00:00:00Z',
                },
                {
                  id: individualId,
                  profileType: 'INDIVIDUAL',
                  firstName: null,
                  lastName: null,
                  legalName: null,
                  createdAt: '2026-08-31T00:00:00Z',
                },
              ],
            }),
          };
        return { ok: false, status: 403 };
      })
    );

    await act(async () => root.render(<AdminDashboard />));
    await flush();

    const widget = container.querySelector('[role="region"]');
    expect(widget?.querySelectorAll('li')).toHaveLength(2);
    expect(
      widget?.querySelector(`a[href="/admin/crm/profiles/${legalId}"]`)?.textContent
    ).toContain('Solar Co');
    expect(
      widget?.querySelector(`a[href="/admin/crm/profiles/${individualId}"]`)?.textContent
    ).toContain('حقیقی');
    expect(widget?.querySelector('a[href="/admin/crm?verification=PENDING"]')).toBeTruthy();
  });

  it('shows an assertive warning when unresolved chargebacks exist', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/admin/dashboard/business-work-counts')) {
          return { ok: false, status: 403 };
        }
        if (url.endsWith('/api/crm/dashboard/pending-verification')) {
          return { ok: true, json: async () => ({ count: 0, profiles: [] }) };
        }
        if (url.endsWith('/api/admin/wallet/chargebacks/unresolved-warning')) {
          return {
            ok: true,
            json: async () => ({
              count: 2,
              unmatchedCount: 1,
              reversalFailedCount: 1,
              items: [
                {
                  eventId: 'evt-unmatched',
                  status: 'unmatched',
                  amountIrR: '150000',
                  walletId: null,
                  originalTransactionId: null,
                  reason: 'provider chargeback',
                  createdAt: '2026-09-02T06:00:00.000Z',
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      })
    );

    await act(async () => {
      root.render(<AdminDashboard />);
    });
    await flush();

    const banner = container.querySelector('[role="alert"]');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toContain('Unresolved chargebacks');
    expect(banner?.textContent).toContain('evt-unmatched');
    expect(banner?.textContent).toContain('150,000');
    expect(banner?.textContent).toContain('IRR');
    expect(banner?.getAttribute('aria-live')).toBe('assertive');
    expect(container.querySelector('div[dir="ltr"]')).toBeTruthy();
    const eventId = container.querySelector('span[dir="ltr"]');
    expect(eventId?.textContent).toBe('evt-unmatched');
    const chargebackCall = vi
      .mocked(fetch)
      .mock.calls.find((call) =>
        String(call[0]).includes('/api/admin/wallet/chargebacks/unresolved-warning')
      );
    expect(chargebackCall?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('renders the warning in RTL Persian with the event id forced LTR', async () => {
    document.documentElement.lang = 'fa';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/admin/dashboard/business-work-counts')) {
          return { ok: false, status: 403 };
        }
        if (url.endsWith('/api/crm/dashboard/pending-verification')) {
          return { ok: true, json: async () => ({ count: 0, profiles: [] }) };
        }
        if (url.endsWith('/api/admin/wallet/chargebacks/unresolved-warning')) {
          return {
            ok: true,
            json: async () => ({
              count: 1,
              unmatchedCount: 1,
              reversalFailedCount: 0,
              items: [
                {
                  eventId: 'evt-fa',
                  status: 'unmatched',
                  amountIrR: '150000',
                  walletId: null,
                  originalTransactionId: null,
                  reason: 'provider chargeback',
                  createdAt: '2026-09-02T06:00:00.000Z',
                },
              ],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      })
    );

    await act(async () => {
      root.render(<AdminDashboard />);
    });
    await flush();

    expect(container.querySelector('div[dir="rtl"]')).toBeTruthy();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('شارژبک حل‌نشده');
    expect(container.querySelector('span[dir="ltr"]')?.textContent).toBe('evt-fa');
  });

  it('hides the warning when every chargeback is resolved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/admin/dashboard/business-work-counts')) {
          return { ok: false, status: 403 };
        }
        if (url.endsWith('/api/crm/dashboard/pending-verification')) {
          return { ok: true, json: async () => ({ count: 0, profiles: [] }) };
        }
        if (url.endsWith('/api/admin/wallet/chargebacks/unresolved-warning')) {
          return {
            ok: true,
            json: async () => ({
              count: 0,
              unmatchedCount: 0,
              reversalFailedCount: 0,
              items: [],
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      })
    );

    await act(async () => {
      root.render(<AdminDashboard />);
    });
    await flush();

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
