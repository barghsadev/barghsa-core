import { useState, useEffect, useCallback, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { timezoneText } from '@barghsa/i18n/timezone';
import { GlobeIcon, ClockIcon, Loader2Icon, SaveIcon, SearchIcon } from 'lucide-react';
import { Alert, AlertDescription, Button, Card, CardContent, Input } from '@barghsa/ui';
import { withCsrf } from '../../../lib/csrf.js';
import { useTimezone } from '../../../hooks/useTimezone.js';
import { useLocale } from '../../../hooks/useLocale.js';

export const Route = createFileRoute('/_app/settings/timezone')({
  component: SettingsTimezonePage,
});

// ─── IANA Timezone List ────────────────────────────────────────────────

/** Fallback hardcoded timezone list when Intl.supportedValuesOf is unavailable. */
const FALLBACK_TIMEZONES = [
  'Asia/Tehran',
  'Asia/Baghdad',
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Muscat',
  'Asia/Jerusalem',
  'Asia/Beirut',
  'Asia/Damascus',
  'Asia/Amman',
  'Asia/Kabul',
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Tashkent',
  'Asia/Yerevan',
  'Asia/Baku',
  'Asia/Tbilisi',
  'Asia/Ankara',
  'Asia/Istanbul',
  'Europe/Moscow',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Vienna',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Athens',
  'Europe/Bucharest',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Budapest',
  'Europe/Zurich',
  'Europe/Lisbon',
  'Europe/Dublin',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Tallinn',
  'Europe/Belgrade',
  'Europe/Sofia',
  'Europe/Zagreb',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'America/Halifax',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Panama',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'America/Santiago',
  'America/Bogota',
  'America/Lima',
  'America/Caracas',
  'America/La_Paz',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Taipei',
  'Asia/Bangkok',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Kuala_Lumpur',
  'Asia/Ho_Chi_Minh',
  'Asia/Ulaanbaatar',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Perth',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Pacific/Auckland',
  'Pacific/Fiji',
  'Pacific/Honolulu',
  'Pacific/Guam',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Tunis',
  'Africa/Algiers',
  'Africa/Addis_Ababa',
  'UTC',
  'Etc/UTC',
  'GMT',
  'Atlantic/Reykjavik',
  'Indian/Maldives',
  'Indian/Mauritius',
];

/** All IANA timezones from the Intl API, with fallback. */
function getAllTimezones(): string[] {
  try {
    const supported = Intl.supportedValuesOf('timeZone');
    if (Array.isArray(supported) && supported.length > 0) {
      return supported as string[];
    }
  } catch {
    // Intl.supportedValuesOf unavailable — use fallback
  }
  return FALLBACK_TIMEZONES;
}

const ALL_TIMEZONES = getAllTimezones();

// ─── Helpers ───────────────────────────────────────────────────────────

function getRegion(tz: string): string {
  if (tz === 'UTC' || tz === 'GMT' || tz === 'Etc/UTC') return 'UTC';
  const parts = tz.split('/');
  return parts[0] || 'Other';
}

function formatOffset(tz: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    return offset;
  } catch {
    return '';
  }
}

function getCurrentTimeInTimezone(tz: string, locale: 'en' | 'fa'): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return '--:--:--';
  }
}

function getCurrentDateInTimezone(tz: string, locale: 'en' | 'fa'): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date());
  } catch {
    return '';
  }
}

// ─── Page Component ────────────────────────────────────────────────────

function SettingsTimezonePage() {
  const locale = useLocale();
  const preference = useTimezone();

  const [timezone, setTimezone] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const loading = preference.status === 'loading';
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (preference.status === 'ready') setTimezone(preference.timezone);
  }, [preference.status, preference.timezone]);

  // ── Filter timezones based on search ────────────────────────────────

  const filteredTimezones = useMemo(() => {
    if (!searchQuery.trim()) return ALL_TIMEZONES;
    const query = searchQuery.toLowerCase();
    return ALL_TIMEZONES.filter(
      (tz) => tz.toLowerCase().includes(query) || getRegion(tz).toLowerCase().includes(query)
    );
  }, [searchQuery]);

  // ── Group filtered timezones by region ──────────────────────────────

  const groupedTimezones = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const tz of filteredTimezones) {
      const region = getRegion(tz);
      if (!groups[region]) groups[region] = [];
      groups[region].push(tz);
    }
    return groups;
  }, [filteredTimezones]);

  // ── Save handler ────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!timezone || saving || preference.status !== 'ready') return;

    setSaving(true);
    setSaveError('');
    setSaved(false);
    try {
      const response = await fetch('/api/user/settings/timezone', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ timezone }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => ({}));
        const message =
          body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
            ? body.message
            : '';
        setSaveError(message || timezoneText('error.save', locale));
        return;
      }

      const saved: unknown = await response.json();
      if (
        !saved ||
        typeof saved !== 'object' ||
        !('timezone' in saved) ||
        saved.timezone !== timezone
      ) {
        throw new Error('Invalid timezone confirmation');
      }
      window.dispatchEvent(new Event('barghsa:timezone-changed'));
      setSaved(true);
    } catch {
      setSaveError(timezoneText('error.save', locale));
    } finally {
      setSaving(false);
    }
  }, [timezone, locale, saving, preference.status]);

  // ── Preview ─────────────────────────────────────────────────────────

  const currentTime = timezone ? getCurrentTimeInTimezone(timezone, locale) : '';
  const currentDate = timezone ? getCurrentDateInTimezone(timezone, locale) : '';
  const offset = timezone ? formatOffset(timezone) : '';

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-6">{timezoneText('title', locale)}</h1>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <GlobeIcon className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold">{timezoneText('title', locale)}</h2>
          </div>

          <p className="text-sm text-muted-foreground">{timezoneText('description', locale)}</p>

          {/* Loading */}
          {loading && (
            <div className="text-center py-4 text-muted-foreground">
              <Loader2Icon className="mx-auto h-5 w-5 animate-spin mb-2" />
              <p className="text-sm">{t('settings.security.loading', locale)}</p>
            </div>
          )}

          {/* Timezone picker */}
          {preference.status === 'error' && (
            <div role="alert">
              {timezoneText('error.load', locale)}{' '}
              <Button variant="outline" onClick={preference.retry}>
                {timezoneText('retry', locale)}
              </Button>
            </div>
          )}
          {preference.status === 'ready' && (
            <div className="space-y-4">
              {/* Search input */}
              <div className="relative">
                <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={timezoneText('searchPlaceholder', locale)}
                  aria-label={timezoneText('searchPlaceholder', locale)}
                  className="ps-10"
                  disabled={saving}
                />
              </div>
              <select
                aria-label={timezoneText('title', locale)}
                size={10}
                value={timezone}
                onChange={(event) => {
                  setTimezone(event.target.value);
                  setSaved(false);
                  setSaveError('');
                }}
                disabled={saving}
                className="w-full rounded-lg border border-input bg-background p-2 text-foreground"
                dir="ltr"
              >
                {!filteredTimezones.includes(timezone) && (
                  <option value={timezone} hidden>
                    {timezone}
                  </option>
                )}
                {Object.entries(groupedTimezones).map(([region, zones]) => (
                  <optgroup key={region} label={region}>
                    {zones.map((zone) => (
                      <option key={zone} value={zone}>
                        {zone} ({formatOffset(zone)})
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {filteredTimezones.length === 0 && (
                <p role="status" className="text-sm text-muted-foreground">
                  {locale === 'fa' ? 'نتیجه‌ای یافت نشد' : 'No results found'}
                </p>
              )}

              {/* Time preview */}
              {timezone && (
                <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <ClockIcon className="h-4 w-4 text-muted-foreground" />
                    <span>{timezoneText('preview', locale)}</span>
                  </div>
                  <div className="text-2xl font-mono font-bold tracking-tight">{currentTime}</div>
                  <div className="text-sm text-muted-foreground">{currentDate}</div>
                  <div className="text-xs text-muted-foreground">
                    {timezone} ({offset})
                  </div>
                </div>
              )}
            </div>
          )}

          {saveError && (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}
          {saved && <p role="status">{timezoneText('success', locale)}</p>}
          {/* Save button */}
          <div className="flex justify-end">
            <Button
              onClick={handleSave}
              disabled={saving || preference.status !== 'ready' || !timezone}
              className="gap-2"
            >
              {saving ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <SaveIcon className="h-4 w-4" />
              )}
              {saving ? timezoneText('saving', locale) : t('settings.profile.save', locale)}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
