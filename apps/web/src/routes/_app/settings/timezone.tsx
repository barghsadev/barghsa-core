import { useState, useEffect, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { timezoneCityName, timezoneText } from '@barghsa/i18n/timezone';
import { ClockIcon, SearchIcon } from 'lucide-react';
import { Button, Input } from '@barghsa/ui';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@barghsa/ui/form';
import {
  usePreferenceSettingsOwner,
  usePreferenceSettingsForm,
} from '../../../hooks/usePreferenceSettingsForm.js';
import { PreferenceSettingsStatus } from '../../../components/PreferenceSettingsStatus.js';
import {
  RecordEditorActions,
  recordEditorSurface,
} from '../../../components/RecordEditorLayout.js';
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

const ALL_TIMEZONES = [...new Set(['Asia/Tehran', 'UTC', ...getAllTimezones()])];

// ─── Helpers ───────────────────────────────────────────────────────────

function searchTerms(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[_/\s\u200c]+/g, ' ')
    .trim();
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
  const savedTimezone = editor.source?.timezone;
  const timezoneOptions = useMemo(() => {
    if (!savedTimezone) return [];
    const query = searchTerms(searchQuery);
    return [...new Set([savedTimezone, ...ALL_TIMEZONES])].flatMap((value) => {
      const city = timezoneCityName(value, locale);
      if (query && !searchTerms(value).includes(query) && !searchTerms(city).includes(query))
        return [];
      return [{ value, label: city ? `${city} · ${value}` : value }];
    });
  }, [savedTimezone, searchQuery, locale]);
  const currentTime = timezone ? getCurrentTimeInTimezone(timezone, locale) : '';
  const currentDate = timezone ? getCurrentDateInTimezone(timezone, locale) : '';
  const offset = timezone ? formatOffset(timezone) : '';
  return (
    <div className="mx-auto max-w-2xl min-w-0 space-y-4" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{timezoneText('title', locale)}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {timezoneText('description', locale)}
        </p>
      </header>
      {scope.denied ? (
        <p role="alert">{copy('forbidden')}</p>
      ) : (
        <>
          <Form {...editor.form}>
            <form
              noValidate
              ref={editor.feedback.element}
              onSubmit={editor.submit}
              aria-label={timezoneText('title', locale)}
              className={recordEditorSurface}
            >
              {editor.source && (
                <div className="grid min-w-0 gap-4 px-4 py-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] sm:gap-5 sm:px-6">
                  <div className="min-w-0 space-y-2">
                    <div className="relative">
                      <SearchIcon
                        className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => {
                          if (!scope.isLocked()) setSearchQuery(event.target.value);
                        }}
                        placeholder={copy('timezoneSearchExample')}
                        aria-label={timezoneText('searchPlaceholder', locale)}
                        className="ps-9"
                        disabled={editor.locked}
                      />
                    </div>
                    <FormField
                      control={editor.form.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem id="settings-timezone">
                          <FormLabel>{copy('timezoneZoneLabel')}</FormLabel>
                          <FormControl>
                            <select
                              name={field.name}
                              ref={field.ref}
                              onBlur={field.onBlur}
                              aria-required="true"
                              size={4}
                              value={field.value}
                              onChange={(event) => {
                                if (!scope.isLocked() && editor.ready)
                                  field.onChange(event.target.value);
                              }}
                              disabled={editor.locked}
                              className="w-full min-w-0 rounded-lg border border-input bg-background p-2 text-sm text-foreground"
                              dir="ltr"
                            >
                              {!timezoneOptions.some((option) => option.value === timezone) && (
                                <option value={timezone} hidden>
                                  {timezone}
                                </option>
                              )}
                              {timezoneOptions.map(({ value, label }) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {timezoneOptions.length === 0 && (
                      <p role="status" className="text-sm text-muted-foreground">
                        {copy('timezoneNoMatches')}
                      </p>
                    )}
                  </div>
                  {timezone && (
                    <section
                      aria-labelledby="timezone-preview-title"
                      className="min-w-0 self-start space-y-2 rounded-lg border bg-muted/35 p-3 sm:p-4"
                    >
                      <h2
                        id="timezone-preview-title"
                        className="flex items-center gap-2 text-sm font-medium"
                      >
                        <ClockIcon
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                        {copy('timezonePreview')}
                      </h2>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 sm:flex-col">
                        <bdi className="text-xl font-semibold tabular-nums">{currentTime}</bdi>
                        <span className="text-sm text-muted-foreground">{currentDate}</span>
                      </div>
                      <bdi
                        className="block text-xs text-muted-foreground [overflow-wrap:anywhere]"
                        dir="ltr"
                      >
                        {timezone} ({offset})
                      </bdi>
                      {savedTimezone && timezone !== savedTimezone && (
                        <p className="border-t pt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {timezoneText('savedZone', locale)} <bdi>{savedTimezone}</bdi>
                        </p>
                      )}
                    </section>
                  )}
                </div>
              )}
              <RecordEditorActions
                secondary={
                  <PreferenceSettingsStatus
                    editor={editor}
                    locale={locale}
                    locked={scope.locked}
                    enabled={scope.isCurrent()}
                    loadError={timezoneText('error.load', locale)}
                    retry={timezoneText('retry', locale)}
                    success={timezoneText('success', locale)}
                    saveError={timezoneText('error.save', locale)}
                    compactRefresh
                  />
                }
              >
                <Button type="submit" loading={editor.busy} disabled={editor.locked}>
                  {editor.busy
                    ? timezoneText('saving', locale)
                    : t('settings.profile.save', locale)}
                </Button>
              </RecordEditorActions>
            </form>
          </Form>
        </>
      )}
    </div>
  );
}
