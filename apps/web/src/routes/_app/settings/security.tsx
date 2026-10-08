import { useAccountTime } from '../../../hooks/useAccountTime.js';
import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useLocale } from '../../../hooks/useLocale.js';
import { createFileRoute } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';
import { trustedDeviceText } from '@barghsa/i18n/trusted-devices';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import { MonitorIcon, SmartphoneIcon, GlobeIcon, Trash2Icon, ShieldAlertIcon } from 'lucide-react';
import { Button } from '@barghsa/ui';
import { TrustedDevices } from '../../../components/TrustedDevices.js';
import { SecurityRevocationDialog } from '../../../components/SecurityRevocationDialog.js';
import { usePreferenceSettingsOwner } from '../../../hooks/usePreferenceSettingsForm.js';
import { useSecuritySettingsLists } from '../../../hooks/useSecuritySettings.js';
import type {
  SecuritySession as SessionItem,
  SecurityOperation,
} from '../../../lib/security-settings-form.js';
const TelegramLinkPanel = lazy(() => import('../../../components/TelegramLinkPanel.js'));
export const Route = createFileRoute('/_app/settings/security')({
  component: SettingsSecurityPage,
});
type DeviceType =
  'ios' | 'mac' | 'androidPhone' | 'androidTablet' | 'windows' | 'linux' | 'unknown';

const countryNames = {
  en: new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }),
  fa: new Intl.DisplayNames(['fa'], { type: 'region', fallback: 'none' }),
};

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Detect device type from user-agent string.
 */
function detectDeviceType(userAgent: string | undefined): DeviceType {
  if (!userAgent) return 'unknown';

  const ua = userAgent.toLowerCase();

  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'mac';
  if (ua.includes('android') && ua.includes('mobile')) return 'androidPhone';
  if (ua.includes('android')) return 'androidTablet';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('linux')) return 'linux';

  return 'unknown';
}

/**
 * Get the device icon component based on device type.
 */
function DeviceIcon({ deviceType }: { deviceType: DeviceType }) {
  if (deviceType === 'ios' || deviceType === 'androidPhone') {
    return <SmartphoneIcon className="h-4 w-4 text-muted-foreground" />;
  }
  return <MonitorIcon className="h-4 w-4 text-muted-foreground" />;
}

/**
 * Extract a friendly device name from a user-agent string.
 */
function getDeviceName(userAgent: string | undefined, locale: Locale): string {
  if (!userAgent) return t('settings.security.deviceUnknown', locale);

  const ua = userAgent.toLowerCase();

  if (ua.includes('iphone') || ua.includes('ipad'))
    return t('settings.security.device.ios', locale);
  if (ua.includes('macintosh') || ua.includes('mac os'))
    return t('settings.security.device.mac', locale);
  if (ua.includes('android') && ua.includes('mobile'))
    return t('settings.security.device.androidPhone', locale);
  if (ua.includes('android')) return t('settings.security.device.androidTablet', locale);
  if (ua.includes('windows')) return t('settings.security.device.windows', locale);
  if (ua.includes('linux')) return t('settings.security.device.linux', locale);

  return t('settings.security.deviceUnknown', locale);
}

/**
 * Small component that renders session details (IP, created/updated/expires/idle).
 */
function SessionDetails({
  session,
  locale,
  formatTimestamp,
}: {
  session: SessionItem;
  locale: Locale;
  formatTimestamp: (value: string) => string;
}) {
  const countryCode = session.location?.countryCode;
  const country =
    typeof countryCode === 'string' && /^[A-Z]{2}$/.test(countryCode)
      ? countryNames[locale].of(countryCode)
      : undefined;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {session.deviceInfo?.ip && (
        <span className="inline-flex items-center gap-1">
          <GlobeIcon className="h-3 w-3" />
          <bdi dir="ltr">{session.deviceInfo.ip}</bdi>
        </span>
      )}
      <span>
        {trustedDeviceText('location', locale)}:{' '}
        {country ?? trustedDeviceText('locationUnavailable', locale)}
      </span>
      <span>
        {t('settings.security.createdAt', locale)}:{' '}
        <time dateTime={session.createdAt}>{formatTimestamp(session.createdAt)}</time>
      </span>
      <span>
        {t('settings.security.updatedAt', locale)}:{' '}
        <time dateTime={session.updatedAt}>{formatTimestamp(session.updatedAt)}</time>
      </span>
      <span>
        {t('settings.security.expiresAt', locale)}:{' '}
        <time dateTime={session.expiresAt}>{formatTimestamp(session.expiresAt)}</time>
      </span>
      <span>
        {t('settings.security.idleDeadline', locale)}:{' '}
        <time dateTime={session.idleDeadline}>{formatTimestamp(session.idleDeadline)}</time>
      </span>
    </div>
  );
}

function SettingsSecurityPage() {
  const time = useAccountTime(),
    locale = useLocale();
  const scope = usePreferenceSettingsOwner(),
    lists = useSecuritySettingsLists(scope);
  const [selected, setSelected] = useState<SecurityOperation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const finalFocus = useRef<HTMLElement | null>(null),
    sessionsHeading = useRef<HTMLHeadingElement>(null),
    devicesHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    setSelected(null);
    setConfirmed(false);
  }, [scope.key, scope.denied]);
  const text = (key: string) => securitySettingsText(key, locale);
  const ready = lists.ready('sessions'),
    sessions = ready ? lists.data.sessions : [];
  const current = sessions.find((v) => v.isCurrentSession),
    others = sessions.filter((v) => !v.isCurrentSession);
  function choose(operation: SecurityOperation, trigger: HTMLElement) {
    if (!scope.isCurrent() || scope.isLocked()) return;
    finalFocus.current = trigger;
    setSelected(operation);
    setConfirmed(false);
  }
  async function refresh(family: 'sessions' | 'devices') {
    const name = 'security:refresh';
    if (!scope.claim(name)) return;
    setConfirmed(false);
    try {
      await lists.read(family);
    } finally {
      scope.release(name);
    }
  }
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 p-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-semibold">{t('settings.security.title', locale)}</h1>
      {scope.denied && <p role="alert">{text('denied')}</p>}
      {scope.isCurrent() && (
        <>
          <div
            onClickCapture={(event) => {
              if (scope.isLocked() || !scope.isCurrent()) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            {time.notice}
          </div>
          <Suspense fallback={null}>
            <TelegramLinkPanel scope={scope} />
          </Suspense>
          {confirmed && (
            <p role="status" className="text-sm text-primary">
              {text('confirmed')}
            </p>
          )}
          <section
            aria-labelledby="sessions-heading"
            className="rounded-xl border bg-card p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="sessions-heading"
                ref={sessionsHeading}
                tabIndex={-1}
                className="text-lg font-semibold"
              >
                {t('settings.security.sessionsTitle', locale)}
              </h2>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={scope.locked || lists.loading.sessions}
                onClick={() => void refresh('sessions')}
              >
                {text('refresh')}
              </Button>
            </div>
            {lists.loading.sessions && (
              <p role="status" className="text-sm text-muted-foreground">
                {text('loading')}
              </p>
            )}
            {lists.failed.sessions && (
              <p role="alert" className="text-sm text-destructive">
                {t('settings.security.error.load', locale)}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              {t('settings.security.sessionsDescription', locale)}
            </p>
            {ready && !sessions.length && (
              <p className="text-sm text-muted-foreground">
                {t('settings.security.noSessions', locale)}
              </p>
            )}
            {current && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <MonitorIcon className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium">
                    {getDeviceName(current.deviceInfo?.userAgent, locale)}
                  </span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t('settings.security.currentSession', locale)}
                  </span>
                </div>
                <SessionDetails session={current} locale={locale} formatTimestamp={time.format} />
              </div>
            )}
            {others.map((session) => (
              <div key={session.sessionId} className="rounded-lg border p-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <DeviceIcon deviceType={detectDeviceType(session.deviceInfo?.userAgent)} />
                    <span className="text-sm font-medium">
                      {getDeviceName(session.deviceInfo?.userAgent, locale)}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={scope.locked}
                    onClick={(event) =>
                      choose({ kind: 'session', target: session }, event.currentTarget)
                    }
                    className="gap-1"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                    {t('settings.security.revoke', locale)}
                  </Button>
                </div>
                <SessionDetails session={session} locale={locale} formatTimestamp={time.format} />
              </div>
            ))}
            {others.length > 0 && (
              <div className="pt-2">
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full gap-2 whitespace-normal bg-red-700 text-white hover:bg-red-800 dark:bg-red-700 dark:text-white dark:hover:bg-red-800"
                  disabled={scope.locked}
                  onClick={(event) => choose({ kind: 'others' }, event.currentTarget)}
                >
                  <ShieldAlertIcon className="h-4 w-4 shrink-0" />
                  {t('settings.security.revokeAll', locale)}
                </Button>
                <p className="text-xs text-muted-foreground mt-1 text-center">
                  {t('settings.security.revokeAllDescription', locale)}
                </p>
              </div>
            )}
            {ready && others.length === 0 && sessions.length > 0 && (
              <p className="text-sm text-center text-muted-foreground">
                {t('settings.security.noOtherSessions', locale)}
              </p>
            )}
          </section>
          <TrustedDevices
            locale={locale}
            formatTimestamp={time.format}
            deviceName={getDeviceName}
            scope={scope}
            lists={lists}
            heading={devicesHeading}
            refresh={() => void refresh('devices')}
            choose={(target, trigger) => choose({ kind: 'trust', target }, trigger)}
          />
          {selected && (
            <SecurityRevocationDialog
              key={
                scope.key +
                selected.kind +
                (selected.kind === 'session'
                  ? selected.target.sessionId
                  : selected.kind === 'trust'
                    ? selected.target.id
                    : '')
              }
              scope={scope}
              lists={lists}
              operation={selected}
              locale={locale}
              finalFocus={finalFocus}
              close={() => setSelected(null)}
              done={() => {
                finalFocus.current =
                  selected.kind === 'trust' ? devicesHeading.current : sessionsHeading.current;
                setSelected(null);
                setConfirmed(true);
              }}
              deviceName={getDeviceName}
              formatTimestamp={time.format}
            />
          )}
        </>
      )}
    </div>
  );
}
