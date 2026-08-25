import { useState, useEffect, useCallback, useMemo } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { t, type Locale } from '@barghsa/i18n'
import {
  GlobeIcon,
  ClockIcon,
  Loader2Icon,
  SaveIcon,
  SearchIcon,
  CheckIcon,
} from 'lucide-react'
import { Button, Card, CardContent, Label } from '@barghsa/ui'
import { withCsrf } from '../../../lib/csrf.js'
import { useLocale } from '../../../hooks/useLocale.js'

export const Route = createFileRoute('/_app/settings/timezone')({
  component: SettingsTimezonePage,
})

// ─── IANA Timezone List ────────────────────────────────────────────────

/** Fallback hardcoded timezone list when Intl.supportedValuesOf is unavailable. */
const FALLBACK_TIMEZONES = [
  'Asia/Tehran', 'Asia/Baghdad', 'Asia/Riyadh', 'Asia/Dubai',
  'Asia/Kuwait', 'Asia/Qatar', 'Asia/Muscat', 'Asia/Jerusalem',
  'Asia/Beirut', 'Asia/Damascus', 'Asia/Amman', 'Asia/Kabul',
  'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Tashkent',
  'Asia/Yerevan', 'Asia/Baku', 'Asia/Tbilisi', 'Asia/Ankara',
  'Asia/Istanbul', 'Europe/Moscow', 'Europe/London', 'Europe/Paris',
  'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome', 'Europe/Amsterdam',
  'Europe/Brussels', 'Europe/Vienna', 'Europe/Stockholm', 'Europe/Oslo',
  'Europe/Copenhagen', 'Europe/Helsinki', 'Europe/Athens',
  'Europe/Bucharest', 'Europe/Warsaw', 'Europe/Prague', 'Europe/Budapest',
  'Europe/Zurich', 'Europe/Lisbon', 'Europe/Dublin', 'Europe/Riga',
  'Europe/Vilnius', 'Europe/Tallinn', 'Europe/Belgrade', 'Europe/Sofia',
  'Europe/Zagreb', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Phoenix', 'America/Anchorage',
  'America/Halifax', 'America/Toronto', 'America/Vancouver',
  'America/Mexico_City', 'America/Panama', 'America/Sao_Paulo',
  'America/Buenos_Aires', 'America/Santiago', 'America/Bogota',
  'America/Lima', 'America/Caracas', 'America/La_Paz', 'Asia/Tokyo',
  'Asia/Seoul', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore',
  'Asia/Taipei', 'Asia/Bangkok', 'Asia/Jakarta', 'Asia/Manila',
  'Asia/Kuala_Lumpur', 'Asia/Ho_Chi_Minh', 'Asia/Ulaanbaatar',
  'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth',
  'Australia/Brisbane', 'Australia/Adelaide', 'Pacific/Auckland',
  'Pacific/Fiji', 'Pacific/Honolulu', 'Pacific/Guam', 'Africa/Cairo',
  'Africa/Casablanca', 'Africa/Johannesburg', 'Africa/Lagos',
  'Africa/Nairobi', 'Africa/Tunis', 'Africa/Algiers', 'Africa/Addis_Ababa',
  'UTC', 'Etc/UTC', 'GMT', 'Atlantic/Reykjavik', 'Indian/Maldives',
  'Indian/Mauritius',
]

/** All IANA timezones from the Intl API, with fallback. */
function getAllTimezones(): string[] {
  try {
    const supported = (Intl as any).supportedValuesOf('timeZone')
    if (Array.isArray(supported) && supported.length > 0) {
      return supported as string[]
    }
  } catch {
    // Intl.supportedValuesOf unavailable — use fallback
  }
  return FALLBACK_TIMEZONES
}

const ALL_TIMEZONES = getAllTimezones()

// ─── Helpers ───────────────────────────────────────────────────────────

function getRegion(tz: string): string {
  if (tz === 'UTC' || tz === 'GMT' || tz === 'Etc/UTC') return 'UTC'
  const parts = tz.split('/')
  return parts[0] || 'Other'
}

function formatOffset(tz: string): string {
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    })
    const parts = formatter.formatToParts(now)
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value || ''
    return offset
  } catch {
    return ''
  }
}

function getCurrentTimeInTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date())
  } catch {
    return '--:--:--'
  }
}

function getCurrentDateInTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date())
  } catch {
    return ''
  }
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsTimezonePage() {
  const locale = useLocale()

  const [timezone, setTimezone] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // ── Fetch current timezone ──────────────────────────────────────────

  const fetchTimezone = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/user/settings/timezone')
      if (response.ok) {
        const data: { timezone: string } = await response.json()
        setTimezone(data.timezone)
      }
    } catch {
      // Silently fail — default timezone will be assumed
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTimezone()
  }, [fetchTimezone])

  // ── Filter timezones based on search ────────────────────────────────

  const filteredTimezones = useMemo(() => {
    if (!searchQuery.trim()) return ALL_TIMEZONES
    const query = searchQuery.toLowerCase()
    return ALL_TIMEZONES.filter(
      (tz) =>
        tz.toLowerCase().includes(query) ||
        getRegion(tz).toLowerCase().includes(query),
    )
  }, [searchQuery])

  // ── Group filtered timezones by region ──────────────────────────────

  const groupedTimezones = useMemo(() => {
    const groups: Record<string, string[]> = {}
    for (const tz of filteredTimezones) {
      const region = getRegion(tz)
      if (!groups[region]) groups[region] = []
      groups[region].push(tz)
    }
    return groups
  }, [filteredTimezones])

  // ── Save handler ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!timezone) return

    setSaving(true)
    try {
      const response = await fetch('/api/user/settings/timezone', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ timezone }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const message = (body as { message?: string }).message
        toast.error(message || t('settings.timezone.error.save', locale))
        return
      }

      toast.success(t('settings.timezone.success', locale))
    } catch {
      toast.error(t('settings.timezone.error.save', locale))
    } finally {
      setSaving(false)
    }
  }, [timezone, locale])

  // ── Preview ─────────────────────────────────────────────────────────

  const currentTime = timezone ? getCurrentTimeInTimezone(timezone) : ''
  const currentDate = timezone ? getCurrentDateInTimezone(timezone) : ''
  const offset = timezone ? formatOffset(timezone) : ''

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-6">{t('settings.timezone.title', locale)}</h1>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <GlobeIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {t('settings.timezone.title', locale)}
            </h2>
          </div>

          <p className="text-sm text-muted-foreground">
            {t('settings.timezone.description', locale)}
          </p>

          {/* Loading */}
          {loading && (
            <div className="text-center py-4 text-muted-foreground">
              <Loader2Icon className="mx-auto h-5 w-5 animate-spin mb-2" />
              <p className="text-sm">{t('settings.security.loading', locale)}</p>
            </div>
          )}

          {/* Timezone picker */}
          {!loading && (
            <div className="space-y-4">
              {/* Search input */}
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('settings.timezone.searchPlaceholder', locale)}
                  className="flex w-full rounded-lg border border-input bg-transparent pl-10 pr-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  dir={locale === 'fa' ? 'rtl' : 'ltr'}
                  role="combobox"
                  aria-expanded={filteredTimezones.length > 0}
                  aria-controls="timezone-listbox"
                  aria-autocomplete="list"
                  aria-activedescendant={timezone ? `tz-${timezone.replace(/\//g, '-')}` : undefined}
                />
              </div>

              {/* Timezone list */}
              <div
                id="timezone-listbox"
                role="listbox"
                aria-label={t('settings.timezone.title', locale)}
                className="max-h-72 overflow-y-auto border rounded-lg"
              >
                {Object.entries(groupedTimezones).map(([region, tzs]) => (
                  <div key={region}>
                    <div className="sticky top-0 bg-muted/80 backdrop-blur px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {region}
                    </div>
                    {tzs.map((tz) => {
                      const isSelected = tz === timezone
                      return (
                        <button
                          key={tz}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          id={`tz-${tz.replace(/\//g, '-')}`}
                          onClick={() => setTimezone(tz)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-sm text-left transition-colors hover:bg-accent hover:text-accent-foreground ${
                            isSelected ? 'bg-accent font-medium text-accent-foreground' : ''
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            {isSelected && (
                              <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                            )}
                            <span className={isSelected ? 'ml-0' : 'ml-5'}>
                              {tz}
                            </span>
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatOffset(tz)}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ))}

                {filteredTimezones.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {locale === 'fa' ? 'نتیجه‌ای یافت نشد' : 'No results found'}
                  </div>
                )}
              </div>

              {/* Time preview */}
              {timezone && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ClockIcon className="h-4 w-4 text-muted-foreground" />
                    <span>{t('settings.timezone.preview', locale)}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold tracking-tight">
                    {currentTime}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {currentDate}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {timezone} ({offset})
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Save button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving || loading || !timezone}
              className="gap-2"
            >
              {saving ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {saving
                ? t('settings.timezone.saving', locale)
                : t('settings.profile.save', locale)
              }
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}