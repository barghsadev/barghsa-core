import { parseOnboardingProfile, type OnboardingProfile } from './onboarding-profile.js';

export type OnboardingJourneyProfile = Omit<OnboardingProfile, 'status'> & {
  status: OnboardingProfile['status'] | 'DRAFT';
};
export interface OnboardingJourney {
  id: string;
  profiles: OnboardingJourneyProfile[];
  completed: boolean;
  selectedProfileId: string | null;
  activeProfileId: string | null;
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function parseOnboardingJourney(input: unknown, expectedId?: string): OnboardingJourney {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid setup');
  const row = input as Record<string, unknown>;
  if (
    !uuid(row.id) ||
    (expectedId && row.id !== expectedId) ||
    typeof row.completed !== 'boolean' ||
    !Array.isArray(row.profiles) ||
    row.profiles.length < 1 ||
    row.profiles.length > 2 ||
    (row.activeProfileId !== null && !uuid(row.activeProfileId))
  )
    throw new Error('Invalid setup');
  const profiles = row.profiles.map((input): OnboardingJourneyProfile => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid profile');
    const profile = input as Record<string, unknown>;
    if (!uuid(profile.id)) throw new Error('Invalid profile');
    if (profile.status !== 'DRAFT') return parseOnboardingProfile(profile, profile.id);
    if (
      (profile.profileType !== 'INDIVIDUAL' && profile.profileType !== 'LEGAL') ||
      typeof profile.isDefault !== 'boolean'
    )
      throw new Error('Invalid draft');
    return {
      id: profile.id,
      profileType: profile.profileType,
      status: 'DRAFT',
      isDefault: profile.isDefault,
      name: '',
    };
  });
  if (
    new Set(profiles.map((p) => p.id)).size !== profiles.length ||
    new Set(profiles.map((p) => p.profileType)).size !== profiles.length ||
    (profiles.length === 2 && profiles[0]?.profileType !== 'INDIVIDUAL') ||
    (row.completed
      ? !profiles.some((p) => p.id === row.selectedProfileId) ||
        profiles.some((p) => p.status === 'DRAFT')
      : row.selectedProfileId !== null)
  )
    throw new Error('Unexpected setup');
  return {
    id: row.id,
    profiles,
    completed: row.completed,
    selectedProfileId: row.selectedProfileId as string | null,
    activeProfileId: row.activeProfileId as string | null,
  };
}

export function onboardingDestination(journey: OnboardingJourney) {
  const next = journey.profiles.find((profile) => profile.status === 'DRAFT');
  if (!next)
    return {
      to: '/onboarding/complete' as const,
      search: { journeyId: journey.id },
      replace: true,
    };
  return {
    to:
      next.profileType === 'INDIVIDUAL'
        ? ('/onboarding/individual/$profileId' as const)
        : ('/onboarding/legal/$profileId' as const),
    params: { profileId: next.id },
    replace: true,
  };
}
