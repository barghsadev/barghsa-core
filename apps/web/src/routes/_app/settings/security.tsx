import { useState, useEffect, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import {
  MonitorIcon,
  SmartphoneIcon,
  GlobeIcon,
  ClockIcon,
  AlertCircleIcon,
  Trash2Icon,
  ShieldAlertIcon,
} from 'lucide-react'
import { Button, Input, Label, Alert, AlertTitle, AlertDescription } from '@barghsa/ui'
import { withCsrf } from '../../../lib/csrf.js'

export const Route = createFileRoute('/_app/settings/security')({
  component: SettingsSecurityPage,
})

// ─── Types ────────────────────────────────────────────────────────────

interface DeviceInfo {
  ip?: string
  userAgent?: string
  fingerprint?: string
}

interface SessionItem {
  sessionId: string
  deviceInfo: DeviceInfo | null
  createdAt: string
  updatedAt: string
  expiresAt: string
  idleDeadline: string
  isCurrentSession: boolean
}

type DeviceType = 'ios' | 'mac' | 'androidPhone' | 'androidTablet' | 'windows' | 'linux' | 'unknown'

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Detect device type from user-agent string.
 */
function detectDeviceType(userAgent: string | undefined): DeviceType {
  if (!userAgent) return 'unknown'

  const ua = userAgent.toLowerCase()

  if (ua.includes('iphone') || ua.includes('ipad')) return 'ios'
  if (ua.includes('macintosh') || ua.includes('mac os')) return 'mac'
  if (ua.includes('android') && ua.includes('mobile')) return 'androidPhone'
  if (ua.includes('android')) return 'androidTablet'
  if (ua.includes('windows')) return 'windows'
  if (ua.includes('linux')) return 'linux'

  return 'unknown'
}

/**
 * Get the device icon component based on device type.
 */
function DeviceIcon({ deviceType }: { deviceType: DeviceType }) {
  if (deviceType === 'ios' || deviceType === 'androidPhone') {
    return <SmartphoneIcon className="h-4 w-4 text-muted-foreground" />
  }
  return <MonitorIcon className="h-4 w-4 text-muted-foreground" />
}

/**
 * Extract a friendly device name from a user-agent string.
 */
function getDeviceName(userAgent: string | undefined, locale: Locale): string {
  if (!userAgent) return t('settings.security.deviceUnknown', locale)

  const ua = userAgent.toLowerCase()

  if (ua.includes('iphone') || ua.includes('ipad')) return t('settings.security.device.ios', locale)
  if (ua.includes('macintosh') || ua.includes('mac os')) return t('settings.security.device.mac', locale)
  if (ua.includes('android') && ua.includes('mobile')) return t('settings.security.device.androidPhone', locale)
  if (ua.includes('android')) return t('settings.security.device.androidTablet', locale)
  if (ua.includes('windows')) return t('settings.security.device.windows', locale)
  if (ua.includes('linux')) return t('settings.security.device.linux', locale)

  return t('settings.security.deviceUnknown', locale)
}

/**
 * Format a date string to a locale-aware, relative-ish string.
 */
function formatDate(dateStr: string, locale: Locale): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1) return locale === 'fa' ? 'همین حالا' : 'just now'
  if (diffMins < 60) {
    const num = diffMins
    return locale === 'fa' ? `${num} دقیقه پیش` : `${num}m ago`
  }
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) {
    const num = diffHours
    return locale === 'fa' ? `${num} ساعت پیش` : `${num}h ago`
  }
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) {
    const num = diffDays
    return locale === 'fa' ? `${num} روز پیش` : `${num}d ago`
  }

  return date.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Small component that renders session details (IP, created/updated/expires/idle).
 */
function SessionDetails({ session, locale }: { session: SessionItem; locale: Locale }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {session.deviceInfo?.ip && (
        <span className="inline-flex items-center gap-1">
          <GlobeIcon className="h-3 w-3" />
          {session.deviceInfo.ip}
        </span>
      )}
      <span>
        {t('settings.security.createdAt', locale)}: {formatDate(session.createdAt, locale)}
      </span>
      <span>
        {t('settings.security.updatedAt', locale)}: {formatDate(session.updatedAt, locale)}
      </span>
      <span>
        {t('settings.security.expiresAt', locale)}: {formatDate(session.expiresAt, locale)}
      </span>
      <span>
        {t('settings.security.idleDeadline', locale)}: {formatDate(session.idleDeadline, locale)}
      </span>
    </div>
  )
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsSecurityPage() {
  const locale: Locale = 'fa' // TODO: read from user preference / locale context (project-wide)

  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Revoke per session — confirm dialog state
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // Revoke-all dialog
  const [showRevokeAll, setShowRevokeAll] = useState(false)
  const [revokeAllPassword, setRevokeAllPassword] = useState('')
  const [revokingAll, setRevokingAll] = useState(false)
  const [revokeAllError, setRevokeAllError] = useState<string | null>(null)

  // ── Fetch sessions ──────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/auth/sessions')

      if (!response.ok) {
        if (response.status === 401) {
          setError(t('settings.security.error.auth', locale))
          return
        }
        setError(t('settings.security.error.load', locale))
        return
      }

      const data: SessionItem[] = await response.json()
      setSessions(data)
    } catch {
      setError(t('settings.security.error.loadRetry', locale))
    } finally {
      setLoading(false)
    }
  }, [locale])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // ── Revoke a single session (with confirmation) ────────────────────

  const handleConfirmRevoke = useCallback(async () => {
    if (!revokeConfirmId) return

    setRevokingId(revokeConfirmId)
    setRevokeConfirmId(null)

    try {
      const response = await fetch(`/api/auth/sessions/${revokeConfirmId}`, {
        method: 'DELETE',
        headers: withCsrf(),
      })

      if (!response.ok) {
        toast.error(t('settings.security.error.revoke', locale))
        return
      }

      toast.success(t('settings.security.revoked', locale))
      setSessions((prev) =>
        prev.filter((s) => s.sessionId !== revokeConfirmId),
      )
    } catch {
      toast.error(t('settings.security.error.revoke', locale))
    } finally {
      setRevokingId(null)
    }
  }, [revokeConfirmId, locale])

  const handleCancelRevokeConfirm = useCallback(() => {
    setRevokeConfirmId(null)
  }, [])

  // ── Revoke all other sessions ───────────────────────────────────────

  const handleRevokeAll = useCallback(async () => {
    if (!revokeAllPassword) return

    setRevokingAll(true)
    setRevokeAllError(null)

    try {
      const response = await fetch('/api/auth/sessions/revoke-all', {
        method: 'POST',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ password: revokeAllPassword }),
      })

      const body: Record<string, unknown> = await response.json().catch(() => ({}))

      if (!response.ok) {
        const errorCode = typeof body?.error === 'string' ? body.error : ''
        if (errorCode === 'AUTH:LOGIN:INVALID_CREDENTIALS') {
          setRevokeAllError(t('settings.security.error.invalidPassword', locale))
        } else {
          setRevokeAllError(t('settings.security.error.revokeAll', locale))
        }
        return
      }

      toast.success(t('settings.security.revokeAllSuccess', locale))
      setShowRevokeAll(false)
      setRevokeAllPassword('')
      setRevokeAllError(null)

      // Refresh the session list
      fetchSessions()
    } catch {
      setRevokeAllError(t('settings.security.error.revokeAll', locale))
    } finally {
      setRevokingAll(false)
    }
  }, [revokeAllPassword, locale, fetchSessions])

  // ── Escape-to-close handler ────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, close: () => void) => {
      if (e.key === 'Escape') {
        close()
      }
    },
    [],
  )

  // ── Current session and other sessions ──────────────────────────────

  const currentSession = sessions.find((s) => s.isCurrentSession)
  const otherSessions = sessions.filter((s) => !s.isCurrentSession)
  const revokeConfirmSession = revokeConfirmId
    ? sessions.find((s) => s.sessionId === revokeConfirmId)
    : null

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-6">
        {t('settings.security.title', locale)}
      </h1>

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
            <p className="text-sm">
              {t('settings.security.noSessions', locale)}
            </p>
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
            <SessionDetails session={currentSession} locale={locale} />
          </div>
        )}

        {/* Other sessions */}
        {!loading && otherSessions.length > 0 && (
          <div className="space-y-3">
            {otherSessions.map((session) => (
              <div
                key={session.sessionId}
                className="rounded-lg border p-4 space-y-2"
              >
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
                    disabled={revokingId === session.sessionId}
                    onClick={() => setRevokeConfirmId(session.sessionId)}
                    className="gap-1"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                    {revokingId === session.sessionId
                      ? t('settings.security.revoking', locale)
                      : t('settings.security.revoke', locale)}
                  </Button>
                </div>
                <SessionDetails session={session} locale={locale} />
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
              onClick={() => setShowRevokeAll(true)}
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
            <p className="text-sm">
              {t('settings.security.noOtherSessions', locale)}
            </p>
          </div>
        )}
      </div>

      {/* ── Revoke Single Session Confirmation Dialog ──────────────── */}
      {revokeConfirmId && revokeConfirmSession && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(e) => handleKeyDown(e, handleCancelRevokeConfirm)}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleCancelRevokeConfirm()
          }}
        >
          <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlertIcon className="h-5 w-5 text-destructive" />
              <h3 id="revoke-dialog-title" className="text-lg font-semibold">
                {t('settings.security.revoke', locale)}
              </h3>
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
                {formatDate(revokeConfirmSession.createdAt, locale)}
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={handleCancelRevokeConfirm}
                autoFocus
              >
                {t('settings.security.cancel', locale)}
              </Button>
              <Button
                variant="destructive"
                disabled={revokingId === revokeConfirmId}
                onClick={handleConfirmRevoke}
              >
                {revokingId === revokeConfirmId
                  ? t('settings.security.revoking', locale)
                  : t('settings.security.revoke', locale)}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Revoke All Confirmation Dialog ───────────────────────── */}
      {showRevokeAll && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-all-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onKeyDown={(e) =>
            handleKeyDown(e, () => {
              setShowRevokeAll(false)
              setRevokeAllPassword('')
              setRevokeAllError(null)
            })
          }
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowRevokeAll(false)
              setRevokeAllPassword('')
              setRevokeAllError(null)
            }
          }}
        >
          <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-2">
              <ShieldAlertIcon className="h-5 w-5 text-destructive" />
              <h3 id="revoke-all-dialog-title" className="text-lg font-semibold">
                {t('settings.security.revokeAll', locale)}
              </h3>
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
                type="password"
                placeholder={t('settings.security.passwordPlaceholder', locale)}
                value={revokeAllPassword}
                onChange={(e) => {
                  setRevokeAllPassword(e.target.value)
                  setRevokeAllError(null)
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
              <Button
                variant="outline"
                onClick={() => {
                  setShowRevokeAll(false)
                  setRevokeAllPassword('')
                  setRevokeAllError(null)
                }}
              >
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
          </div>
        </div>
      )}
    </div>
  )
}