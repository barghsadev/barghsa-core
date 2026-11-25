import { lazy, Suspense, useId } from 'react';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { queryKeys } from '../lib/query-keys.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import type { SwitcherProfile } from './ProfileSwitcher.js';

const DefaultProfileChoiceDialog = lazy(() => import('./DefaultProfileChoiceDialog.js'));

interface ProfilesResponse {
  profiles: SwitcherProfile[];
  hasDefault: boolean;
  activeProfileId: string | null;
}

/**
 * DefaultProfileModal (T-03.03.02).
 *
 * On login, if the user has multiple profiles but no default profile set,
 * this forced modal blocks navigation until the user selects one. The
 * modal is non-dismissible — no backdrop click, no escape key, no close
 * button — because without a default profile the app cannot determine
 * which profile's data to show.
 *
 * - Fetches the profile list from `GET /api/profiles`.
 * - If `hasDefault === false && profiles.length > 1`, renders the modal.
 * - Radio-group list of profiles; user selects one and clicks "Set as default".
 * - Calls `POST /api/profiles/switch/:id`, then remounts profile-scoped state without reloading the document.
 * - Renders nothing when the user has a default, only one profile, or none.
 */
export function DefaultProfileModal({ accountId = null }: { accountId?: string | null } = {}) {
  const revision = useProfileContextRevision();
  return (
    <OwnedDefaultProfileModal
      key={JSON.stringify([accountId, revision])}
      accountId={accountId}
      revision={revision}
    />
  );
}
function OwnedDefaultProfileModal({
  accountId,
  revision,
}: {
  accountId: string | null;
  revision: number;
}) {
  const reader = useId();
  const profileQuery = useServerDetailQuery<ProfilesResponse>({
    queryKey: queryKeys.profiles.authority(
      { context: 'account', ownerId: accountId ?? 'current-session', accountId, revision },
      reader
    ),
    manual: true,
    read: async (signal) => {
      const response = await fetch('/api/profiles', {
        credentials: 'include',
        signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error();
      return response.json();
    },
  });
  const profiles = profileQuery.data?.profiles;
  if (!Array.isArray(profiles) || profileQuery.data?.hasDefault || profiles.length <= 1)
    return null;

  return (
    <Suspense fallback={null}>
      <DefaultProfileChoiceDialog profiles={profiles} revision={revision} />
    </Suspense>
  );
}
