import { expect, it } from 'vitest';
import { postalCalendarDate, postalDateInput, publicPostalUrl } from './solar-postal-tracking.js';
it('formats a recorded day in Gregorian or Persian without timezone drift', () => {
  expect(postalCalendarDate('2026-01-05', 'en')).toBe('5 January 2026');
  expect(postalCalendarDate('2026-01-05', 'fa')).toBe(
    new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date('2026-01-05T12:00:00Z'))
  );
  expect(postalCalendarDate('2026-02-30', 'en')).toBeNull();
  expect(postalCalendarDate(null, 'fa')).toBeNull();
  expect(postalDateInput(new Date('2026-01-04T21:00:00Z'), 'Asia/Tehran')).toBe('2026-01-05');
});
it.each([
  'javascript:alert(1)',
  'http://courier.example.org',
  'https://user:example@courier.example.org',
  'https://127.0.0.1',
  'https://[::1]',
  'https://localhost',
  'https://courier.internal',
  'https://courier.example.org:8443',
])('does not expose unsafe legacy link %s', (url) => expect(publicPostalUrl(url)).toBeNull());
it('normalizes an external public HTTPS link', () =>
  expect(publicPostalUrl('HTTPS://COURIER.EXAMPLE.ORG:443/parcel')).toEqual({
    href: 'https://courier.example.org/parcel',
    host: 'courier.example.org',
  }));
