import type { RefObject } from 'react';
import { Button } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/app';
import { trustedDeviceText, type TrustedDeviceTextKey } from '@barghsa/i18n/trusted-devices';
import { securitySettingsText } from '@barghsa/i18n/security-settings-forms';
import type { SecurityLists, SecurityOwner } from '../hooks/useSecuritySettings.js';
import type { TrustedDevice } from '../lib/security-settings-form.js';
export function TrustedDevices({
  locale,
  formatTimestamp,
  deviceName,
  scope,
  lists,
  heading,
  refresh,
  choose,
}: {
  locale: Locale;
  formatTimestamp: (value: string) => string;
  deviceName: (value: string | undefined, locale: Locale) => string;
  scope: SecurityOwner;
  lists: SecurityLists;
  heading: RefObject<HTMLHeadingElement | null>;
  refresh: () => void;
  choose: (target: TrustedDevice, trigger: HTMLElement) => void;
}) {
  const text = (key: TrustedDeviceTextKey) => trustedDeviceText(key, locale);
  const devices = lists.ready('devices') ? lists.data.devices : [];
  return (
    <section
      aria-labelledby="trusted-devices-heading"
      className="rounded-xl border bg-card p-4 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="trusted-devices-heading"
          ref={heading}
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          {text('title')}
        </h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={scope.locked || lists.loading.devices}
          onClick={() => {
            if (scope.isCurrent() && !scope.isLocked()) refresh();
          }}
        >
          {text('refresh')}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{text('description')}</p>
      {lists.loading.devices && (
        <p role="status" className="text-sm text-muted-foreground">
          {securitySettingsText('loading', locale)}
        </p>
      )}
      {lists.failed.devices && (
        <p role="alert" className="text-sm text-destructive">
          {text('loadError')}
        </p>
      )}
      {lists.ready('devices') && devices.length === 0 && (
        <p className="text-sm text-muted-foreground">{text('empty')}</p>
      )}
      {devices.map((device) => (
        <div key={device.id} className="rounded-lg border p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {deviceName(device.userAgent ?? undefined, locale)}
              </span>
              {device.isCurrentDevice && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                  {text('current')}
                </span>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={scope.locked}
              onClick={(event) => {
                if (scope.isCurrent() && !scope.isLocked()) choose(device, event.currentTarget);
              }}
            >
              {text('remove')}
            </Button>
          </div>
          {device.userAgent && (
            <p dir="auto" className="break-words text-xs text-muted-foreground">
              {device.userAgent}
            </p>
          )}
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div>
              <dt className="inline">IP: </dt>
              <dd className="inline">
                <bdi dir={device.ip ? 'ltr' : 'auto'}>{device.ip ?? text('unknownIp')}</bdi>
              </dd>
            </div>
            <div>
              <dt className="inline">{text('trustedAt')}: </dt>
              <dd className="inline">
                <time dateTime={device.trustedAt}>{formatTimestamp(device.trustedAt)}</time>
              </dd>
            </div>
            <div>
              <dt className="inline">{t('settings.security.expiresAt', locale)}: </dt>
              <dd className="inline">
                <time dateTime={device.expiresAt}>{formatTimestamp(device.expiresAt)}</time>
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </section>
  );
}
