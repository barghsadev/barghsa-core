export type SettingsProfileSummary = {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  displayName?: string | null;
  isDefault: boolean;
  status: 'DRAFT' | 'ACTIVE' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'SUSPENDED';
  title: string | null;
  firstName: string | null;
  lastName: string | null;
  nationalId: string | null;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
export const settingsUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const nullableText = (v: unknown) => v === null || typeof v === 'string';
export const profileRow = (v: unknown): v is SettingsProfileSummary & Record<string, unknown> =>
  object(v) &&
  settingsUuid(v.id) &&
  (v.profileType === 'INDIVIDUAL' || v.profileType === 'LEGAL') &&
  (v.displayName === undefined || nullableText(v.displayName)) &&
  typeof v.isDefault === 'boolean' &&
  typeof v.status === 'string' &&
  ['DRAFT', 'ACTIVE', 'PENDING_VERIFICATION', 'VERIFIED', 'SUSPENDED'].includes(v.status) &&
  ['title', 'firstName', 'lastName', 'nationalId'].every((key) => nullableText(v[key]));
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
