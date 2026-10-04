import { expect, it } from 'vitest';
import { tSolar } from './solar.js';
const keys = [
  'documentReasonInvalid',
  'documentDescriptionInvalid',
  'documentGuidanceInvalid',
  'documentSuggestionsInvalid',
  'documentReviewHelp',
  'documentGuidanceHelp',
  'documentSuggestionsHelp',
  'documentValidationUnavailable',
  'documentGuidanceUnconfirmed',
  'documentGuidanceReload',
  'documentGuidanceForbidden',
];
it('provides distinct Persian and English document form help, validation and recovery', () => {
  for (const key of keys) {
    expect(tSolar(key, 'en')).not.toBe(key);
    expect(tSolar(key, 'fa')).not.toBe(key);
    expect(tSolar(key, 'fa')).not.toBe(tSolar(key, 'en'));
  }
  expect(tSolar('documentReasonInvalid', 'en')).toContain('1,000');
  expect(tSolar('documentDescriptionInvalid', 'en')).toContain('2,000');
  expect(tSolar('documentGuidanceInvalid', 'en')).toContain('4,000');
  expect(tSolar('documentSuggestionsInvalid', 'en')).toContain('30');
  expect(tSolar('documentSuggestionsInvalid', 'en')).toContain('200');
});
