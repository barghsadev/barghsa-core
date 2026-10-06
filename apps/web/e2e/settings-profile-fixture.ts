import type { SettingsProfile } from '../src/lib/settings-form';

export const settingsProfileId = '01900000-0000-7000-8000-000000000001';
const timestamp = '2026-10-01T00:00:00Z';

/** Complete API metadata for tests that vary one profile field or acknowledgement. */
export function settingsProfileFixture(input: Record<string, unknown>): SettingsProfile {
  const legal = input.legalInfo as Record<string, unknown> | undefined;
  const addresses = (input.addresses ?? []) as Record<string, unknown>[];
  return {
    isDefault: true,
    title: null,
    firstName: null,
    lastName: null,
    nationalId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    legalInfo: null,
    ...input,
    addresses: addresses.map((address) => ({
      profileId: input.id,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...address,
    })),
    ...(legal
      ? {
          legalInfo: {
            companyTypeId: null,
            economicCode: null,
            representativeTitle: 'Manager',
            representativeRelationship: 'Director',
            ...legal,
          },
        }
      : {}),
  } as SettingsProfile;
}
