import { useId, type ReactNode } from 'react';
import { RadioGroup, RadioGroupItem } from '@barghsa/ui';
import type { SwitcherProfile } from './ProfileSwitcher.js';
export interface ProfileChoicesProps {
  data: { profiles: SwitcherProfile[]; activeProfileId: string | null };
  label: string;
  renderProfile: (profile: SwitcherProfile) => ReactNode;
  onSelect: (id: string) => Promise<void>;
}
export default function ProfileChoices({
  data,
  label,
  renderProfile,
  onSelect,
}: ProfileChoicesProps) {
  const prefix = useId();
  return (
    <RadioGroup
      value={data.activeProfileId ?? ''}
      onValueChange={(id) => {
        if (typeof id === 'string') void onSelect(id);
      }}
      aria-label={label}
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
            {renderProfile(profile)}
          </span>
        </label>
      ))}
    </RadioGroup>
  );
}
