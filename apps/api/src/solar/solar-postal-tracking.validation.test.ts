import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { solarPostalTrackingCommand } from './solar-postal-tracking.validation.js';
const input = () => ({
  estimatedArrivalDate: '2026-01-05',
  trackingUrl: null,
  note: 'Public tracking update',
  expectedRevision: 0,
  idempotencyKey: randomUUID(),
});
it.each([
  'http://courier.example.org',
  'javascript:alert(1)',
  'https://user:secret@courier.example.org',
  'https://127.0.0.1',
  'https://[::1]',
  'https://localhost',
  'https://service.internal',
  'https://service.test',
  'https://courier.example.org:8443',
  'https://courier.example.org/has space',
  'ftp://courier.example.org',
])('rejects unsafe tracking URL %s', (trackingUrl) => {
  expect(solarPostalTrackingCommand.safeParse({ ...input(), trackingUrl }).success).toBe(false);
});
it('normalizes public HTTPS URLs and allows clearing an estimate and link', () => {
  expect(
    solarPostalTrackingCommand.parse({
      ...input(),
      trackingUrl: 'HTTPS://COURIER.EXAMPLE.ORG:443/parcel',
    }).trackingUrl
  ).toBe('https://courier.example.org/parcel');
  expect(
    solarPostalTrackingCommand.parse({ ...input(), estimatedArrivalDate: null })
  ).toMatchObject({ estimatedArrivalDate: null, trackingUrl: null });
});
it.each([
  { estimatedArrivalDate: '2026-02-30' },
  { estimatedArrivalDate: '2026-01-05T00:00:00Z' },
  { note: ' ' },
  { expectedRevision: -1 },
  { expectedRevision: 2147483647 },
  { staffConfirmed: true },
])('rejects invalid command %j', (change) => {
  expect(solarPostalTrackingCommand.safeParse({ ...input(), ...change }).success).toBe(false);
});
