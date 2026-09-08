import { useAccountTime } from '../../../hooks/useAccountTime.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocale } from '../../../hooks/useLocale.js';
import { createFileRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { t, type Locale } from '@barghsa/i18n/app';
import {
  MonitorIcon,
  SmartphoneIcon,
  GlobeIcon,
  ClockIcon,
  AlertCircleIcon,
  Trash2Icon,
  ShieldAlertIcon,
} from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Alert,
  AlertTitle,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@barghsa/ui';
import { withCsrf } from '../../../lib/csrf.js';
import { TrustedDevices } from '../../../components/TrustedDevices.js';

export const Route = createFileRoute('/_app/settings/security')({
  component: SettingsSecurityPage,
});

// ─── Types ────────────────────────────────────────────────────────────

interface DeviceInfo {
  ip?: string;
  userAgent?: string;
  fingerprint?: string;
}

interface SessionItem {
  sessionId: string;
  deviceInfo: DeviceInfo | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  idleDeadline: string;
  isCurrentSession: boolean;
}

type DeviceType =
  'ios' | 'mac' | 'androidPhone' | 'androidTablet' | 'windows' | 'linux' | 'unknown';

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
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {session.deviceInfo?.ip && (
        <span className="inline-flex items-center gap-1">
          <GlobeIcon className="h-3 w-3" />
          {session.deviceInfo.ip}
        </span>
      )}
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

// ─── Page Component ────────────────────────────────────────────────────

function SettingsSecurityPage() {
  const time = useAccountTime();
  const locale = useLocale();
  const revokingRef = useRef(false);
  const revokeTriggerRef = useRef<HTMLButtonElement | null>(null);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Revoke per session — confirm dialog state
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeNeedsPassword, setRevokeNeedsPassword] = useState(false);
  const [revokePassword, setRevokePassword] = useState('');

  // Revoke-all dialog
  const [showRevokeAll, setShowRevokeAll] = useState(false);
  const [revokeAllPassword, setRevokeAllPassword] = useState('');
  const [revokingAll, setRevokingAll] = useState(false);
  const [revokeAllError, setRevokeAllError] = useState<string | null>(null);

  // ── Fetch sessions ──────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/sessions');

      if (!response.ok) {
        if (response.status === 401) {
          setError(t('settings.security.error.auth', locale));
          return;
        }
        setError(t('settings.security.error.load', locale));
        return;
      }

      const data: SessionItem[] = await response.json();
      setSessions(data);
    } catch {
      setError(t('settings.security.error.loadRetry', locale));
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // ── Revoke a single session (with confirmation) ────────────────────

  const handleConfirmRevoke = useCallback(async () => {
    if (!revokeConfirmId || revokingRef.current || (revokeNeedsPassword && !revokePassword)) return;
    revokingRef.current = true;

    setRevokingId(revokeConfirmId);
    setRevokeError(null);

    try {
      if (revokeNeedsPassword) {
        const verified = await fetch('/api/auth/step-up', {
          method: 'POST',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ password: revokePassword }),
        });
        setRevokePassword('');
        if (!verified.ok) {
          setRevokeError(t('team.passwordError', locale));
          return;
        }
      }
      const response = await fetch(`/api/auth/sessions/${revokeConfirmId}`, {
        method: 'DELETE',
        headers: withCsrf(),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
        if (response.status === 403 && code === 'AUTHZ:STEP_UP_REQUIRED') {
          setRevokeNeedsPassword(true);
          return;
        }
        setRevokeError(t('settings.security.error.revoke', locale));
        return;
      }

      setRevokeConfirmId(null);
      toast.success(t('settings.security.revoked', locale));
      setSessions((prev) => prev.filter((s) => s.sessionId !== revokeConfirmId));
    } catch {
      setRevokeError(t('settings.security.error.revoke', locale));
    } finally {
      revokingRef.current = false;
      setRevokingId(null);
    }
  }, [revokeConfirmId, revokeNeedsPassword, revokePassword, locale]);

  const handleCancelRevokeConfirm = useCallback(() => {
    if (revokingRef.current) return;
    setRevokeError(null);
    setRevokePassword('');
    setRevokeNeedsPassword(false);
    setRevokeConfirmId(null);
  }, []);

  // ── Revoke all other sessions ───────────────────────────────────────

  const handleRevokeAll = useCallback(async () => {
    if (!revokeAllPassword || revokingRef.current) return;
    revokingRef.current = true;

    setRevokingAll(true);
    setRevokeAllError(null);

    try {
      const response = await fetch('/api/auth/sessions/revoke-all', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password: revokeAllPassword }),
      });

      const body: Record<string, unknown> = await response.json().catch(() => ({}));

      if (!response.ok) {
        const errorCode =
          typeof body?.error === 'string'
            ? body.error
            : body.error && typeof body.error === 'object' && 'code' in body.error
              ? body.error.code
              : '';
        if (errorCode === 'AUTH:LOGIN:INVALID_CREDENTIALS') {
          setRevokeAllError(t('settings.security.error.invalidPassword', locale));
        } else {
          setRevokeAllError(t('settings.security.error.revokeAll', locale));
        }
        return;
      }

      toast.success(t('settings.security.revokeAllSuccess', locale));
      setShowRevokeAll(false);
      setRevokeAllPassword('');
      setRevokeAllError(null);

      // Refresh the session list
      fetchSessions();
    } catch {
      setRevokeAllError(t('settings.security.error.revokeAll', locale));
    } finally {
      revokingRef.current = false;
      setRevokingAll(false);
    }
  }, [revokeAllPassword, locale, fetchSessions]);

  const closeRevokeAll = useCallback(() => {
    if (revokingRef.current) return;
    setShowRevokeAll(false);
    setRevokeAllPassword('');
    setRevokeAllError(null);
  }, []);

  // ── Current session and other sessions ──────────────────────────────

  const currentSession = sessions.find((s) => s.isCurrentSession);
  const otherSessions = sessions.filter((s) => !s.isCurrentSession);
  const revokeConfirmSession = revokeConfirmId
    ? sessions.find((s) => s.sessionId === revokeConfirmId)
    : null;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div
      className="container mx-auto max-w-2xl py-8 px-4 bg-background text-foreground"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <h1 className="text-2xl font-bold mb-6">{t('settings.security.title', locale)}</h1>

      {/* Sessions section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              {t('settings.security.sessionsTitle', locale)}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('settings.security.sessionsDescription', locale)}
            </p>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-8 text-muted-foreground">
            <ClockIcon className="mx-auto h-6 w-6 animate-pulse mb-2" />
            <p className="text-sm">{t('settings.security.loading', locale)}</p>
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <Alert variant="destructive">
            <AlertCircleIcon className="h-4 w-4" />
            <AlertTitle>{t('settings.security.error.title', locale)}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* No sessions found */}
        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <ShieldAlertIcon className="mx-auto h-8 w-8 mb-2" />
            <p className="text-sm">{t('settings.security.noSessions', locale)}</p>
          </div>
        )}

        {/* Current session card */}
        {!loading && currentSession && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MonitorIcon className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">
                  {getDeviceName(currentSession.deviceInfo?.userAgent, locale)}
                </span>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {t('settings.security.currentSession', locale)}
                </span>
              </div>
            </div>
            <SessionDetails
              session={currentSession}
              locale={locale}
              formatTimestamp={time.format}
            />
          </div>
        )}

        {/* Other sessions */}
        {!loading && otherSessions.length > 0 && (
          <div className="space-y-3">
            {otherSessions.map((session) => (
              <div key={session.sessionId} className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DeviceIcon deviceType={detectDeviceType(session.deviceInfo?.userAgent)} />
                    <span className="text-sm font-medium">
                      {getDeviceName(session.deviceInfo?.userAgent, locale)}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revokingId !== null}
                    onClick={(event) => {
                      revokeTriggerRef.current = event.currentTarget;
                      setRevokeError(null);
                      setRevokeNeedsPassword(false);
                      setRevokePassword('');
                      setRevokeConfirmId(session.sessionId);
                    }}
                    className="gap-1"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                    {revokingId === session.sessionId
                      ? t('settings.security.revoking', locale)
                      : t('settings.security.revoke', locale)}
                  </Button>
                </div>
                <SessionDetails session={session} locale={locale} formatTimestamp={time.format} />
              </div>
            ))}
          </div>
        )}

        {/* Revoke all button */}
        {!loading && !error && otherSessions.length > 0 && (
          <div className="pt-2">
            <Button
              variant="destructive"
              className="w-full gap-2"
              disabled={revokingId !== null}
              onClick={(event) => {
                revokeTriggerRef.current = event.currentTarget;
                setShowRevokeAll(true);
              }}
            >
              <ShieldAlertIcon className="h-4 w-4" />
              {t('settings.security.revokeAll', locale)}
            </Button>
            <p className="text-xs text-muted-foreground mt-1 text-center">
              {t('settings.security.revokeAllDescription', locale)}
            </p>
          </div>
        )}

        {/* No other sessions notice */}
        {!loading && !error && otherSessions.length === 0 && sessions.length > 0 && (
          <div className="text-center py-4 text-muted-foreground">
            <p className="text-sm">{t('settings.security.noOtherSessions', locale)}</p>
          </div>
        )}
      </div>

      <TrustedDevices locale={locale} formatTimestamp={time.format} deviceName={getDeviceName} />

      {/* ── Revoke Single Session Confirmation Dialog ──────────────── */}
      {revokeConfirmId && revokeConfirmSession && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) handleCancelRevokeConfirm();
          }}
        >
          <DialogContent
            showCloseButton={false}
            finalFocus={revokeTriggerRef}
            className="sm:max-w-md p-6 space-y-4"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center gap-2">
              <ShieldAlertIcon className="h-5 w-5 text-destructive" />
              <DialogTitle className="text-lg font-semibold">
                {t('settings.security.revoke', locale)}
              </DialogTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('settings.security.revokeConfirm', locale)}
            </p>
            <div className="text-sm border rounded p-3 bg-muted/20 space-y-1">
              <p className="font-medium">
                {getDeviceName(revokeConfirmSession.deviceInfo?.userAgent, locale)}
              </p>
              {revokeConfirmSession.deviceInfo?.ip && (
                <p className="text-muted-foreground">
                  <GlobeIcon className="h-3 w-3 inline mr-1" />
                  {revokeConfirmSession.deviceInfo.ip}
                </p>
              )}
              <p className="text-muted-foreground">
                {t('settings.security.createdAt', locale)}:{' '}
                {time.format(revokeConfirmSession.createdAt)}
              </p>
            </div>

            {revokeNeedsPassword && (
              <div className="space-y-2">
                <Label htmlFor="revoke-single-password">
                  {t('settings.security.passwordLabel', locale)}
                </Label>
                <Input
                  id="revoke-single-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={revokePassword}
                  disabled={revokingId !== null}
                  onChange={(event) => {
                    setRevokePassword(event.target.value);
                    setRevokeError(null);
                  }}
                />
              </div>
            )}
            {revokeError && (
              <p role="alert" className="text-sm text-destructive">
                {revokeError}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                disabled={revokingId !== null}
                onClick={handleCancelRevokeConfirm}
                autoFocus
              >
                {t('settings.security.cancel', locale)}
              </Button>
              <Button
                variant="destructive"
                disabled={
                  revokingId === revokeConfirmId || (revokeNeedsPassword && !revokePassword)
                }
                onClick={handleConfirmRevoke}
              >
                {revokingId === revokeConfirmId
                  ? t('settings.security.revoking', locale)
                  : t('settings.security.revoke', locale)}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Revoke All Confirmation Dialog ───────────────────────── */}
      {showRevokeAll && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) closeRevokeAll();
          }}
        >
          <DialogContent
            showCloseButton={false}
            finalFocus={revokeTriggerRef}
            className="sm:max-w-md p-6 space-y-4"
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
          >
            <div className="flex items-center gap-2">
              <ShieldAlertIcon className="h-5 w-5 text-destructive" />
              <DialogTitle className="text-lg font-semibold">
                {t('settings.security.revokeAll', locale)}
              </DialogTitle>
            </div>
            <p className="text-sm text-muted-foreground">
              {t('settings.security.revokeAllConfirm', locale)}
            </p>

            <div className="space-y-2">
              <Label htmlFor="revoke-password">
                {t('settings.security.passwordLabel', locale)}
              </Label>
              <Input
                id="revoke-password"
                disabled={revokingAll}
                type="password"
                placeholder={t('settings.security.passwordPlaceholder', locale)}
                value={revokeAllPassword}
                onChange={(e) => {
                  setRevokeAllPassword(e.target.value);
                  setRevokeAllError(null);
                }}
                autoFocus
              />
              {revokeAllError && (
                <p className="text-sm text-destructive" role="alert">
                  {revokeAllError}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" disabled={revokingAll} onClick={closeRevokeAll}>
                {t('settings.security.cancel', locale)}
              </Button>
              <Button
                variant="destructive"
                disabled={!revokeAllPassword || revokingAll}
                onClick={handleRevokeAll}
              >
                {revokingAll
                  ? t('settings.security.revokingAll', locale)
                  : t('settings.security.revokeAll', locale)}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
