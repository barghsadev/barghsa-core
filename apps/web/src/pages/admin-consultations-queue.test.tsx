import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});

it('keeps earlier consultation work visible after loading another queue page', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const row = (id: string) => ({
    id,
    profile_id: 'profile-1',
    profile_name: id,
    status: 'submitted',
    product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
    staff_owner_id: null,
    staff_team: null,
    submitted_at: '2026-09-23T10:00:00.000Z',
    priority: 'normal',
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify(
          url.endsWith('/settings/timezone')
            ? { timezone: 'Pacific/Kiritimati' }
            : url.endsWith('/teams')
              ? { teams: [] }
              : new URL(url, 'http://localhost').searchParams.has('after')
                ? { requests: [row('older-work')], nextAfter: null }
                : { requests: [row('first-work')], nextAfter: 'first-work' }
        ),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminConsultationsPage />));
    expect(container.textContent).toContain('first-work');
    expect(container.textContent).toContain('09/24/2026');
    const more = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'More work'
    );
    expect(more).toBeDefined();
    await act(async () => more?.click());
    expect(container.textContent).toContain('first-work');
    expect(container.textContent).toContain('older-work');
    expect(calls.some((url) => url.includes('after=first-work'))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('submits a staff offer deadline in the saved account timezone', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const submitted: Array<Record<string, unknown>> = [];
  const request = {
    id: 'request-1',
    profile_id: 'profile-1',
    profile_name: 'buyer-one',
    status: 'under_review',
    product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
    staff_owner_id: null,
    staff_team: null,
    submitted_at: '2026-09-23T10:00:00.000Z',
    priority: 'normal',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      let data: unknown;
      if (url.endsWith('/settings/timezone')) data = { timezone: 'Pacific/Kiritimati' };
      else if (url.endsWith('/teams')) data = { teams: [] };
      else if (url.includes('/requests?')) data = { requests: [request], nextAfter: null };
      else if (url.endsWith('/requests/request-1')) {
        data = {
          request: {
            ...request,
            scope: 'Site survey',
            deliverables: 'Report',
            fee: '100000',
            invoice_id: null,
            has_paid_invoice: false,
            uncovered_credit: '0',
            offer_valid_until: '2099-01-01T12:30:00.000Z',
            expected_next_step: null,
          },
          history: [],
        };
      } else {
        submitted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        data = {};
      }
      return new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const button = (text: string) =>
    Array.from(document.querySelectorAll('button')).find((item) =>
      item.textContent?.includes(text)
    );
  try {
    await act(async () => root.render(<AdminConsultationsPage />));
    await act(async () => button('buyer-one')?.click());
    expect(container.querySelector<HTMLInputElement>('input[type="datetime-local"]')?.value).toBe(
      '2099-01-02T02:30'
    );
    await act(async () => button('Issue fee offer and invoice')?.click());
    await act(async () => button('Confirm')?.click());
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.validUntil).toBe('2099-01-01T12:30:00.000Z');
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
