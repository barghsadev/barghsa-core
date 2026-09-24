import { expect, it } from 'vitest';
import { offerInputFromInstant, offerInstantFromInput } from './consultation-offer-time.js';

it('edits a consultation expiry in the account timezone, including a different calendar day', () => {
  const instant = '2099-01-01T12:30:00.000Z';
  const input = offerInputFromInstant(instant, 'Pacific/Kiritimati');
  expect(input).toBe('2099-01-02T02:30');
  expect(offerInstantFromInput(input, 'Pacific/Kiritimati')?.toISOString()).toBe(instant);
});

it('rejects nonexistent daylight-saving wall times and invalid dates', () => {
  expect(offerInstantFromInput('2026-03-08T02:30', 'America/New_York')).toBeUndefined();
  expect(offerInstantFromInput('2026-02-30T12:00', 'America/New_York')).toBeUndefined();
  expect(offerInstantFromInput('2026-03-08T03:30', 'America/New_York')?.toISOString()).toBe(
    '2026-03-08T07:30:00.000Z'
  );
});
