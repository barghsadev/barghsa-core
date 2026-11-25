import { getProfileContextRevision } from '../lib/profile-context.js';
import { sendToast } from '../lib/toast-api.js';
import { useLayoutEffect, useRef, useState } from 'react';
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

export default function DefaultProfileChoiceDialog({
  profiles,
  revision,
}: {
  profiles: SwitcherProfile[];
  revision: number;
}) {
  const pending = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => pending.current?.abort(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setting, setSetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locale = useLocale();
  const isRtl = locale === 'fa';
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
