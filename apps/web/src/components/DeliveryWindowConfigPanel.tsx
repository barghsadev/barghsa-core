import { adminControlsText } from '@barghsa/i18n/admin-controls';
import { validateWindowConfig } from '@barghsa/shared/notifications';
import { withCsrf } from '../lib/csrf.js';
import { useState, useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import type { Locale } from '@barghsa/i18n/app';

/**
 * Delivery-window configuration panel (E-05, T-05.03.03).
 *
 * Admin section under Notifications settings that lets an admin configure the
 * daily daytime delivery window: a start-hour selector, an end-hour selector,
 * and a timezone selector. Rules enforced both client-side and server-side:
 *  - start < end
 *  - window length >= 4 hours
 *  - a valid IANA timezone
 *
 * The worker (T-05.03.02) reads this from `app_config` via
 * `loadDeliveryWindowConfig`, gating external-channel daytime messages outside
 * the window. Changes take effect for newly-scheduled messages; already
 * scheduled messages keep their original timing (per story T-05.03.03).
 */

interface DeliveryWindowConfig {
  timezone: string;
  startHour: number;
  endHour: number;
}

interface DeliveryWindowConfigPanelProps {
  uiLocale: Locale;
}

const DEFAULT_WINDOW: DeliveryWindowConfig = { timezone: 'Asia/Tehran', startHour: 9, endHour: 21 };

/** Common IANA timezones relevant to the platform's Iranian user base. */
const TIMEZONE_OPTIONS = [
  'Asia/Tehran',
  'UTC',
  'Asia/Dubai',
  'Europe/Berlin',
  'Europe/London',
  'America/New_York',
];

/** Generate 0–23 hour options (as integers, formatters render as HH:00). */
function hourOptions(): number[] {
  const out: number[] = [];
  for (let h = 0; h < 24; h++) out.push(h);
  return out;
}

/** Render an hour-of-day as an HH:00 clock string (24h). */
function formatHour(hour: number): string {
  const hh = String(hour).padStart(2, '0');
  return `${hh}:00`;
}

function readWindow(body: unknown, message = 'Invalid delivery window'): DeliveryWindowConfig {
  const value = body as Partial<DeliveryWindowConfig> | null;
  if (
    !value ||
    typeof value.startHour !== 'number' ||
    typeof value.endHour !== 'number' ||
    !validateWindowConfig(value).ok
  )
    throw new Error(message);
  return value as DeliveryWindowConfig;
}

export default function DeliveryWindowConfigPanel({ uiLocale }: DeliveryWindowConfigPanelProps) {
  const [config, setConfig] = useState<DeliveryWindowConfig | null>(null);
  const [timezone, setTimezone] = useState(DEFAULT_WINDOW.timezone);
  const [startHour, setStartHour] = useState(DEFAULT_WINDOW.startHour);
  const [endHour, setEndHour] = useState(DEFAULT_WINDOW.endHour);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientIssue, setClientIssue] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const res = await fetch('/api/admin/config/delivery-window', { signal: controller.signal });
        if (!res.ok) throw new Error('Read failed');
        const data = readWindow(await res.json());
        if (controller.signal.aborted) return;
        setConfig(data);
        setTimezone(data.timezone);
        setStartHour(data.startHour);
        setEndHour(data.endHour);
      } catch {
        if (!controller.signal.aborted) {
          setConfig(null);
          setLoadFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [reload]);

  /** Client-side validation mirroring the shared rules (T-05.03.03). */
  function validate(start: number, end: number): string | null {
    if (start >= end) return t('admin.notifications.window.errBeforeEnd', uiLocale);
    if (end - start < 4) return t('admin.notifications.window.errTooShort', uiLocale);
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!config || loading || loadFailed || savingRef.current) return;
    const issue = validate(startHour, endHour);
    if (issue) {
      setClientIssue(issue);
      return;
    }
    setClientIssue(null);
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch('/api/admin/config/delivery-window', {
        method: 'PUT',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          timezone,
          start_hour: startHour,
          end_hour: endHour,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const message = (errData as { message?: unknown }).message;
        throw new Error(
          typeof message === 'string'
            ? message
            : t('admin.notifications.window.saveFailed', uiLocale)
        );
      }
      const data = readWindow(
        await res.json(),
        t('admin.notifications.window.saveFailed', uiLocale)
      );
      if (data.timezone !== timezone || data.startHour !== startHour || data.endHour !== endHour)
        throw new Error(t('admin.notifications.window.saveFailed', uiLocale));
      setConfig(data);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('admin.notifications.window.saveFailed', uiLocale)
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (loading && !config) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6 text-gray-500">
        {t('admin.notifications.window.loading', uiLocale)}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="delivery-window-title"
      className="bg-white rounded-lg border border-gray-200 p-6 space-y-4"
    >
      <div>
        <h2 id="delivery-window-title" className="text-lg font-semibold">
          {t('admin.notifications.window.title', uiLocale)}
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {t('admin.notifications.window.description', uiLocale)}
        </p>
      </div>

      {loadFailed && (
        <div role="alert">
          <p>{t('admin.notifications.window.loadFailed', uiLocale)}</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
            className="underline"
          >
            {adminControlsText('retry', uiLocale)}
          </button>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded relative"
        >
          {error}
          <button
            type="button"
            aria-label={t('admin.notifications.dismissError', uiLocale)}
            onClick={() => setError(null)}
            className="absolute top-2 end-2 text-red-500 hover:text-red-700"
          >
            ✕
          </button>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        onChange={() => {
          setSaved(false);
          setClientIssue(null);
        }}
        noValidate
      >
        <fieldset disabled={!config || loading || saving} className="space-y-4">
          <legend className="sr-only">{t('admin.notifications.window.title', uiLocale)}</legend>
          {/* Timezone */}
          <div>
            <label
              htmlFor="delivery-window-timezone"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              {t('admin.notifications.window.timezone', uiLocale)}{' '}
              <span className="text-red-500">*</span>
            </label>
            <select
              id="delivery-window-timezone"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              {!TIMEZONE_OPTIONS.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {TIMEZONE_OPTIONS.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>

          {/* Start / End hour */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="delivery-window-start"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('admin.notifications.window.start', uiLocale)}{' '}
                <span className="text-red-500">*</span>
              </label>
              <select
                id="delivery-window-start"
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                {hourOptions().map((h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="delivery-window-end"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                {t('admin.notifications.window.end', uiLocale)}{' '}
                <span className="text-red-500">*</span>
              </label>
              <select
                id="delivery-window-end"
                value={endHour}
                onChange={(e) => setEndHour(Number(e.target.value))}
                className="w-full border border-gray-300 rounded px-3 py-2"
              >
                {hourOptions().map((h) => (
                  <option key={h} value={h}>
                    {formatHour(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {clientIssue && (
            <p role="alert" className="text-sm text-red-600">
              {clientIssue}
            </p>
          )}

          {config && (
            <p className="text-xs text-gray-400">
              {t('admin.notifications.window.current', uiLocale)}:{' '}
              <span className="font-mono">
                {config.timezone} {formatHour(config.startHour)}–{formatHour(config.endHour)}
              </span>
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving
                ? t('admin.notifications.window.saving', uiLocale)
                : t('admin.notifications.window.save', uiLocale)}
            </button>
            {saved && (
              <span role="status" className="text-sm text-green-600">
                {t('admin.notifications.window.saved', uiLocale)}
              </span>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}
