import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchInvoiceDetails,
  fetchInvoiceList,
  formatIrr,
  roleI18nKey,
  stateI18nKey,
} from './customer-invoices.js';

describe('customer invoice helpers (T-04.1.05.04)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves a failed detail request status even when its body is not JSON', async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchInvoiceDetails('invoice-1', signal)).rejects.toMatchObject({
      name: 'InvoiceRequestError',
      status: 503,
      message: 'HTTP 503',
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/invoices/invoice-1',
      expect.objectContaining({ credentials: 'include', signal })
    );
  });

  it('rejects a matching detail receipt with an invalid correction chain or activity', async () => {
    const invoiceId = 'invoice-1';
    const invoice = {
      invoiceId,
      role: 'original',
      state: 'Unpaid',
      totalAmount: '9007199254740993',
      paidAmount: '0',
      explanation: null,
      lines: [],
    };
    const payload = {
      viewedInvoiceId: invoiceId,
      originalInvoiceId: invoiceId,
      invoice,
      chain: [invoice],
    };
    const signal = new AbortController().signal;
    for (const malformed of [
      { ...payload, invoice: { ...invoice, lines: null } },
      { ...payload, chain: [invoice, null] },
      { ...payload, invoice: { ...invoice, totalAmount: 9007199254740992 } },
      { ...payload, payments: {} },
      { ...payload, refunds: [null] },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(malformed))
      );
      await expect(fetchInvoiceDetails(invoiceId, signal)).rejects.toMatchObject({ status: 502 });
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(payload))
    );
    await expect(fetchInvoiceDetails(invoiceId, signal)).resolves.toEqual(payload);
  });

  it('preserves malformed money text instead of displaying a fabricated numeric amount', () => {
    expect(formatIrr('unavailable', 'en')).toBe('unavailable');
  });

  it('formats IRR amounts without using IEEE floats', () => {
    expect(formatIrr('2000000000000', 'en')).toBe('2,000,000,000,000');
  });

  it('maps roles and states to i18n keys', () => {
    expect(roleI18nKey('replacement')).toBe('invoices.details.role.replacement');
    expect(stateI18nKey('Cancelled')).toBe('invoices.state.Cancelled');
  });
  it('loads the invoice list with credentials and preserves list errors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ invoices: [] }))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    await expect(fetchInvoiceList()).resolves.toEqual({ invoices: [] });
    expect(fetch).toHaveBeenCalledWith(
      '/api/invoices',
      expect.objectContaining({ credentials: 'include', headers: { Accept: 'application/json' } })
    );
    await expect(fetchInvoiceList()).rejects.toMatchObject({ status: 503, message: 'HTTP 503' });
  });
});
