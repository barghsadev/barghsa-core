import { expect, it } from 'vitest';
import { parseOnboardingProfile } from './onboarding-profile.js';
const receipt = {
  id: 'profile',
  profileType: 'INDIVIDUAL',
  isDefault: true,
  status: 'PENDING_VERIFICATION',
  firstName: ' Person ',
  lastName: ' Owner ',
};
it('summarizes the exact finalized personal profile without claiming verification', () => {
  expect(parseOnboardingProfile(receipt, 'profile', 'INDIVIDUAL')).toEqual({
    id: 'profile',
    profileType: 'INDIVIDUAL',
    isDefault: true,
    status: 'PENDING_VERIFICATION',
    name: 'Person Owner',
  });
});
it('uses the finalized company name', () => {
  expect(
    parseOnboardingProfile(
      { ...receipt, profileType: 'LEGAL', title: ' Company ' },
      'profile',
      'LEGAL'
    ).name
  ).toBe('Company');
});
it.each([
  null,
  [],
  {},
  { ...receipt, id: 'other' },
  { ...receipt, status: 'DRAFT' },
  { ...receipt, isDefault: 'true' },
  { ...receipt, firstName: '' },
  { ...receipt, lastName: null },
  { ...receipt, profileType: 'LEGAL', title: '' },
])('rejects incomplete, unfinalized and mismatched receipts %j', (input) => {
  expect(() => parseOnboardingProfile(input, 'profile')).toThrow();
});
it('rejects a different profile type even with the same ID', () => {
  expect(() => parseOnboardingProfile(receipt, 'profile', 'LEGAL')).toThrow();
});
