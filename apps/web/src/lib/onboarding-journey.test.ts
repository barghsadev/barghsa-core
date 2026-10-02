import { expect, it } from 'vitest';
import { parseOnboardingJourney } from './onboarding-journey.js';
const id = '11111111-1111-4111-8111-111111111111',
  profile = '22222222-2222-4222-8222-222222222222',
  other = '33333333-3333-4333-8333-333333333333';
const draft = { id: profile, profileType: 'INDIVIDUAL', status: 'DRAFT', isDefault: true };
const setup = () => ({
  id,
  completed: false,
  selectedProfileId: null,
  activeProfileId: profile,
  profiles: [draft],
});
it('accepts incomplete drafts without assuming they have completed names', () => {
  expect(parseOnboardingJourney(setup(), id).profiles[0]).toMatchObject({
    id: profile,
    status: 'DRAFT',
    name: '',
  });
});
it('rejects another setup, duplicated identities, and duplicated types', () => {
  expect(() => parseOnboardingJourney(setup(), other)).toThrow();
  expect(() => parseOnboardingJourney({ ...setup(), profiles: [draft, draft] })).toThrow();
  expect(() =>
    parseOnboardingJourney({ ...setup(), profiles: [draft, { ...draft, id: other }] })
  ).toThrow();
});
it('requires a completion receipt to name and select one of its submitted profiles', () => {
  expect(() =>
    parseOnboardingJourney({ ...setup(), completed: true, selectedProfileId: profile })
  ).toThrow();
  expect(() =>
    parseOnboardingJourney({
      ...setup(),
      completed: true,
      selectedProfileId: other,
      profiles: [{ ...draft, status: 'ACTIVE', firstName: 'Person', lastName: 'Owner' }],
    })
  ).toThrow();
  expect(
    parseOnboardingJourney({
      ...setup(),
      completed: true,
      selectedProfileId: profile,
      profiles: [{ ...draft, status: 'ACTIVE', firstName: 'Person', lastName: 'Owner' }],
    }).profiles[0]?.name
  ).toBe('Person Owner');
});
it('rejects missing context metadata, unexpected statuses and malformed successful responses', () => {
  for (const input of [
    null,
    {},
    { ...setup(), activeProfileId: undefined },
    { ...setup(), profiles: [] },
    { ...setup(), profiles: [{ ...draft, status: 'SUSPENDED' }] },
    { ...setup(), selectedProfileId: profile },
  ])
    expect(() => parseOnboardingJourney(input)).toThrow();
});
