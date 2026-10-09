import { QueryComponentProvider } from '../test/query-provider.js';
import { AccountUserProvider } from '../hooks/useAccountUser.js';
import { refreshProfileContext } from '../lib/profile-context.js';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import ManualInvoiceForm from './ManualInvoiceForm.js';
import InvoiceCorrectionsPanel from './InvoiceCorrectionsPanel.js';
vi.mock('../hooks/useLocale.js', () => ({ useLocale: () => 'en' }));
const invoiceId = '22222222-2222-4222-8222-222222222222',
  profileId = '11111111-1111-4111-8111-111111111111';
const source = {
  invoiceId,
  profileId,
  state: 'Unpaid',
  paidAmount: '0',
  totalAmount: '100',
  lines: [
    {
      description: 'Private obsolete',
      quantity: 1,
      unitPrice: '100',
      vatRate: 0,
      isTaxable: false,
    },
  ],
};
let root: Root,
  host: HTMLDivElement,
  kind: string,
  first: boolean,
  signal: AbortSignal | undefined,
  finish: ((value: unknown) => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  document.documentElement.lang = 'en';
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  first = true;
  signal = undefined;
  finish = undefined;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      expect(init?.credentials).toBe('include');
      expect(init?.method).toBeUndefined();
      expect(init?.body).toBeUndefined();
      expect(path).toContain(
        kind === 'profiles'
          ? '/api/admin/invoices/manual/profiles?'
          : `/api/admin/invoices/${invoiceId}/corrections`
      );
      if (first) {
        first = false;
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
      return Response.json(
        kind === 'profiles'
          ? {
              items: [{ id: profileId, title: 'Current customer', profileType: 'LEGAL' }],
              nextBefore: null,
            }
          : source
      );
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
            kind === 'profiles' ? (
              <ManualInvoiceForm />
            ) : (
              <InvoiceCorrectionsPanel />
            )
          ) : null}
        </AccountUserProvider>
      </QueryComponentProvider>
    )
  );
}
async function submitLookup(fill = true) {
  const input = host.querySelector<HTMLInputElement>('#correction-invoice-id')!;
  if (fill)
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
for (const name of ['profiles', 'corrections'])
  it.each(['unmount', 'actor', 'profile-context'])(
    'cancels full invoice ' + name + ' bytes on %s without private rows or commands',
    async (change) => {
      kind = name;
      await render();
      if (name === 'corrections') await submitLookup();
      await vi.waitFor(() => expect(finish).toBeDefined());
      expect(signal?.aborted).toBe(false);
      const oldSignal = signal!,
        oldFinish = finish!;
      await act(async () => {
        window.dispatchEvent(new Event('focus'));
        window.dispatchEvent(new Event('online'));
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      if (change === 'unmount') await render(false);
      else if (change === 'actor') await render(true, 'staff-two');
      else await act(async () => refreshProfileContext());
      expect(oldSignal.aborted).toBe(true);
      await act(async () =>
        oldFinish(
          name === 'profiles'
            ? {
                items: [{ id: profileId, title: 'Private obsolete', profileType: 'LEGAL' }],
                nextBefore: null,
              }
            : source
        )
      );
      expect(host.textContent).not.toContain('Private obsolete');
      expect(
        [...host.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value)
      ).not.toContain('Private obsolete');
      if (name === 'corrections') expect(host.querySelector('dl')).toBeNull();
      if (name === 'profiles' && change !== 'unmount')
        expect(host.querySelector('select')!.textContent).toContain('Current customer');
      expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
        true
      );
    }
  );
it.each([401, 403, 404])(
  'withdraws an accepted correction source before decoding an unreadable %s response and permits fresh explicit recovery',
  async (status) => {
    kind = 'corrections';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(source))
        .mockResolvedValueOnce(new Response('not-json', { status }))
        .mockResolvedValueOnce(Response.json(source))
    );
    await render();
    await submitLookup();
    await vi.waitFor(() => expect(host.querySelector('dl')).not.toBeNull());
    expect(host.querySelector('dl')!.textContent).toContain(invoiceId);
    await submitLookup(false);
    await vi.waitFor(() => expect(host.querySelector('dl')).toBeNull());
    expect(host.querySelector('[role=alert]')).not.toBeNull();
    await submitLookup(false);
    await vi.waitFor(() => expect(host.querySelector('dl')).not.toBeNull());
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(
      true
    );
  }
);
