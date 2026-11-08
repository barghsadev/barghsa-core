import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentType,
} from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { Building2, Check, ChevronDown, UserRound } from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { Badge, Button, Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@barghsa/ui';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useOwnedProfileRead } from '../hooks/useOwnedProfileRead.js';
import { useSettingsCommand } from '../hooks/useSettingsCommand.js';
import { settingsContext, type SettingsProfileSummary } from '../lib/settings-form.js';
import { refreshProfileContext, useProfileContextRevision } from '../lib/profile-context.js';

import { profileName, ProfileAvatar, ProfileTypeBadge } from './ProfileIdentity.js';
import type { ProfileSwitchProgressProps } from './ProfileSwitchProgress.js';
import type { ProfileChoicesProps } from './ProfileChoices.js';

export type SwitcherProfile = SettingsProfileSummary;
export interface ProfileSwitchResponse {
  activeProfileId: string | null;
}
type Profiles = NonNullable<ReturnType<typeof settingsContext>>;
const ProfileContext = createContext<{
  data: Profiles | null;
  loading: boolean;
  error: boolean;
  locked: boolean;
  load: () => Promise<void>;
  select: (id: string) => Promise<void>;
} | null>(null);

/** One current, account-owned directory serves the picker and compact badge. */
export function ProfileWorkspaceProvider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  const actor = useAccountUser(),
    revision = useProfileContextRevision();
  const pathname = useLocation({ select: (location) => location.pathname });
  const identity = JSON.stringify([actor, revision]);
  const current = useRef(identity);
  current.current = identity;
  const alive = useRef(true),
    generation = useRef(0);
  const [accepted, setAccepted] = useState<{ identity: string; data: Profiles } | null>(null);
  const data = accepted?.identity === identity ? accepted.data : null;
  const latest = useRef(data);
  latest.current = data;
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(false);
  function permitted(token: string) {
    return alive.current && current.current === token;
  }
  function denied() {
    latest.current = null;
    setAccepted(null);
    setError(true);
    setLoading(false);
  }
  const [Progress, setProgress] = useState<ComponentType<ProfileSwitchProgressProps> | null>(null);
  const [progressError, setProgressError] = useState(false);
  const command = useSettingsCommand(identity, denied, () => !!latest.current);
  useEffect(() => {
    if (!command.locked || Progress) return;
    let cancelled = false;
    setProgressError(false);
    void import('./ProfileSwitchProgress.js')
      .then((module) => {
        if (!cancelled) setProgress(() => module.default);
      })
      .catch(() => {
        if (!cancelled) setProgressError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [command.locked, Progress]);
  const privateRead = useOwnedProfileRead(
    identity,
    { context: 'account', ownerId: actor ?? 'current-session', accountId: actor, revision },
    permitted,
    () => command.coordination.denied()
  );
  async function read(token: string) {
    const parsed = settingsContext(await privateRead('/api/profiles', token));
    if (!parsed || !permitted(token)) throw new Error('Profile directory unavailable');
    return parsed;
  }
  async function load() {
    const token = identity,
      request = ++generation.current;
    const isLatest = () => permitted(token) && generation.current === request;
    setLoading(true);
    try {
      const value = await read(token);
      if (isLatest()) {
        latest.current = value;
        setAccepted({ identity: token, data: value });
        setError(false);
      }
    } catch {
      if (isLatest()) denied();
    } finally {
      if (isLatest()) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    latest.current = null;
    setAccepted(null);
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, [identity]);
  useEffect(() => {
    const refresh = () => {
      if (!command.coordination.isLocked()) void load();
    };
    refresh();
    window.addEventListener('barghsa:profiles-changed', refresh);
    return () => window.removeEventListener('barghsa:profiles-changed', refresh);
  }, [identity, pathname]);
  async function select(id: string) {
    if (
      !data ||
      loading ||
      id === data.activeProfileId ||
      !data.profiles.some((row) => row.id === id) ||
      !command.coordination.claim('default')
    )
      return;
    const token = identity;
    const matchesTarget = (value: unknown) =>
      !!value &&
      typeof value === 'object' &&
      'activeProfileId' in value &&
      value.activeProfileId === id;
    await command.submit({
      owner: 'default',
      path: '/api/profiles/switch/' + encodeURIComponent(id),
      method: 'POST',
      status: 200,
      keyed: false,
      receipt: matchesTarget,
      confirmation: () => read(token),
      confirmed: matchesTarget,
      accepted: () => {
        if (permitted(token)) refreshProfileContext();
      },
    });
  }
  return (
    <ProfileContext.Provider
      value={{ data, loading, error, locked: !!command.locked, load, select }}
    >
      <div className="contents" inert={!!command.locked}>
        {children}
      </div>
      {!!command.locked &&
        (Progress ? (
          <Progress
            locale={locale}
            busy={command.busy}
            error={command.error}
            recheck={command.refreshConfirmation}
          />
        ) : (
          <div
            role={progressError ? 'alert' : 'status'}
            className="fixed inset-0 z-100 grid place-content-center gap-4 bg-background p-6 text-center"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
          >
            <p>
              {t(
                progressError ? 'dashboard.profile.switchError' : 'dashboard.profile.switching',
                locale
              )}
            </p>
            {progressError && (
              <Button onClick={() => window.location.reload()}>
                {t('dashboard.profile.reloadWorkspace', locale)}
              </Button>
            )}
          </div>
        ))}
    </ProfileContext.Provider>
  );
}

/** Visible in compact headers; the same directory/identity owns both presentations. */
export function ProfileBadge({ locale }: { locale: Locale }) {
  const workspace = useContext(ProfileContext);
  const profile = workspace?.data?.profiles.find(
    (row) => row.id === workspace.data?.activeProfileId
  );
  if (!profile) return null;
  const Icon = profile.profileType === 'LEGAL' ? Building2 : UserRound;
  return (
    <span
      className="flex min-w-0 items-center gap-1"
      title={profileName(profile, locale)}
      data-slot="active-profile-badge"
    >
      <ProfileAvatar profile={profile} locale={locale} compact />
      <Icon
        className="size-4 shrink-0"
        aria-label={t(
          profile.profileType === 'LEGAL'
            ? 'dashboard.profile.typeLegal'
            : 'dashboard.profile.typeIndividual',
          locale
        )}
      />
      <span className="max-w-12 truncate text-xs sm:max-w-24" dir="auto">
        {profileName(profile, locale)}
      </span>
    </span>
  );
}

export function ProfileSwitcher({ locale = 'fa' }: { locale?: Locale }) {
  const workspace = useContext(ProfileContext);
  const [open, setOpen] = useState(false);
  const [Choices, setChoices] = useState<ComponentType<ProfileChoicesProps> | null>(null);
  const [choiceError, setChoiceError] = useState(false);
  useEffect(() => {
    if (!open || Choices) return;
    let cancelled = false;
    setChoiceError(false);
    void import('./ProfileChoices.js')
      .then((module) => {
        if (!cancelled) setChoices(() => module.default);
      })
      .catch(() => {
        if (!cancelled) setChoiceError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, Choices]);
  if (!workspace) return null;
  const { data, loading, error, locked } = workspace;
  const active = data?.profiles.find((row) => row.id === data.activeProfileId);
  if (!data || !data.profiles.length)
    return error ? (
      <div role="alert" className="space-y-2 text-sm">
        <p>{t('dashboard.profile.switchError', locale)}</p>
        <Button variant="outline" disabled={loading} onClick={() => void workspace.load()}>
          {t('dashboard.profile.retry', locale)}
        </Button>
      </div>
    ) : null;
  return (
    <div dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <Popover open={open && !locked} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id="profile-switcher"
              variant="outline"
              className="h-auto min-h-11 w-full justify-start whitespace-normal p-3 text-start"
              disabled={locked || loading}
              aria-label={t('dashboard.profile.switchLabel', locale)}
            />
          }
        >
          {active && <ProfileAvatar profile={active} locale={locale} />}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">
              {active ? profileName(active, locale) : t('dashboard.profile.choose', locale)}
            </span>
            {active && <ProfileTypeBadge profile={active} locale={locale} />}
          </span>
          <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 max-w-[calc(100vw-2rem)] max-h-(--available-height) overflow-y-auto p-3"
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
        >
          <PopoverTitle>{t('dashboard.profile.switchLabel', locale)}</PopoverTitle>
          {Choices ? (
            <Choices
              data={data}
              label={t('dashboard.profile.switchLabel', locale)}
              onSelect={workspace.select}
              renderProfile={(profile) => (
                <>
                  <ProfileAvatar profile={profile} locale={locale} />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block break-words font-medium">
                      {profileName(profile, locale)}
                    </span>
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
                </>
              )}
            />
          ) : (
            <div className="space-y-2">
              <p role={choiceError ? 'alert' : 'status'}>
                {t(
                  choiceError ? 'dashboard.profile.switchError' : 'dashboard.profile.switching',
                  locale
                )}
              </p>
              {choiceError && (
                <Button onClick={() => window.location.reload()}>
                  {t('dashboard.profile.reloadWorkspace', locale)}
                </Button>
              )}
            </div>
          )}
          <Link
            to="/settings/profile"
            onClick={() => setOpen(false)}
            className="mt-3 flex min-h-11 items-center border-t pt-3 font-medium underline underline-offset-4"
          >
            {t('dashboard.profile.manage', locale)}
          </Link>
        </PopoverContent>
      </Popover>
    </div>
  );
}
