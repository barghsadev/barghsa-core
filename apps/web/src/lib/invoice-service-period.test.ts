import { expect, it } from 'vitest';
import { formatInvoiceServicePeriod } from './invoice-service-period.js';

it('shows the last included calendar day for an exclusive end', () => {
  const format = (value: string | null) => value!.slice(0, 10);
  expect(formatInvoiceServicePeriod('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', format)).toBe(
    '2026-10-01 – 2026-10-31'
  );
});
