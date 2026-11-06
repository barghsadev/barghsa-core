import type { ReactNode } from 'react';
import type { Locale } from '@barghsa/i18n/workspace';
import { ProfileWorkspaceProvider, ProfileSwitcher, ProfileBadge } from './ProfileSwitcher.js';

/** Customer-only authority and commands; callers retain their shared frame and permissions. */
export function CustomerProfileWorkspace({
  locale,
  children,
}: {
  locale: Locale;
  children: (picker: ReactNode, badge: ReactNode) => ReactNode;
}) {
  return (
    <ProfileWorkspaceProvider locale={locale}>
      {children(<ProfileSwitcher locale={locale} />, <ProfileBadge locale={locale} />)}
    </ProfileWorkspaceProvider>
  );
}
