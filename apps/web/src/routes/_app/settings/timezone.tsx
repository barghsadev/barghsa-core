import { useState, useEffect, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { timezoneText } from '@barghsa/i18n/timezone';
import { GlobeIcon, ClockIcon, Loader2Icon, SaveIcon, SearchIcon } from 'lucide-react';
import { Button, Card, CardContent, Input } from '@barghsa/ui';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@barghsa/ui/form';
import {
  usePreferenceSettingsOwner,
  usePreferenceSettingsForm,
} from '../../../hooks/usePreferenceSettingsForm.js';
import { PreferenceSettingsStatus } from '../../../components/PreferenceSettingsStatus.js';
import { timezoneSettings, type TimezoneValues } from '../../../lib/preference-settings-form.js';
import { tPreferenceSettingsForms } from '@barghsa/i18n/preference-settings-forms';
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
  const locale = useLocale(),
    scope = usePreferenceSettingsOwner();
  const copy = (key: string) => tPreferenceSettingsForms(key, locale);
  const editor = usePreferenceSettingsForm<TimezoneValues, TimezoneValues>(scope, locale, {
    family: 'timezone',
    successMessage: copy('savedToast'),
    path: '/api/user/settings/timezone',
    initial: { timezone: '' },
    parse: timezoneSettings,
    values: (source) => source,
    body: (values) => ({ timezone: values.timezone }),
    confirmed: (source, values) => source.timezone === values.timezone,
    schema: (module, source) =>
      module.timezoneSettingsSchema(
        copy,
        source ? [...ALL_TIMEZONES, source.timezone] : ALL_TIMEZONES
      ),
    accepted: () => window.dispatchEvent(new Event('barghsa:timezone-changed')),
  });
  const timezone = editor.form.watch('timezone'),
    [searchQuery, setSearchQuery] = useState('');
  useEffect(() => {
    setSearchQuery('');
  }, [scope.key, scope.denied]);
  const filteredTimezones = useMemo(() => {
    if (!searchQuery.trim()) return ALL_TIMEZONES;
    const query = searchQuery.toLowerCase();
    return ALL_TIMEZONES.filter(
      (tz) => tz.toLowerCase().includes(query) || getRegion(tz).toLowerCase().includes(query)
    );
  }, [searchQuery]);
  const groupedTimezones = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const tz of filteredTimezones) {
      const region = getRegion(tz);
      (groups[region] ??= []).push(tz);
    }
    return groups;
  }, [filteredTimezones]);
  const currentTime = timezone ? getCurrentTimeInTimezone(timezone, locale) : '';
  const currentDate = timezone ? getCurrentDateInTimezone(timezone, locale) : '';
  const offset = timezone ? formatOffset(timezone) : '';
  return (
    <div className="container mx-auto max-w-2xl py-8 px-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-6">{timezoneText('title', locale)}</h1>
      {scope.denied ? (
        <p role="alert">{copy('forbidden')}</p>
      ) : (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <GlobeIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              {timezoneText('title', locale)}
            </h2>
            <p className="text-sm text-muted-foreground">{timezoneText('description', locale)}</p>
            <Form {...editor.form}>
              <form
                noValidate
                ref={editor.feedback.element}
                onSubmit={editor.submit}
                aria-label={timezoneText('title', locale)}
                className="space-y-4"
              >
                {editor.source && (
                  <>
                    <div className="relative">
                      <SearchIcon
                        className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => {
                          if (!scope.isLocked()) setSearchQuery(event.target.value);
                        }}
                        placeholder={timezoneText('searchPlaceholder', locale)}
                        aria-label={timezoneText('searchPlaceholder', locale)}
                        className="ps-10"
                        disabled={editor.locked}
                      />
                    </div>
                    <FormField
                      control={editor.form.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem id="settings-timezone">
                          <FormLabel>{timezoneText('title', locale)}</FormLabel>
                          <FormControl>
                            <select
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              aria-label={timezoneText('title', locale)}
                              size={10}
                              value={field.value}
                              onChange={(event) => {
                                if (!scope.isLocked() && editor.ready)
                                  field.onChange(event.target.value);
                              }}
                              disabled={editor.locked}
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
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {filteredTimezones.length === 0 && (
                      <p role="status" className="text-sm text-muted-foreground">
                        {locale === 'fa' ? 'نتیجه‌ای یافت نشد' : 'No results found'}
                      </p>
                    )}
                    {timezone && (
                      <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <ClockIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <span>{timezoneText('preview', locale)}</span>
                        </div>
                        <div className="text-2xl font-mono font-bold tracking-tight">
                          {currentTime}
                        </div>
                        <div className="text-sm text-muted-foreground">{currentDate}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">
                          {timezone} ({offset})
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="flex justify-end">
                  <Button type="submit" disabled={editor.locked} className="gap-2">
                    {editor.busy ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <SaveIcon className="h-4 w-4" aria-hidden="true" />
                    )}
                    {editor.busy
                      ? timezoneText('saving', locale)
                      : t('settings.profile.save', locale)}
                  </Button>
                </div>
              </form>
            </Form>
            <PreferenceSettingsStatus
              editor={editor}
              locale={locale}
              locked={scope.locked}
              enabled={scope.isCurrent()}
              loadError={timezoneText('error.load', locale)}
              retry={timezoneText('retry', locale)}
              success={timezoneText('success', locale)}
              saveError={timezoneText('error.save', locale)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
