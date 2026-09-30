import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminBusinessWorkCounts } from './AdminBusinessWorkCounts.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    className,
  }: {
    children: ReactNode;
    to: string;
    search?: { assignment?: string; status?: string };
    className?: string;
  }) => (
    <a
      href={`${to}${search?.assignment ? `?assignment=${search.assignment}` : search?.status ? `?status=${search.status}` : ''}`}
      className={className}
    >
      {children}
    </a>
  ),
}));

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

async function renderCounts(value: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => value }))
  );
  await act(async () => root.render(<AdminBusinessWorkCounts />));
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

it('links unresolved refunds and flags failed work for the permitted staff roles', async () => {
  await renderCounts({
    consultations: 2,
    unassignedConsultations: 1,
    electricityOrders: 1,
    savingOrders: 2,
    pendingTickets: 3,
    solarRequests: 0,
    documentReviews: 3,
    refundObligations: 4,
    failedRefundObligations: 1,
    failedJobs: 2,
    deadLetterNotifications: 3,
  });
  const financeLinks = container.querySelectorAll('a[href="/admin/contracts#refund-obligations"]');
  expect(financeLinks).toHaveLength(2);
  expect(financeLinks[0]?.textContent).toContain('Unresolved refunds');
  expect(financeLinks[0]?.textContent).toContain('4');
  expect(financeLinks[1]?.textContent).toContain('Failed refunds');
  expect(financeLinks[1]?.textContent).toContain('1');
  expect(container.querySelector('a[href="/admin/failed-jobs"]')?.textContent).toContain(
    '2Failed background jobs'
  );
  expect(container.querySelector('a[href="/admin/failed-notifications"]')?.textContent).toContain(
    '3Undelivered notifications'
  );
  expect(container.querySelector('a[href="/admin/failed-jobs"]')?.textContent).toContain(
    'Needs attention'
  );
  expect(container.querySelector('a[href="/admin/tickets?status=active"]')?.textContent).toContain(
    '3Pending tickets'
  );
  expect(container.querySelector('a[href="/admin/saving-orders"]')?.textContent).toContain(
    '2Saving orders awaiting review'
  );
  expect(
    container.querySelector('a[href="/admin/consultations?assignment=unassigned"]')?.textContent
  ).toContain('1Unassigned consultations');
});

it('hides finance widgets when the server withholds their counts', async () => {
  await renderCounts({
    consultations: null,
    unassignedConsultations: null,
    electricityOrders: 1,
    savingOrders: 0,
    pendingTickets: null,
    solarRequests: null,
    documentReviews: 0,
    refundObligations: null,
    failedRefundObligations: null,
    failedJobs: null,
    deadLetterNotifications: null,
  });
  expect(container.querySelector('a[href="/admin/contracts#refund-obligations"]')).toBeNull();
  expect(container.querySelector('a[href="/admin/failed-jobs"]')).toBeNull();
  expect(container.querySelector('a[href="/admin/electricity-orders"]')).toBeTruthy();
});

it('renders the same failure links and counts in Persian', async () => {
  document.documentElement.lang = 'fa';
  await renderCounts({
    consultations: null,
    unassignedConsultations: null,
    electricityOrders: null,
    savingOrders: null,
    pendingTickets: null,
    solarRequests: null,
    documentReviews: null,
    refundObligations: null,
    failedRefundObligations: null,
    failedJobs: 1,
    deadLetterNotifications: 0,
  });
  expect(container.querySelector('a[href="/admin/failed-jobs"]')?.textContent).toContain(
    'وظایف پس‌زمینه ناموفق'
  );
  expect(container.querySelector('a[href="/admin/failed-notifications"]')?.textContent).toContain(
    'اعلان‌های ارسال‌نشده'
  );
});
