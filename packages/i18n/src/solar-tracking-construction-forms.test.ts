import { expect, it } from 'vitest';
import { tSolar } from './solar.js';
it('localizes tracking and construction ownership, limits and uncertain recovery', () => {
  for (const key of [
    'postalArrivalInvalid',
    'postalTrackingUrlInvalid',
    'postalTrackingNoteInvalid',
    'postalTrackingUrlHelp',
    'postalTrackingNoteHelp',
    'postalTrackingUnconfirmed',
    'postalTrackingRetry',
    'progressNoteHelp',
    'progressNoteInvalid',
    'progressActionUnconfirmed',
    'progressValidationUnavailable',
    'progressRetryCommand',
  ]) {
    expect(tSolar(key, 'en')).not.toBe(key);
    expect(tSolar(key, 'fa')).not.toBe(key);
    expect(tSolar(key, 'en')).not.toBe(tSolar(key, 'fa'));
  }
  expect(tSolar('postalTrackingUrlInvalid', 'en')).toContain('2,000');
  expect(tSolar('postalTrackingNoteInvalid', 'en')).toContain('1,000');
  expect(tSolar('progressNoteInvalid', 'en')).toContain('1,000');
  expect(tSolar('postalArrivalInvalid', 'en')).toContain('sending date');
  expect(tSolar('postalTrackingUnconfirmed', 'en')).toContain('same reviewed update');
  expect(tSolar('progressNoteHelp', 'en')).toContain('customer');
});
