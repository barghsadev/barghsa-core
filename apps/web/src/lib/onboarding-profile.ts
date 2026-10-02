export interface OnboardingProfile {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  status: 'ACTIVE' | 'PENDING_VERIFICATION' | 'VERIFIED';
  isDefault: boolean;
  name: string;
}
export function parseOnboardingProfile(
  input: unknown,
  profileId: string,
  expectedType?: OnboardingProfile['profileType']
): OnboardingProfile {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid profile receipt');
  const row = input as Record<string, unknown>;
  if (
    row.id !== profileId ||
    (row.profileType !== 'INDIVIDUAL' && row.profileType !== 'LEGAL') ||
    (expectedType && row.profileType !== expectedType) ||
    typeof row.isDefault !== 'boolean' ||
    (row.status !== 'ACTIVE' && row.status !== 'PENDING_VERIFICATION' && row.status !== 'VERIFIED')
  )
    throw new Error('Unexpected profile receipt');
  const name =
    row.profileType === 'LEGAL'
      ? row.title
      : typeof row.firstName === 'string' &&
          row.firstName.trim() &&
          typeof row.lastName === 'string' &&
          row.lastName.trim()
        ? `${row.firstName.trim()} ${row.lastName.trim()}`.trim()
        : undefined;
  if (typeof name !== 'string' || !name.trim()) throw new Error('Missing profile name');
  return {
    id: profileId,
    profileType: row.profileType,
    status: row.status,
    isDefault: row.isDefault,
    name: name.trim(),
  };
}
