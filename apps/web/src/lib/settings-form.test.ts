import { describe, expect, it } from 'vitest';
import {
  addressPatch,
  addressReceipt,
  profileConfirmation,
  profilePatch,
  profilePatchAuthorized,
  profileReceipt,
  profileValues,
  savedAddress,
  settingsAddresses,
  settingsContext,
  settingsProfile,
  type SavedAddress,
  type SettingsProfile,
} from './settings-form.js';
import {
  profileSettingsSchema,
  savedAddressSchema,
  settingsInactiveSchema,
} from './settings-form-schemas.js';

const profileId = '10000000-0000-4000-8000-000000000001';
const addressId = '20000000-0000-4000-8000-000000000002';
const provinceId = '30000000-0000-4000-8000-000000000003';
const cityId = '40000000-0000-4000-8000-000000000004';
const otherId = '50000000-0000-4000-8000-000000000005';
const stamp = '2026-10-05T09:00:00.123Z';
const address: SavedAddress = {
  id: addressId,
  profileId,
  provinceId,
  cityId,
  fullAddress: 'Old main address',
  postalCode: '1234512345',
  mainAddress: true,
  createdAt: stamp,
  updatedAt: stamp,
};
const profile: SettingsProfile = {
  id: profileId,
  profileType: 'INDIVIDUAL',
  isDefault: true,
  status: 'ACTIVE',
  title: null,
  firstName: 'First',
  lastName: 'Last',
  nationalId: null,
  createdAt: stamp,
  updatedAt: stamp,
  canEditIdentity: true,
  addresses: [address],
  legalInfo: null,
};
const legal: SettingsProfile = {
  ...profile,
  profileType: 'LEGAL',
  canEditIdentity: false,
  legalInfo: {
    legalName: 'Company',
    nationalIdentifier: '10101010101',
    registrationNumber: '123',
    companyTypeId: 'private-joint-stock',
    economicCode: null,
    representativeTitle: 'Director',
    representativeRelationship: 'authorized',
    representativeFirstName: null,
    representativeLastName: null,
    representativeNationalId: null,
    representativeFullAddress: null,
    representativePostalCode: null,
  },
};
const copy = (key: string) => key;
const offeredProvince = (id: string) => id === provinceId;
const offeredCity = (id: string, parent: string) => id === cityId && parent === provinceId;
const projection = (source: SettingsProfile) => ({
  id: source.id,
  profileType: source.profileType,
  isDefault: source.isDefault,
  status: source.status,
  title: source.title,
  firstName: source.firstName,
  lastName: source.lastName,
  nationalId: source.nationalId,
  updatedAt: source.updatedAt,
});

describe('settings forms confirm actual authorized receipts before clearing drafts', () => {
  it('accepts actual legal detail with text company-type IDs and nullable legacy representatives', () => {
    expect(settingsProfile(legal, profileId)).toEqual(legal);
    expect(settingsProfile({ ...legal, legalInfo: null }, profileId)).not.toBeNull();
    for (const legalInfo of [
      { ...legal.legalInfo, companyTypeId: 1 },
      { ...legal.legalInfo, representativeFirstName: [] },
      { ...legal.legalInfo, legalName: null },
    ])
      expect(settingsProfile({ ...legal, legalInfo }, profileId)).toBeNull();
    expect(settingsProfile({ ...profile, legalInfo: legal.legalInfo }, profileId)).toBeNull();
    expect(settingsProfile({ ...profile, canEditIdentity: 'yes' }, profileId)).toBeNull();
    expect(settingsProfile(profile, otherId)).toBeNull();
  });

  it('rejects ambiguous context and address lists instead of accepting foreign or duplicate rows', () => {
    const context = {
      profiles: [projection(profile)],
      activeProfileId: profileId,
      hasDefault: true,
    };
    expect(settingsContext(context)?.activeProfileId).toBe(profileId);
    expect(
      settingsContext({ ...context, profiles: [...context.profiles, ...context.profiles] })
    ).toBeNull();
    expect(settingsContext({ ...context, activeProfileId: otherId })).toBeNull();
    expect(
      settingsContext({ ...context, profiles: [{ ...projection(profile), title: undefined }] })
    ).toBeNull();
    expect(settingsAddresses({ addresses: [address] }, profileId)).toEqual([address]);
    expect(
      settingsAddresses({ addresses: [address, { ...address, mainAddress: false }] }, profileId)
    ).toBeNull();
    expect(
      settingsAddresses({ addresses: [address, { ...address, id: otherId }] }, profileId)
    ).toBeNull();
    expect(
      settingsAddresses({ addresses: [{ ...address, profileId: otherId }] }, profileId)
    ).toBeNull();
    expect(settingsAddresses({ addresses: [] }, profileId)).toEqual([]);
  });

  it('captures only eligible identity changes and the complete profile main-address group', () => {
    const values = profileValues(profile);
    expect(profilePatch({ ...values, title: ' New title ' }, profile)).toEqual({
      title: 'New title',
    });
    expect(profilePatch({ ...values, fullAddress: ' New address ' }, profile)).toEqual({
      provinceId,
      cityId,
      fullAddress: 'New address',
      postalCode: address.postalCode,
    });
    const verified = { ...profile, status: 'VERIFIED' as const, canEditIdentity: false };
    expect(
      profilePatch({ ...values, firstName: 'Hidden change', title: 'Title' }, verified)
    ).toEqual({ title: 'Title' });
    expect(profilePatchAuthorized(verified, { firstName: 'Hidden change' })).toBe(false);
    expect(
      profilePatchAuthorized({ ...verified, canEditIdentity: true }, { firstName: 'Own staff' })
    ).toBe(true);
    expect(profilePatchAuthorized(profile, { legalName: 'Wrong type' })).toBe(false);
    expect(profilePatchAuthorized({ ...legal, status: 'VERIFIED' }, { legalName: 'Locked' })).toBe(
      false
    );
  });

  it('omits unchanged historical geography from saved-address edits and captures every create field', () => {
    const values = {
      provinceId,
      cityId,
      fullAddress: address.fullAddress,
      postalCode: address.postalCode,
    };
    expect(addressPatch({ ...values, fullAddress: ' Edited ' }, address)).toEqual({
      fullAddress: 'Edited',
    });
    expect(addressPatch(values, address)).toEqual({});
    expect(addressPatch({ ...values, fullAddress: ' New ' }, null)).toEqual({
      ...values,
      fullAddress: 'New',
    });
  });

  it('validates only changed permitted profile fields, without blocking title-only legacy records', () => {
    const legacy = { ...profile, nationalId: 'legacy', addresses: [] };
    const schema = profileSettingsSchema(
      copy,
      () => legacy,
      profilePatch,
      () => false,
      () => false
    );
    const values = profileValues(legacy);
    expect(schema.safeParse({ ...values, title: ' New title ' }).success).toBe(true);
    expect(schema.safeParse({ ...values, title: 't'.repeat(51) }).success).toBe(false);
    expect(schema.safeParse({ ...values, nationalId: '0000000000' }).success).toBe(false);
    expect(schema.safeParse({ ...values, firstName: ' ' }).success).toBe(false);
    expect(schema.safeParse({ ...values, lastName: 'n'.repeat(101) }).success).toBe(false);
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse({ ...values, title: [] }).success).toBe(false);
    expect(
      profileSettingsSchema(copy, () => null, profilePatch, offeredProvince, offeredCity).safeParse(
        values
      ).success
    ).toBe(false);
    expect(settingsInactiveSchema.safeParse(values).success).toBe(false);
  });

  it('requires active related geography for a changed profile main address but preserves an unchanged saved pair', () => {
    const values = profileValues(profile);
    const active = profileSettingsSchema(
      copy,
      () => profile,
      profilePatch,
      offeredProvince,
      offeredCity
    );
    expect(active.safeParse({ ...values, fullAddress: ' New address ' }).success).toBe(true);
    expect(active.safeParse({ ...values, fullAddress: 'x'.repeat(501) }).success).toBe(false);
    expect(active.safeParse({ ...values, cityId: otherId }).success).toBe(false);
    expect(active.safeParse({ ...values, postalCode: '0000000000' }).success).toBe(false);
    expect(
      profileSettingsSchema(
        copy,
        () => profile,
        profilePatch,
        () => false,
        () => false
      ).safeParse({ ...values, fullAddress: 'New' }).success
    ).toBe(false);
    const saved = savedAddressSchema(
      copy,
      () => address,
      () => false,
      () => false
    );
    expect(saved.safeParse({ ...values, fullAddress: 'Edited historical address' }).success).toBe(
      true
    );
    expect(saved.safeParse({ ...values, cityId: otherId }).success).toBe(false);
    const create = savedAddressSchema(copy, () => null, offeredProvince, offeredCity);
    expect(create.safeParse(values).success).toBe(true);
    expect(create.safeParse({ ...values, provinceId: otherId }).success).toBe(false);
  });

  it('accepts the actual profile PUT projection while refusing unrelated or malformed acknowledgements', () => {
    const receipt = {
      ...projection(profile),
      title: 'New title',
      isDefault: false,
      status: 'VERIFIED',
    };
    expect(profileReceipt(receipt, profile, { title: 'New title' })).toBe(true);
    expect(Object.hasOwn(receipt, 'addresses')).toBe(false);
    expect(Object.hasOwn(receipt, 'legalInfo')).toBe(false);
    expect(profileReceipt(projection(legal), legal, { legalName: 'New company' })).toBe(true);
    expect(profileReceipt({ ...receipt, title: null }, profile, { title: '' })).toBe(true);
    expect(profileReceipt({ ...receipt, title: null }, profile, { title: 'New title' })).toBe(
      false
    );
    expect(profileConfirmation({ ...profile, title: null }, profile, { title: '' })).toEqual(
      profile
    );
    for (const change of [
      { id: otherId },
      { profileType: 'LEGAL' },
      { title: 'Other title' },
      { updatedAt: 'not a date' },
      { firstName: undefined },
      { isDefault: null },
    ])
      expect(profileReceipt({ ...receipt, ...change }, profile, { title: 'New title' })).toBe(
        false
      );
    expect(profileReceipt([receipt], profile, { title: 'New title' })).toBe(false);
  });

  it('requires authorized current detail to prove legal and main-address changes absent from PUT', () => {
    const patch = { legalName: 'New company', fullAddress: 'New main address' };
    const changed = {
      ...legal,
      isDefault: false,
      legalInfo: { ...legal.legalInfo!, legalName: patch.legalName },
      addresses: [{ ...address, id: otherId, fullAddress: patch.fullAddress }],
    };
    expect(profileConfirmation(projection(legal), legal, patch)).toBeNull();
    expect(profileConfirmation(legal, legal, patch)).toBeNull();
    expect(profileConfirmation(changed, legal, patch)).toEqual(changed);
    expect(profileConfirmation({ ...changed, status: 'VERIFIED' }, legal, patch)).toBeNull();
    expect(
      profileConfirmation(
        { ...changed, addresses: [{ ...address, mainAddress: false }] },
        legal,
        patch
      )
    ).toBeNull();
    expect(profileConfirmation({ ...changed, id: otherId }, legal, patch)).toBeNull();
    const identityPatch = { firstName: 'Own staff' };
    const verified = {
      ...profile,
      status: 'VERIFIED' as const,
      firstName: identityPatch.firstName,
      canEditIdentity: true,
    };
    expect(profileConfirmation(verified, profile, identityPatch)).toEqual(verified);
    expect(
      profileConfirmation({ ...verified, canEditIdentity: false }, profile, identityPatch)
    ).toBeNull();
  });

  it('accepts original address receipts despite server-owned main changes but checks owning identity and leaves', () => {
    const patch = { fullAddress: 'Edited' };
    const edited = { ...address, fullAddress: patch.fullAddress, mainAddress: false };
    expect(addressReceipt(edited, profileId, address, patch)).toBe(true);
    expect(addressReceipt({ ...edited, id: otherId }, profileId, address, patch)).toBe(false);
    expect(addressReceipt(address, profileId, address, patch)).toBe(false);
    expect(addressReceipt({ ...edited, profileId: otherId }, profileId, address, patch)).toBe(
      false
    );
    expect(
      addressReceipt({ ...address, id: otherId }, profileId, null, addressPatch(address, null))
    ).toBe(true);
    expect(
      savedAddress({ ...address, provinceNameEn: 'Province', cityNameFa: 'شهر' }, profileId)
    ).toBe(true);
    expect(savedAddress({ ...address, provinceNameEn: null }, profileId)).toBe(false);
    expect(savedAddress({ ...address, updatedAt: false }, profileId)).toBe(false);
    expect(savedAddress({ ...address, mainAddress: 'true' }, profileId)).toBe(false);
  });
});
