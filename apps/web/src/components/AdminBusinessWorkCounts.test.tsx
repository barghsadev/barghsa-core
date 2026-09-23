import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminBusinessWorkCounts } from './AdminBusinessWorkCounts.js';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
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

it('links unresolved refunds to finance work and alerts on failed obligations', async () => {
  await renderCounts({
    consultations: 2,
    electricityOrders: 1,
    solarRequests: 0,
    documentReviews: 3,
    refundObligations: 4,
    failedRefundObligations: 1,
  });
  const financeLinks = container.querySelectorAll('a[href="/admin/contracts#refund-obligations"]');
  expect(financeLinks).toHaveLength(2);
  expect(financeLinks[0]?.textContent).toContain('Unresolved refunds');
  expect(financeLinks[0]?.textContent).toContain('4');
  expect(financeLinks[1]?.closest('[role="alert"]')).toBeTruthy();
  expect(financeLinks[1]?.textContent).toContain('1 failed refunds');
});

it('hides finance widgets when the server withholds their counts', async () => {
  await renderCounts({
    consultations: null,
    electricityOrders: 1,
    solarRequests: null,
    documentReviews: 0,
    refundObligations: null,
    failedRefundObligations: null,
  });
  expect(container.querySelector('a[href="/admin/contracts#refund-obligations"]')).toBeNull();
  expect(container.querySelector('a[href="/admin/electricity-orders"]')).toBeTruthy();
});
