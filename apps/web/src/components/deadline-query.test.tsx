import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import InvoiceDueAtPanel from './InvoiceDueAtPanel.js';
import ServiceDuePeriodPanel from './ServiceDuePeriodPanel.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
vi.mock('../hooks/useAccountTime.js', () => ({
  useAccountTime: () => ({ status: 'ready', timezone: 'UTC', notice: null, format: String }),
}));
const invoiceId = '11111111-1111-4111-8111-111111111111',
  otherId = '22222222-2222-4222-8222-222222222222';
const invoice = {
  invoiceId,
  state: 'Unpaid',
  issuedAt: '2026-09-01T00:00:00Z',
  payableFrom: '2026-09-01T00:00:00Z',
  dueAt: '2026-09-12T00:00:00Z',
  canOverride: true,
  dueAtOverride: null,
};
const periods = (days = 7) =>
  ['electricity', 'saving_plan', 'consultation', 'manual'].map((serviceType) => ({
    serviceType,
    defaultDays: days,
    periodId: null,
    effectiveFrom: null,
    effectiveUntil: null,
  }));
let root: Root,
  host: HTMLDivElement,
  kind: string,
  held: boolean,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  held = false;
  signal = undefined;
  finish = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.credentials).toBe('include');
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(path).toBe(
        kind === 'deadline'
          ? `/api/admin/invoices/${invoiceId}/due-at`
          : '/api/admin/config/invoice-due-periods'
      );
      if (!held) {
        held = true;
        signal = init!.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((resolve) => {
              finish = resolve;
            }),
        } as Response;
      }
      return Response.json(kind === 'deadline' ? invoice : periods());
    })
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(present = true, actor = 'staff-one') {
  await act(async () =>
    root.render(
      <QueryComponentProvider>
        <AccountUserProvider value={actor}>
          {present ? (
            kind === 'deadline' ? (
              <InvoiceDueAtPanel selection={null} />
            ) : (
              <ServiceDuePeriodPanel />
            )
          ) : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function lookup() {
  const input = host.querySelector<HTMLInputElement>('#invoice-id')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input,
      invoiceId
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    input.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}
for (const name of ['deadline', 'periods'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'owns full ' + name + ' bytes on %s without old date/settings or commands',
    async (change) => {
      kind = name;
      await render();
      if (name === 'deadline') await lookup();
      await vi.waitFor(() => expect(finish).toBeDefined());
      expect(signal?.aborted).toBe(false);
      const oldSignal = signal!,
        oldFinish = finish!,
        reads = vi.mocked(fetch).mock.calls.length;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(reads);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          name === 'deadline' ? { ...invoice, dueAt: '2040-12-01T00:00:00Z' } : periods(365)
        )
      );
      expect(host.querySelector<HTMLInputElement>('#due-at')?.value ?? '').not.toContain('2040');
      expect(host.querySelector<HTMLInputElement>('#due-period-days')?.value).not.toBe('365');
      if (name === 'deadline')
        expect(host.querySelector('[data-testid=loaded-invoice-id]')).toBeNull();
      if (name === 'periods' && change !== 'unmount') {
        expect(host.querySelector<HTMLInputElement>('#due-period-days')!.value).toBe('7');
        expect(host.querySelector<HTMLInputElement>('#due-period-days')!.disabled).toBe(false);
      }
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
it('cancels a held deadline body as soon as its lookup ID is edited', async () => {
  kind = 'deadline';
  await render();
  await lookup();
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(signal?.aborted).toBe(false);
  const input = host.querySelector<HTMLInputElement>('#invoice-id')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, otherId);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(signal!.aborted).toBe(true);
  await act(async () => finish!({ ...invoice, dueAt: '2040-12-01T00:00:00Z' }));
  expect(input.value).toBe(otherId);
  expect(host.querySelector('[data-testid=loaded-invoice-id]')).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
