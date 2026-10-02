import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NotificationStatusBadge } from './NotificationStatusBadge.js';

describe('NotificationStatusBadge', () => {
  it.each([
    ['security.session_revoked', 'Security', 'bg-danger-soft', 'lucide-shield-alert'],
    ['payment.invoice_paid', 'Payment', 'bg-success-soft', 'lucide-credit-card'],
    ['contract.cancelled', 'Contract', 'bg-info-soft', 'lucide-file-text'],
    ['order.submitted', 'Order', 'bg-primary/10', 'lucide-package'],
    ['document.review_completed', 'Document', 'bg-warning-soft', 'lucide-file-text'],
    ['custom.event', 'System', 'bg-muted', 'lucide-info'],
  ])('shows %s as a labeled, colored category', (type, label, color, icon) => {
    const html = renderToStaticMarkup(<NotificationStatusBadge type={type} locale="en" />);
    expect(html).toContain(color);
    expect(html).toContain(label);
    expect(html).toContain(icon);
    expect(html).toContain(`title="${label}"`);
  });

  it.each(['security', 'payment', 'contract', 'order', 'document', 'system'])(
    'keeps the %s category labeled and described in Persian',
    (type) => {
      const host = document.createElement('div');
      host.innerHTML = renderToStaticMarkup(
        <NotificationStatusBadge type={`${type}.event`} locale="fa" />
      );
      const badge = host.querySelector('[data-slot="notification-status-badge"]')!;
      expect(badge.getAttribute('title')).toBe(badge.textContent);
      expect(badge.textContent).toMatch(/[\u0600-\u06ff]/);
      expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(badge.textContent).not.toContain(type);
    }
  );

  it('localizes document notices in Persian', () => {
    const html = renderToStaticMarkup(
      <NotificationStatusBadge type="document.uploaded" locale="fa" />
    );
    expect(html).toContain('سند');
  });
});
