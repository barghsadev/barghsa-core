import { Badge } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/workspace';
import type { SwitcherProfile } from './ProfileSwitcher.js';

export function profileName(profile: SwitcherProfile, locale: Locale) {
  return (
    profile.displayName?.trim() ||
    [profile.title, profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
    t('dashboard.profile.unnamed', locale)
  );
}
export function ProfileAvatar({
  profile,
  locale,
  compact = false,
}: {
  profile: SwitcherProfile;
  locale: Locale;
  compact?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold ${compact ? 'size-6 text-xs' : 'size-8 text-sm'}`}
    >
      {Array.from(profileName(profile, locale)).slice(0, 2).join('').toLocaleUpperCase(locale)}
    </span>
  );
}
export function ProfileTypeBadge({
  profile,
  locale,
}: {
  profile: SwitcherProfile;
  locale: Locale;
}) {
  return (
    <Badge variant={profile.profileType === 'LEGAL' ? 'secondary' : 'outline'} className="shrink-0">
      {t(
        profile.profileType === 'LEGAL'
          ? 'dashboard.profile.typeLegal'
          : 'dashboard.profile.typeIndividual',
        locale
      )}
    </Badge>
  );
}
