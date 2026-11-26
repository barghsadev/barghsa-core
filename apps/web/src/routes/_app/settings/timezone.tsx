import { useState, useEffect, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { timezoneCityName, timezoneText } from '@barghsa/i18n/timezone';
import { ClockIcon, SearchIcon } from 'lucide-react';
import { Button, Input, Label } from '@barghsa/ui';
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
import { ALL_TIMEZONES, timezoneSearchTerms } from '../../../lib/timezone-options.js';

export const Route = createFileRoute('/_app/settings/timezone')({
  component: SettingsTimezonePage,
});

// ─── Helpers ───────────────────────────────────────────────────────────

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
    const query = timezoneSearchTerms(searchQuery);
    return [...new Set([savedTimezone, ...ALL_TIMEZONES])].flatMap((value) => {
      const city = timezoneCityName(value, locale);
      if (
        query &&
        !timezoneSearchTerms(value).includes(query) &&
        !timezoneSearchTerms(city).includes(query)
      )
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
                    <div className="space-y-1.5">
                      <Label htmlFor="settings-timezone-search">
                        {copy('timezoneSearchExample')}
                      </Label>
                      <div className="relative">
                        <SearchIcon
                          className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <Input
                          id="settings-timezone-search"
                          type="search"
                          value={searchQuery}
                          onChange={(event) => {
                            if (!scope.isLocked()) setSearchQuery(event.target.value);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                              event.preventDefault();
                          }}
                          className="ps-9"
                          disabled={editor.locked}
                        />
                      </div>
                    </div>
                    <FormField
                      control={editor.form.control}
                      name="timezone"
                      render={({ field }) => (
                        <FormItem id="settings-timezone" hidden={timezoneOptions.length === 0}>
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
                      <p
                        role="status"
                        className="rounded-md bg-muted/35 px-3 py-2 text-sm text-muted-foreground"
                      >
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
