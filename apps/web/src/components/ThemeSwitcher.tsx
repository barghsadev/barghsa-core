import { Moon, Sun, Monitor, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { shellText } from '@barghsa/i18n/shell';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';

type ThemeMode = 'light' | 'dark' | null;

function readMode(value: unknown): ThemeMode | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const mode = (value as { mode?: unknown }).mode;
  return mode === null || mode === 'light' || mode === 'dark' ? mode : undefined;
}

/** A saved account choice takes precedence over the active admin default. */
export function ThemeSwitcher() {
  const locale = useLocale();
  const { userMode, setUserMode } = useBrandConfig();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const request = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/user/settings/theme', { signal: request.signal });
        if (!response.ok) throw new Error('Theme preference unavailable');
        const mode = readMode(await response.json());
        if (mode === undefined) throw new Error('Invalid theme preference');
        if (!request.signal.aborted) setUserMode(mode);
      } catch {
        // Keep the admin default when the preference is unavailable.
      } finally {
        if (!request.signal.aborted) setReady(true);
      }
    })();
    return () => {
      request.abort();
      saveRequest.current?.abort();
    };
  }, [setUserMode]);

  const update = async (mode: ThemeMode) => {
    const request = new AbortController();
    saveRequest.current = request;
    setSaving(true);
    setError(false);
    try {
      const response = await fetch('/api/user/settings/theme', {
        method: 'PUT',
        signal: request.signal,
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode }),
      });
      if (!response.ok || readMode(await response.json()) !== mode) throw new Error('Save failed');
      if (!request.signal.aborted) setUserMode(mode);
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted) setSaving(false);
      if (saveRequest.current === request) saveRequest.current = null;
    }
  };

  const Icon = userMode === 'light' ? Sun : userMode === 'dark' ? Moon : Monitor;
  return (
    <label className="inline-flex items-center gap-1.5 text-sm">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{shellText('theme', locale)}</span>
      <span className="relative inline-flex">
        <select
          aria-label={shellText('theme', locale)}
          value={userMode ?? 'default'}
          disabled={!ready || saving}
          onChange={(event) =>
            void update(event.target.value === 'default' ? null : (event.target.value as ThemeMode))
          }
          className="min-h-11 max-w-28 appearance-none rounded-md border border-input bg-card ps-2 pe-7 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:max-w-none"
        >
          <option value="default">{shellText('themeDefault', locale)}</option>
          <option value="light">{shellText('themeLight', locale)}</option>
          <option value="dark">{shellText('themeDark', locale)}</option>
        </select>
        <ChevronDown
          className="pointer-events-none absolute end-2 top-1/2 size-3.5 -translate-y-1/2"
          aria-hidden="true"
        />
      </span>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {shellText('themeError', locale)}
        </span>
      )}
    </label>
  );
}
