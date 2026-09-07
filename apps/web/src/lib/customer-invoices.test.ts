import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchInvoiceDetails, formatIrr, roleI18nKey, stateI18nKey } from './customer-invoices.js';

describe('customer invoice helpers (T-04.1.05.04)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves a failed detail request status even when its body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 })));
    await expect(fetchInvoiceDetails('invoice-1')).rejects.toMatchObject({
      name: 'InvoiceRequestError', status: 503, message: 'HTTP 503',
    });
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
});
