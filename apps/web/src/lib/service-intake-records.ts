export interface IntakeAddress {
  id: string;
  profileId: string;
  provinceId: string;
  cityId: string;
  fullAddress: string;
  postalCode: string;
  mainAddress: boolean;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function readIntakeProfile(value: unknown): { id: string; type: unknown } | null {
  if (!record(value) || !Array.isArray(value.profiles)) throw new Error('Invalid profile list');
  const id = value.activeProfileId;
  if (id === null) return null;
  if (typeof id !== 'string' || !/^[\w-]+$/.test(id)) throw new Error('Invalid active profile');
  const selected = value.profiles.filter(
    (row: unknown): row is Record<string, unknown> => record(row) && row.id === id
  );
  const [profile] = selected;
  if (!profile || selected.length !== 1) throw new Error('Invalid active profile');
  return { id, type: profile.profileType ?? profile.type };
}

export function readIntakeAddresses(value: unknown, profileId: string): IntakeAddress[] {
  if (!record(value) || !Array.isArray(value.addresses)) throw new Error('Invalid saved addresses');
  const rows = value.addresses;
  if (
    !rows.every(
      (row: unknown): row is IntakeAddress =>
        record(row) &&
        row.profileId === profileId &&
        typeof row.id === 'string' &&
        !!row.id &&
        typeof row.provinceId === 'string' &&
        typeof row.cityId === 'string' &&
        typeof row.fullAddress === 'string' &&
        typeof row.postalCode === 'string' &&
        typeof row.mainAddress === 'boolean'
    )
  )
    throw new Error('Invalid saved addresses');
  return rows;
}
