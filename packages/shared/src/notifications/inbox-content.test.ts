import { expect, it } from 'vitest';
import {
  defaultInboxContent,
  defaultInboxLink,
  IMPLEMENTED_INBOX_EVENTS,
} from './inbox-content.js';
it('gives every currently emitted inbox event usable Persian and English content', () => {
  for (const event of IMPLEMENTED_INBOX_EVENTS) {
    const content = defaultInboxContent(event, {
      amount: '5000',
      reason: 'Customer-visible reason',
    });
    for (const locale of ['fa', 'en'] as const) {
      expect(content[locale].title.length).toBeGreaterThan(3);
      expect(content[locale].body).toContain('5000');
      expect(content[locale].body).not.toContain('notifications.');
    }
  }
});
it('uses valid invoice navigation and rejects an explicit unsafe link', () => {
  expect(
    defaultInboxLink('payment.invoice_reminder', {
      invoiceId: '12345678-1234-4234-8234-123456789012',
    })
  ).toBe('/invoices/12345678-1234-4234-8234-123456789012');
  expect(defaultInboxLink('payment.invoice_reminder', { invoiceId: '../../other' })).toBe(
    '/invoices'
  );
  expect(
    defaultInboxLink('payment.wallet_topup_completed', { link_route: 'https://outside.example' })
  ).toBeNull();
});
