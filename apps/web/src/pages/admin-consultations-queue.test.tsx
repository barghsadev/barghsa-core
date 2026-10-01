import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AdminConsultationsPage } from './AdminConsultationsPage.js';

const routeSearch = vi.hoisted(() => ({ assignment: undefined as string | undefined }));
vi.mock('@tanstack/react-router', () => ({ useSearch: () => routeSearch }));

afterEach(() => {
  routeSearch.assignment = undefined;
  vi.unstubAllGlobals();
  document.documentElement.lang = 'fa';
});

it('opens the unassigned consultation queue from its dashboard link', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  routeSearch.assignment = 'unassigned';
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify(url.endsWith('/teams') ? { teams: [] } : { requests: [], nextAfter: null }),
        { headers: { 'Content-Type': 'application/json' } }
      );
    })
  );
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<AdminConsultationsPage />));
    expect(calls.some((url) => url.includes('/requests?assignment=unassigned'))).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set?.call(
    element,
    value
  );
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

it('keeps earlier consultation work visible after loading another queue page', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const calls: string[] = [];
  const row = (id: string) => ({
    id:
      id === 'first-work'
        ? '86000000-0000-4000-8000-000000000001'
        : '86000000-0000-4000-8000-000000000002',
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
                : {
                    requests: [row('first-work')],
                    nextAfter: '86000000-0000-4000-8000-000000000001',
                  }
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
    expect(calls.some((url) => url.includes('after=86000000-0000-4000-8000-000000000001'))).toBe(
      true
    );
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('submits a staff offer deadline in the saved account timezone', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const submitted: Array<Record<string, unknown>> = [];
  const requestId = '11111111-1111-4111-8111-111111111111';
  const profileId = '22222222-2222-4222-8222-222222222222';
  const request = {
    id: requestId,
    profile_id: profileId,
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
      else if (url.endsWith(`/requests/${requestId}`)) {
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
      } else if (url.endsWith('/fee-review')) {
        const input = JSON.parse(String(init?.body)) as Record<string, string>;
        data = {
          schemaVersion: 1,
          scope: { action: 'consultation.fee-offer', profileId, resourceId: requestId },
          data: {
            serviceTitle: request.product_snapshot.title,
            profileName: request.profile_name,
            scope: input.scope,
            deliverables: input.deliverables,
            fee: input.fee,
            validUntil: input.validUntil,
            reason: null,
            previousInvoice: null,
            outcome: 'issue_invoice',
          },
          hash: 'a'.repeat(64),
        };
      } else {
        submitted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        data = { financialReview: { hash: 'a'.repeat(64) } };
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
    expect(document.body.textContent).toContain('Review fee offer and invoice');
    await act(async () => button('Confirm')?.click());
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.validUntil).toBe('2099-01-01T12:30:00.000Z');
    expect(submitted[0]?.expectedReviewHash).toBe('a'.repeat(64));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it('confirms the reviewed paid-fee charge before sending the staff adjustment', async () => {
  document.documentElement.lang = 'en';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const requestId = '33333333-3333-4333-8333-333333333333';
  const profileId = '44444444-4444-4444-8444-444444444444';
  const invoiceId = '55555555-5555-4555-8555-555555555555';
  const request = {
    id: requestId,
    profile_id: profileId,
    profile_name: 'buyer-two',
    status: 'offer_accepted',
    product_snapshot: { title: { en: 'Consultation', fa: 'مشاوره' } },
    staff_owner_id: null,
    staff_team: null,
    submitted_at: '2026-09-23T10:00:00.000Z',
    priority: 'normal',
  };
  const submitted: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      let data: unknown;
      if (url.endsWith('/settings/timezone')) data = { timezone: 'UTC' };
      else if (url.endsWith('/teams')) data = { teams: [] };
      else if (url.includes('/requests?')) data = { requests: [request], nextAfter: null };
      else if (url.endsWith(`/requests/${requestId}`)) {
        data = {
          request: {
            ...request,
            scope: 'Site survey',
            deliverables: 'Report',
            fee: '500000',
            invoice_id: invoiceId,
            invoice_state: 'Paid',
            has_paid_invoice: true,
            uncovered_credit: '0',
            offer_valid_until: '2099-01-01T12:30:00.000Z',
            expected_next_step: null,
          },
          history: [],
        };
      } else if (url.endsWith('/paid-fee-review')) {
        const input = JSON.parse(String(init?.body)) as Record<string, string>;
        data = {
          schemaVersion: 1,
          scope: { action: 'consultation.paid-fee-adjustment', profileId, resourceId: requestId },
          data: {
            serviceTitle: request.product_snapshot.title,
            profileName: request.profile_name,
            scope: 'Site survey',
            deliverables: 'Report',
            previousFee: '500000',
            revisedFee: input.fee,
            difference: '100000',
            adjustmentAmount: '100000',
            reason: input.reason,
            validUntil: input.validUntil,
            paidInvoice: {
              id: invoiceId,
              state: 'Paid',
              totalAmount: '500000',
              paidAmount: '500000',
            },
            refundPlan: [],
            outcome: 'charge_invoice',
          },
          hash: 'b'.repeat(64),
        };
      } else if (url.endsWith('/paid-resolution-review')) {
        const input = JSON.parse(String(init?.body)) as Record<string, string>;
        data = {
          schemaVersion: 1,
          scope: { action: 'consultation.paid-resolution', profileId, resourceId: requestId },
          data: {
            action: input.action,
            serviceTitle: request.product_snapshot.title,
            profileName: request.profile_name,
            currentStatus: 'offer_accepted',
            resultingStatus: 'cancelled',
            reason: input.reason,
            currentInvoice: {
              id: invoiceId,
              state: 'Paid',
              paidAmount: '500000',
              adjustmentKind: null,
            },
            cancelInvoiceId: null,
            uncoveredCreditBefore: '0',
            refundAllocations: [
              { invoiceId, state: 'Paid', amount: '500000', availableBefore: '500000' },
            ],
            totalCredit: '500000',
            totalRefund: '500000',
          },
          hash: 'c'.repeat(64),
        };
      } else {
        submitted.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        data = {
          financialReview: { hash: url.endsWith('/paid-cancel') ? 'c'.repeat(64) : 'b'.repeat(64) },
        };
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
    await act(async () => button('buyer-two')?.click());
    const feeInput = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="text"]')
    ).find((item) => item.value === '500000');
    expect(feeInput).toBeDefined();
    await act(async () => {
      fill(feeInput!, '600000');
    });
    const reason = Array.from(container.querySelectorAll('textarea')).find((item) =>
      item.closest('label')?.textContent?.includes('Reason for fee adjustment')
    );
    expect(reason).toBeDefined();
    await act(async () => {
      fill(reason!, 'Additional review');
    });
    await act(async () => button('Adjust paid fee')?.click());
    expect(document.body.textContent).toContain('Review paid fee adjustment');
    expect(document.body.textContent).toContain('100,000 IRR');
    await act(async () => button('Confirm')?.click());
    expect(submitted).toHaveLength(1);
    expect(submitted[0]?.expectedReviewHash).toBe('b'.repeat(64));
    const closeReason = container.querySelector<HTMLTextAreaElement>('#consultation-reason');
    expect(closeReason).toBeDefined();
    await act(async () => fill(closeReason!, 'Customer requested cancellation'));
    await act(async () => button('Cancel request')?.click());
    expect(document.body.textContent).toContain('Review paid consultation decision');
    expect(document.body.textContent).toContain('500,000 IRR');
    await act(async () => button('Confirm')?.click());
    expect(submitted).toHaveLength(2);
    expect(submitted[1]?.expectedReviewHash).toBe('c'.repeat(64));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
