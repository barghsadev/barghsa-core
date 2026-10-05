export type SavedAddress = {
  id: string;
  profileId: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
  createdAt: string;
  updatedAt: string;
  provinceNameFa?: string;
  provinceNameEn?: string;
  cityNameFa?: string;
  cityNameEn?: string;
};
export type SettingsProfileSummary = {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  isDefault: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'SUSPENDED';
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
};
export type SettingsLegalInfo = {
  legalName: string;
  nationalIdentifier: string;
  registrationNumber: string;
  companyTypeId: string | null;
  economicCode: string | null;
  representativeTitle: string;
  representativeRelationship: string;
  representativeFirstName?: string | null;
  representativeLastName?: string | null;
  representativeNationalId?: string | null;
  representativeFullAddress?: string | null;
  representativePostalCode?: string | null;
};
export type SettingsProfile = SettingsProfileSummary & {
  canEditIdentity?: boolean;
  createdAt: string;
  updatedAt: string;
  addresses: SavedAddress[];
  legalInfo: SettingsLegalInfo | null;
};
export type AddressFormValues = {
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
};
export type ProfileFormValues = AddressFormValues & {
  title: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  legalName: string;
  nationalIdentifier: string;
};
export const addressFormFields = ['provinceId', 'cityId', 'fullAddress', 'postalCode'] as const;
export const profileFormFields = [
  'title',
  'firstName',
  'lastName',
  'nationalId',
  'legalName',
  'nationalIdentifier',
  ...addressFormFields,
] as const;
export const emptyAddress: AddressFormValues = {
  provinceId: '',
  cityId: '',
  fullAddress: '',
  postalCode: '',
};
export const emptyProfile: ProfileFormValues = {
  ...emptyAddress,
  title: '',
  firstName: '',
  lastName: '',
  nationalId: '',
  legalName: '',
  nationalIdentifier: '',
};
export type SettingsPatch = Partial<ProfileFormValues>;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const settingsUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const date = (v: unknown) =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));
const nullableText = (v: unknown) => v === null || typeof v === 'string';
const profileRow = (v: unknown): v is SettingsProfileSummary & Record<string, unknown> =>
  object(v) &&
  settingsUuid(v.id) &&
  (v.profileType === 'INDIVIDUAL' || v.profileType === 'LEGAL') &&
  typeof v.isDefault === 'boolean' &&
  typeof v.status === 'string' &&
  ['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED', 'SUSPENDED'].includes(v.status) &&
  ['title', 'firstName', 'lastName', 'nationalId'].every((key) => nullableText(v[key]));
export function savedAddress(v: unknown, profileId: string): v is SavedAddress {
  return (
    object(v) &&
    settingsUuid(v.id) &&
    v.profileId === profileId &&
    settingsUuid(v.provinceId) &&
    settingsUuid(v.cityId) &&
    typeof v.fullAddress === 'string' &&
    typeof v.postalCode === 'string' &&
    typeof v.mainAddress === 'boolean' &&
    date(v.createdAt) &&
    date(v.updatedAt) &&
    ['provinceNameFa', 'provinceNameEn', 'cityNameFa', 'cityNameEn'].every(
      (key) => v[key] === undefined || typeof v[key] === 'string'
    )
  );
}
export function settingsAddresses(v: unknown, profileId: string): SavedAddress[] | null {
  if (
    !object(v) ||
    !Array.isArray(v.addresses) ||
    !v.addresses.every((row) => savedAddress(row, profileId))
  )
    return null;
  const rows = v.addresses as SavedAddress[];
  if (
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    rows.filter((row) => row.mainAddress).length > 1
  )
    return null;
  return rows;
}
export function settingsContext(v: unknown): {
  profiles: SettingsProfileSummary[];
  activeProfileId: string | null;
  hasDefault: boolean;
} | null {
  if (
    !object(v) ||
    !Array.isArray(v.profiles) ||
    !v.profiles.every(profileRow) ||
    typeof v.hasDefault !== 'boolean' ||
    (v.activeProfileId !== null && !settingsUuid(v.activeProfileId))
  )
    return null;
  const rows = v.profiles as SettingsProfileSummary[];
  if (
    new Set(rows.map((row) => row.id)).size !== rows.length ||
    (v.activeProfileId !== null && !rows.some((row) => row.id === v.activeProfileId))
  )
    return null;
  return {
    profiles: rows,
    activeProfileId: v.activeProfileId as string | null,
    hasDefault: v.hasDefault,
  };
}
export function settingsProfile(v: unknown, id: string): SettingsProfile | null {
  if (
    !profileRow(v) ||
    v.id !== id ||
    !object(v) ||
    !date(v.createdAt) ||
    !date(v.updatedAt) ||
    (v.canEditIdentity !== undefined && typeof v.canEditIdentity !== 'boolean')
  )
    return null;
  const rows = settingsAddresses({ addresses: v.addresses }, id);
  if (!rows) return null;
  const legal = v.legalInfo;
  if (
    v.profileType === 'INDIVIDUAL'
      ? legal !== null
      : legal !== null &&
        (!object(legal) ||
          [
            'legalName',
            'nationalIdentifier',
            'registrationNumber',
            'representativeTitle',
            'representativeRelationship',
          ].some((key) => typeof legal[key] !== 'string') ||
          !nullableText(legal.companyTypeId) ||
          !nullableText(legal.economicCode) ||
          [
            'representativeFirstName',
            'representativeLastName',
            'representativeNationalId',
            'representativeFullAddress',
            'representativePostalCode',
          ].some((key) => legal[key] !== undefined && !nullableText(legal[key])))
  )
    return null;
  return { ...v, addresses: rows } as SettingsProfile;
}
export function profileCanEditIdentity(profile: SettingsProfile) {
  return (
    profile.profileType === 'INDIVIDUAL' &&
    (profile.status !== 'VERIFIED' || profile.canEditIdentity === true)
  );
}
export function profileValues(profile: SettingsProfile): ProfileFormValues {
  const main = profile.addresses.find((row) => row.mainAddress);
  return {
    title: profile.title ?? '',
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    nationalId: profile.nationalId ?? '',
    legalName: profile.legalInfo?.legalName ?? '',
    nationalIdentifier: profile.legalInfo?.nationalIdentifier ?? '',
    provinceId: main?.provinceId ?? '',
    cityId: main?.cityId ?? '',
    fullAddress: main?.fullAddress ?? '',
    postalCode: main?.postalCode ?? '',
  };
}
export function profilePatch(raw: ProfileFormValues, source: SettingsProfile): SettingsPatch {
  const previous = profileValues(source),
    patch: SettingsPatch = {};
  const fields: (keyof ProfileFormValues)[] = ['title'];
  if (profileCanEditIdentity(source)) fields.push('firstName', 'lastName', 'nationalId');
  if (source.profileType === 'LEGAL' && source.status !== 'VERIFIED' && source.legalInfo)
    fields.push('legalName', 'nationalIdentifier');
  for (const key of fields) if (raw[key] !== previous[key]) patch[key] = raw[key].trim();
  if (addressFormFields.some((key) => raw[key] !== previous[key]))
    for (const key of addressFormFields) patch[key] = raw[key].trim();
  return patch;
}
export function addressPatch(
  raw: AddressFormValues,
  source: SavedAddress | null
): AddressFormValues | Partial<AddressFormValues> {
  const patch: Partial<AddressFormValues> = {};
  for (const key of addressFormFields)
    if (!source || raw[key] !== source[key]) patch[key] = raw[key].trim();
  return patch;
}
export function profilePatchAuthorized(source: SettingsProfile, patch: SettingsPatch) {
  if (
    ['firstName', 'lastName', 'nationalId'].some((key) => Object.hasOwn(patch, key)) &&
    !profileCanEditIdentity(source)
  )
    return false;
  if (
    ['legalName', 'nationalIdentifier'].some((key) => Object.hasOwn(patch, key)) &&
    !(source.profileType === 'LEGAL' && source.status !== 'VERIFIED' && source.legalInfo)
  )
    return false;
  return true;
}
export function profileReceipt(v: unknown, source: SettingsProfile, patch: SettingsPatch): boolean {
  if (
    !profileRow(v) ||
    v.id !== source.id ||
    v.profileType !== source.profileType ||
    !object(v) ||
    !date(v.updatedAt)
  )
    return false;
  return ['title', 'firstName', 'lastName', 'nationalId'].every(
    (key) =>
      !Object.hasOwn(patch, key) ||
      v[key] === patch[key as keyof SettingsPatch] ||
      (key === 'title' && patch.title === '' && v.title === null)
  );
}
export function profileConfirmation(
  v: unknown,
  source: SettingsProfile,
  patch: SettingsPatch
): SettingsProfile | null {
  const current = settingsProfile(v, source.id);
  if (
    !current ||
    current.profileType !== source.profileType ||
    !profilePatchAuthorized(current, patch)
  )
    return null;
  const values = profileValues(current);
  return Object.entries(patch).every(
    ([key, value]) => values[key as keyof ProfileFormValues] === value
  )
    ? current
    : null;
}
export function addressReceipt(
  v: unknown,
  profileId: string,
  source: SavedAddress | null,
  patch: Partial<AddressFormValues>
): v is SavedAddress {
  return (
    savedAddress(v, profileId) &&
    (!source || v.id === source.id) &&
    Object.entries(patch).every(([key, value]) => v[key as keyof AddressFormValues] === value)
  );
}
export type SettingsOwner = 'profile' | 'default' | 'address' | 'main' | 'delete' | 'read';
export type SettingsCoordination = {
  claim: (owner: SettingsOwner) => boolean;
  release: (owner: SettingsOwner) => void;
  isLocked: () => boolean;
  isCurrent: () => boolean;
  denied: () => void;
};
