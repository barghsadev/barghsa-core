import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WorkflowStatusBanner } from './WorkflowStatusBanner.js';

it('shows the status, latest event, responsible party, action, and support path', () => {
  const html = renderToStaticMarkup(
    <WorkflowStatusBanner
      locale="en"
      status="Awaiting payment"
      happened="Staff approved the order"
      nextAction="Pay the invoice"
      owner="customer"
      actionHref="/invoices/123"
    />
  );
  expect(html).toContain('Current status');
  expect(html).toContain('Staff approved the order');
  expect(html).toContain('Who acts next');
  expect(html).toContain('You');
  expect(html).toContain('href="/invoices/123"');
  expect(html).toContain('href="/tickets"');
});

it('renders Persian guidance in RTL without turning a staff step into a customer action', () => {
  const html = renderToStaticMarkup(
    <WorkflowStatusBanner
      locale="fa"
      status="در حال بررسی"
      happened="درخواست ثبت شد"
      nextAction="بررسی کارشناسان"
      owner="staff"
      supportHref="/support"
    />
  );
  expect(html).toContain('dir="rtl"');
  expect(html).toContain('تیم ما');
  expect(html).toContain('href="/support"');
  expect(html).not.toContain('href="#');
});
