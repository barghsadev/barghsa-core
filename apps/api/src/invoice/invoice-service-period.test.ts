import { expect, it } from 'vitest';
import { electricityInvoicePeriod } from './invoice-service-period.js';

it('reads only a valid immutable electricity snapshot', () => {
  const snapshot = {
    schemaVersion: 1,
    totalKwh: '25',
    periodStart: '2026-10-01T00:00:00.000Z',
    periodEnd: '2026-11-01T00:00:00.000Z',
  };
  expect(electricityInvoicePeriod(snapshot)).toEqual({
    periodStart: snapshot.periodStart,
    periodEnd: snapshot.periodEnd,
  });
  expect(electricityInvoicePeriod({ ...snapshot, periodEnd: snapshot.periodStart })).toBeNull();
  expect(electricityInvoicePeriod({ ...snapshot, periodEnd: 'invalid' })).toBeNull();
  expect(electricityInvoicePeriod({ ...snapshot, totalKwh: undefined })).toBeNull();
  expect(electricityInvoicePeriod(null)).toBeNull();
});
