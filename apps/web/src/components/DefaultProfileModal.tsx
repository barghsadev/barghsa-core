import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { queryKeys } from '../lib/query-keys.js';
import { getProfileContextRevision, useProfileContextRevision } from '../lib/profile-context.js';
import { sendToast } from '../lib/toast-api.js';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import type { SwitcherProfile } from './ProfileSwitcher.js';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@barghsa/ui';
import { Button } from '@barghsa/ui';

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
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => pending.current?.abort(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const isRtl = locale === 'fa';
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

  async function handleSetDefault() {
    if (!resolvedSelected || pending.current) return;
    const target = resolvedSelected;
    const request = new AbortController();
    pending.current = request;
    const owns = () => !request.signal.aborted && getProfileContextRevision() === revision;
    setSetting(true);
    setError(null);

    try {
      const { saveDefaultProfile } = await import('../lib/default-profile-command.js');
      await saveDefaultProfile(target, revision, locale, request.signal);
    } catch {
      if (owns()) {
        const message = t('dashboard.profile.switchError', locale);
        setError(message);
        sendToast('error', message);
      }
    } finally {
      if (owns()) setSetting(false);
      pending.current = null;
    }
  }

  function formatProfileName(profile: SwitcherProfile): string {
    const name =
      profile.displayName?.trim() ||
      [profile.title, profile.firstName, profile.lastName].filter(Boolean).join(' ') ||
      t('dashboard.profile.unnamed', locale);
    const type = t(
      profile.profileType === 'LEGAL'
        ? 'dashboard.profile.typeLegal'
        : 'dashboard.profile.typeIndividual',
      locale
    );
    return `${name} (${type})`;
  }

  // Auto-select the first profile so there's always a valid selection.
  const resolvedSelected = selectedId ?? profiles[0]?.id ?? null;

  return (
    <Dialog
      open={true}
      onOpenChange={() => {
        // Intentionally no-op: the modal is forced and non-dismissible.
      }}
    >
      <DialogContent className="sm:max-w-md" showCloseButton={false} dir={isRtl ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>{t('dashboard.profile.default.title', locale)}</DialogTitle>
          <DialogDescription>
            {t('dashboard.profile.default.description', locale)}
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <div
            role="radiogroup"
            aria-label={t('dashboard.profile.default.title', locale)}
            className="grid w-full gap-2"
          >
            {profiles.map((profile) => (
              <label
                key={profile.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 text-sm font-medium has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="radio"
                  name="default-profile"
                  value={profile.id}
                  checked={resolvedSelected === profile.id}
                  onChange={() => setSelectedId(profile.id)}
                  className="size-4 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                {formatProfileName(profile)}
              </label>
            ))}
          </div>
        </div>

        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button onClick={handleSetDefault} disabled={!resolvedSelected || setting}>
            {setting
              ? t('dashboard.profile.default.setting', locale)
              : t('dashboard.profile.default.setAsDefault', locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
