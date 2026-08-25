import { useState, useEffect, useCallback } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import {
  BellIcon,
  SmartphoneIcon,
  MailIcon,
  BellRingIcon,
  Loader2Icon,
  SaveIcon,
  GlobeIcon,
  ShieldAlertIcon,
  UserIcon,
} from 'lucide-react'
import { Button, Card, CardContent } from '@barghsa/ui'
import { withCsrf } from '../../../lib/csrf.js'
import { useLocale } from '../../../hooks/useLocale.js'

export const Route = createFileRoute('/_app/settings/')({
  component: SettingsIndexPage,
})

// ─── Types ────────────────────────────────────────────────────────────

type NotificationChannel = 'SMS' | 'EMAIL' | 'IN_APP'

interface ChannelToggle {
  key: NotificationChannel
  icon: React.ReactNode
  label: string
  description: string
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsIndexPage() {
  const locale = useLocale()

  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // ── Fetch current preferences ──────────────────────────────────────

  const fetchPreferences = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/user/settings/notifications')
      if (response.ok) {
        const data: { channels: NotificationChannel[] } = await response.json()
        setChannels(data.channels)
      }
    } catch {
      // Silently fail — default preferences will be assumed
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPreferences()
  }, [fetchPreferences])

  // ── Toggle handler ─────────────────────────────────────────────────

  const handleToggle = (channel: NotificationChannel) => {
    if (channel === 'IN_APP') return // In-app is always enabled
    setChannels((prev) =>
      prev.includes(channel)
        ? prev.filter((c) => c !== channel)
        : [...prev, channel],
    )
  }

  // ── Save handler ───────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/user/settings/notifications', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ channels }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const message = (body as { message?: string }).message
        toast.error(message || t('settings.notifications.error.save', locale))
        // Re-fetch to reset state
        fetchPreferences()
        return
      }

      const data: { channels: NotificationChannel[] } = await response.json()
      setChannels(data.channels)
      toast.success(t('settings.notifications.success', locale))
    } catch {
      toast.error(t('settings.notifications.error.save', locale))
      fetchPreferences()
    } finally {
      setSaving(false)
    }
  }, [channels, locale, fetchPreferences])

  // ── Channel definitions ────────────────────────────────────────────

  const channelToggles: ChannelToggle[] = [
    {
      key: 'SMS',
      icon: <SmartphoneIcon className="h-5 w-5" />,
      label: t('settings.notifications.channel.SMS', locale),
      description: locale === 'fa' ? 'دریافت پیامک' : 'Receive SMS',
    },
    {
      key: 'EMAIL',
      icon: <MailIcon className="h-5 w-5" />,
      label: t('settings.notifications.channel.EMAIL', locale),
      description: locale === 'fa' ? 'دریافت ایمیل' : 'Receive email',
    },
    {
      key: 'IN_APP',
      icon: <BellRingIcon className="h-5 w-5" />,
      label: t('settings.notifications.channel.IN_APP', locale),
      description: locale === 'fa' ? 'اعلان درون برنامه‌ای' : 'In-app notifications',
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-6">{t('dashboard.nav.settings', locale)}</h1>

      {/* Settings navigation links */}
      <Card>
        <CardContent className="pt-6 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <GlobeIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{locale === 'fa' ? 'تنظیمات دیگر' : 'Other Settings'}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <a
              href="/settings/profile"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.profile.title', locale)}</span>
            </a>
            <a
              href="/settings/username"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <UserIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.username.title', locale)}</span>
            </a>
            <a
              href="/settings/security"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <ShieldAlertIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.security.title', locale)}</span>
            </a>
            <a
              href="/settings/timezone"
              className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50 transition-colors"
            >
              <GlobeIcon className="h-4 w-4 text-muted-foreground" />
              <span>{t('settings.timezone.title', locale)}</span>
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Notification Preferences */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <BellIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {t('settings.notifications.title', locale)}
            </h2>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('settings.notifications.description', locale)}
          </p>

          {/* Loading */}
          {loading && (
            <div className="text-center py-4 text-muted-foreground">
              <Loader2Icon className="mx-auto h-5 w-5 animate-spin mb-2" />
              <p className="text-sm">{t('settings.security.loading', locale)}</p>
            </div>
          )}

          {/* Toggle switches */}
          {!loading && (
            <div className="space-y-3">
              {channelToggles.map((channel) => {
                const isEnabled = channels.includes(channel.key)
                const isAlwaysOn = channel.key === 'IN_APP'

                return (
                  <div
                    key={channel.key}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      isEnabled ? 'bg-muted/50' : ''
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={isEnabled ? 'text-primary' : 'text-muted-foreground'}>
                        {channel.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium">{channel.label}</p>
                        <p className="text-xs text-muted-foreground">{channel.description}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isEnabled}
                      disabled={isAlwaysOn}
                      onClick={() => handleToggle(channel.key)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50 ${
                        isEnabled ? 'bg-primary' : 'bg-input'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${
                          isEnabled ? 'translate-x-6' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Hint text */}
          <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
            {t('settings.notifications.hint', locale)}
          </p>

          {/* Save button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving || loading}
              className="gap-2"
            >
              {saving ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {saving
                ? t('settings.notifications.saving', locale)
                : t('settings.profile.save', locale)
              }
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}