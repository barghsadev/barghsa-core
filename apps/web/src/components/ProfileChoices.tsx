import { useId } from 'react';
import { Check } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { Badge, RadioGroup, RadioGroupItem } from '@barghsa/ui';
import { ProfileAvatar, profileName, ProfileTypeBadge } from './ProfileIdentity.js';
import type { SwitcherProfile } from './ProfileSwitcher.js';
export interface ProfileChoicesProps {
  data: { profiles: SwitcherProfile[]; activeProfileId: string | null };
  locale: Locale;
  onSelect: (id: string) => Promise<void>;
}
export default function ProfileChoices({ data, locale, onSelect }: ProfileChoicesProps) {
  const prefix = useId();
  return (
    <RadioGroup
      value={data.activeProfileId ?? ''}
      onValueChange={(id) => {
        if (typeof id === 'string') void onSelect(id);
      }}
      aria-label={t('dashboard.profile.switchLabel', locale)}
    >
      {data.profiles.map((profile) => (
        <label
          key={profile.id}
          htmlFor={prefix + profile.id}
          className="flex min-h-16 cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-muted"
        >
          <RadioGroupItem
            id={prefix + profile.id}
            value={profile.id}
            data-profile-id={profile.id}
            aria-labelledby={prefix + profile.id + '-label'}
          />
          <span id={prefix + profile.id + '-label'} className="contents">
            <ProfileAvatar profile={profile} locale={locale} />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block break-words font-medium">{profileName(profile, locale)}</span>
              <span className="flex flex-wrap gap-1">
                <ProfileTypeBadge profile={profile} locale={locale} />
                <Badge variant="outline">
                  {t(
                    profile.status === 'VERIFIED'
                      ? 'dashboard.profile.verified'
                      : 'dashboard.profile.unverified',
                    locale
                  )}
                </Badge>
              </span>
            </span>
            {profile.id === data.activeProfileId && (
              <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
            )}
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}
