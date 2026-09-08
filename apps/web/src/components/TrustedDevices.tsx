import { useCallback, useEffect, useRef, useState } from 'react';
import { t, type Locale } from '@barghsa/i18n/app';
import { trustedDeviceText, type TrustedDeviceTextKey } from '@barghsa/i18n/trusted-devices';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Label,
} from '@barghsa/ui';
import { withCsrf } from '../lib/csrf.js';

interface TrustedDevice {
  id: string;
  userAgent: string | null;
  ip: string | null;
  trustedAt: string;
  expiresAt: string;
  isCurrentDevice: boolean;
}

function validDevices(value: unknown): value is TrustedDevice[] {
  if (!Array.isArray(value)) return false;
  return (
    value.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        row.id.length > 0 &&
        row.id.length <= 128 &&
        (row.userAgent === null || typeof row.userAgent === 'string') &&
        (row.ip === null || typeof row.ip === 'string') &&
        typeof row.isCurrentDevice === 'boolean' &&
        typeof row.trustedAt === 'string' &&
        Number.isFinite(Date.parse(row.trustedAt)) &&
        typeof row.expiresAt === 'string' &&
        Number.isFinite(Date.parse(row.expiresAt)) &&
        Date.parse(row.expiresAt) > Date.parse(row.trustedAt)
    ) && new Set(value.map((row: TrustedDevice) => row.id)).size === value.length
  );
}

export function TrustedDevices({
  locale,
  formatTimestamp,
  deviceName,
  onSessionRotated,
}: {
  locale: Locale;
  formatTimestamp: (value: string) => string;
  deviceName: (userAgent: string | undefined, locale: Locale) => string;
  onSessionRotated: () => Promise<void>;
}) {
  const [devices, setDevices] = useState<TrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<TrustedDevice | null>(null);
  const [pending, setPending] = useState(false);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const finalFocus = useRef<HTMLElement | null>(null);
  const text = (key: TrustedDeviceTextKey) => trustedDeviceText(key, locale);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    setDevices([]);
    async function load() {
      try {
        const response = await fetch('/api/auth/trusted-devices', { signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? 'auth' : 'load');
        const data: unknown = await response.json();
        if (!validDevices(data)) throw new Error('load');
        if (!controller.signal.aborted) setDevices(data);
      } catch (failure) {
        if (!controller.signal.aborted)
          setLoadError(
            failure instanceof Error && failure.message === 'auth'
              ? t('settings.security.error.auth', locale)
              : trustedDeviceText('loadError', locale)
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [locale, revision]);

  const close = useCallback(() => {
    if (busy.current) return;
    setSelected(null);
    setPassword('');
    setError(null);
    setNeedsPassword(false);
  }, []);

  async function remove() {
    if (!selected || busy.current || (needsPassword && !password)) return;
    busy.current = true;
    setPending(true);
    setError(null);
    let sessionRotated = false;
    try {
      if (needsPassword) {
        const verification = await fetch('/api/auth/step-up', {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ password }),
        });
        setPassword('');
        if (!verification.ok) {
          setError(t('team.passwordError', locale));
          return;
        }
        sessionRotated = true;
      }
      const response = await fetch('/api/auth/trusted-devices/' + encodeURIComponent(selected.id), {
        method: 'DELETE',
        headers: withCsrf(),
      });
      const body = await response.json().catch(() => null);
      const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
      if (response.status === 403 && code === 'AUTHZ:STEP_UP_REQUIRED') {
        setNeedsPassword(true);
        return;
      }
      if (!response.ok || body?.revoked !== true) {
        setError(text('revokeError'));
        return;
      }
      finalFocus.current = heading.current;
      setDevices((rows) => rows.filter((row) => row.id !== selected.id));
      setSelected(null);
      setPassword('');
      setNeedsPassword(false);
      setStatus(text('removed'));
    } catch {
      setPassword('');
      setError(text('revokeError'));
    } finally {
      if (sessionRotated) await onSessionRotated();
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="trusted-devices-heading" className="mt-8 border-t pt-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2
            id="trusted-devices-heading"
            ref={heading}
            tabIndex={-1}
            className="text-lg font-semibold"
          >
            {text('title')}
          </h2>
          <p className="text-sm text-muted-foreground">{text('description')}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading || pending}
          onClick={() => {
            setStatus(null);
            setRevision((value) => value + 1);
          }}
        >
          {text('refresh')}
        </Button>
      </div>
      {loading && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('settings.security.loading', locale)}
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-300">
          {loadError}
        </p>
      )}
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {!loading && !loadError && devices.length === 0 && (
        <p className="text-sm text-muted-foreground">{text('empty')}</p>
      )}
      {devices.map((device) => (
        <div key={device.id} className="rounded-lg border p-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex items-center flex-wrap gap-2">
              <h3 className="text-sm font-medium">
                {deviceName(device.userAgent ?? undefined, locale)}
              </h3>
              {device.isCurrentDevice && (
                <span className="rounded-full border px-2 py-0.5 text-xs">{text('current')}</span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={(event) => {
                finalFocus.current = event.currentTarget;
                setSelected(device);
                setError(null);
                setStatus(null);
                setNeedsPassword(false);
                setPassword('');
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
      {selected && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
        >
          <DialogContent
            finalFocus={finalFocus}
            showCloseButton={false}
            className="sm:max-w-md p-6 space-y-4"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
          >
            <DialogTitle>{text('remove')}</DialogTitle>
            <DialogDescription>{text('confirm')}</DialogDescription>
            <p className="text-sm font-medium">
              {deviceName(selected.userAgent ?? undefined, locale)}{' '}
              <bdi dir="ltr">{selected.ip}</bdi>
            </p>
            {needsPassword && (
              <div className="space-y-2">
                <Label htmlFor="trusted-device-password">
                  {t('settings.security.passwordLabel', locale)}
                </Label>
                <Input
                  id="trusted-device-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  disabled={pending}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setError(null);
                  }}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" autoFocus disabled={pending} onClick={close}>
                {t('settings.security.cancel', locale)}
              </Button>
              <Button
                variant="outline"
                disabled={pending || (needsPassword && !password)}
                onClick={remove}
              >
                {pending ? t('settings.security.revoking', locale) : text('remove')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
