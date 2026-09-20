import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminInvoicesPage from './AdminInvoicesPage.js';

const INVOICE_A = '11111111-1111-7111-8111-111111111111';
const INVOICE_B = '22222222-2222-7222-8222-222222222222';

function invoiceDto(invoiceId: string) {
  return {
    invoiceId,
    state: 'Unpaid',
    issuedAt: '2026-08-01T00:00:00.000Z',
    payableFrom: '2026-08-01T00:00:00.000Z',
    dueAt: '2026-09-15T08:00:00.000Z',
    canOverride: true,
    dueAtOverride: null,
  };
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('AdminInvoicesPage lookup binding (T-04.1.03.03)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.documentElement.lang = 'en';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/user/settings/timezone'))
          return new Response(JSON.stringify({ timezone: 'America/Los_Angeles' }));
        if (url.endsWith(`/api/admin/invoices/${INVOICE_A}/due-at`)) {
          return {
            ok: true,
            json: async () => invoiceDto(INVOICE_A),
          };
        }
        if (url.endsWith('/api/admin/config/invoice-reminder-offsets')) {
          return { ok: true, json: async () => [] };
        }
        return { ok: false, status: 404, json: async () => ({ message: 'not found' }) };
      })
    );
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('hides the override form when the lookup ID is edited after loading', async () => {
    await act(async () => {
      root.render(<AdminInvoicesPage />);
    });

    const lookup = container.querySelector('#invoice-id') as HTMLInputElement;
    expect(lookup).toBeTruthy();

    await act(async () => {
      setInputValue(lookup, INVOICE_A);
    });

    const loadForm = lookup.closest('form');
    expect(loadForm).toBeTruthy();
    await act(async () => {
      loadForm!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(container.querySelector('[data-testid="loaded-invoice-id"]')?.textContent).toBe(
      INVOICE_A
    );
    expect((container.querySelector('#due-at') as HTMLInputElement).value).toBe('2026-09-15T01:00');
    expect(container.textContent).toContain('Jul 31, 2026, 5:00 PM');
    expect(container.querySelector('#override-reason')).toBeTruthy();

    await act(async () => {
      setInputValue(lookup, INVOICE_B);
    });

    expect(container.querySelector('[data-testid="loaded-invoice-id"]')).toBeNull();
    expect(container.querySelector('#due-at')).toBeNull();
    expect(container.querySelector('#override-reason')).toBeNull();
    expect(container.textContent).not.toContain('Apply due-date override');
  });

  it('does not report success for a mismatched override response', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST')
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ...invoiceDto(INVOICE_B),
                dueAt: '2026-09-20T08:00:00.000Z',
                dueAtOverride: { reason: 'Customer requested more time' },
              })
            )
          );
        return originalFetch(input, init);
      })
    );
    await act(async () => {
      root.render(<AdminInvoicesPage />);
    });
    const lookup = container.querySelector('#invoice-id') as HTMLInputElement;
    await act(async () => {
      setInputValue(lookup, INVOICE_A);
    });
    await act(async () => {
      lookup
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const due = container.querySelector('#due-at') as HTMLInputElement;
    await act(async () => {
      setInputValue(due, '2026-09-20T01:00');
      setInputValue(
        container.querySelector('#override-reason') as HTMLTextAreaElement,
        'Customer requested more time'
      );
    });
    await act(async () => {
      due.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-testid="loaded-invoice-id"]')?.textContent).toBe(
      INVOICE_A
    );
    expect(container.textContent).not.toContain('Due date overridden');
    expect(container.querySelector('#invoice-deadline-panel [role="alert"]')).toBeTruthy();
  });

  it('ignores a late response after the user changes the lookup ID', async () => {
    const originalFetch = globalThis.fetch;
    let resolveLookup!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith(`/api/admin/invoices/${INVOICE_A}/due-at`))
          return new Promise<Response>((resolve) => {
            resolveLookup = resolve;
          });
        return originalFetch(input, init);
      })
    );
    await act(async () => {
      root.render(<AdminInvoicesPage />);
    });
    const lookup = container.querySelector('#invoice-id') as HTMLInputElement;
    await act(async () => {
      setInputValue(lookup, INVOICE_A);
    });
    await act(async () => {
      lookup
        .closest('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      setInputValue(lookup, INVOICE_B);
    });
    await act(async () => {
      resolveLookup(new Response(JSON.stringify(invoiceDto(INVOICE_A))));
    });
    expect(lookup.value).toBe(INVOICE_B);
    expect(container.querySelector('#due-at')).toBeNull();
    expect(container.querySelector('[data-testid="loaded-invoice-id"]')).toBeNull();
  });
});
