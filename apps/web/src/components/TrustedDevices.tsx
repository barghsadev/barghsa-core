import type { RefObject } from 'react';
import { Badge, Button } from '@barghsa/ui';
import { RecordListSkeleton } from './RecordListSkeleton.js';
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
  chooseAll,
  trackRevokeTrigger,
  trackRevokeAllTrigger,
}: {
  locale: Locale;
  formatTimestamp: (value: string) => string;
  deviceName: (value: string | undefined, locale: Locale) => string;
  scope: SecurityOwner;
  lists: SecurityLists;
  heading: RefObject<HTMLHeadingElement | null>;
  refresh: () => void;
  choose: (target: TrustedDevice, trigger: HTMLElement) => void;
  chooseAll: (trigger: HTMLElement) => void;
  trackRevokeTrigger?: (id: string, node: HTMLButtonElement | null) => void;
  trackRevokeAllTrigger?: (node: HTMLButtonElement | null) => void;
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
        <RecordListSkeleton
          label={securitySettingsText('loading', locale)}
          view="card"
          headings={[]}
        />
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
        <div key={device.id} className="space-y-3 rounded-lg border bg-background/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">
                {deviceName(device.userAgent ?? undefined, locale)}
              </span>
              {device.isCurrentDevice && <Badge>{text('current')}</Badge>}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={scope.locked}
              ref={(node) => trackRevokeTrigger?.(device.id, node)}
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
          <dl className="grid grid-cols-2 gap-3 border-t pt-3 text-xs">
            <div>
              <dt className="text-muted-foreground">IP</dt>
              <dd>
                <bdi dir={device.ip ? 'ltr' : 'auto'}>{device.ip ?? text('unknownIp')}</bdi>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{text('trustedAt')}</dt>
              <dd>
                <time dateTime={device.trustedAt}>{formatTimestamp(device.trustedAt)}</time>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('settings.security.expiresAt', locale)}</dt>
              <dd>
                <time dateTime={device.expiresAt}>{formatTimestamp(device.expiresAt)}</time>
              </dd>
            </div>
          </dl>
        </div>
      ))}
      {devices.length > 0 && (
        <Button
          type="button"
          variant="outline"
          disabled={scope.locked}
          ref={trackRevokeAllTrigger}
          onClick={(event) => chooseAll(event.currentTarget)}
        >
          {text('removeAll')}
        </Button>
      )}
    </section>
  );
}
