import { Moon, Sun } from 'lucide-react';
import { useEffect, useRef, useState, useId } from 'react';
import { NativeSelect } from '@barghsa/ui';
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

/** Keep account preference writes authoritative; published administrator policy wins. */
export function ThemeSwitcher() {
  const locale = useLocale();
  const { userMode, setUserMode, themePolicy, loading, resolvedTheme } = useBrandConfig();
  const managed = themePolicy !== 'system';
  const descriptionId = useId();
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const saveRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const request = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/user/settings/theme', { signal: request.signal });
        if (!response.ok) throw new Error();
        const mode = readMode(await response.json());
        if (mode === undefined) throw new Error();
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
      if (!response.ok || readMode(await response.json()) !== mode) throw new Error();
      if (!request.signal.aborted) setUserMode(mode);
    } catch {
      if (!request.signal.aborted) setError(true);
    } finally {
      if (!request.signal.aborted) setSaving(false);
      if (saveRequest.current === request) saveRequest.current = null;
    }
  };

  const shownMode = managed ? themePolicy : userMode;
  const Icon = resolvedTheme === 'dark' ? Moon : Sun;
  return (
    <label className="inline-flex max-w-full flex-wrap items-center gap-1.5 text-sm">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="sr-only">{shellText('theme', locale)}</span>
      <NativeSelect
        aria-label={shellText('theme', locale)}
        value={shownMode ?? 'default'}
        aria-describedby={managed ? descriptionId : undefined}
        disabled={!ready || saving || loading || managed}
        onChange={(event) =>
          void update(event.target.value === 'default' ? null : (event.target.value as ThemeMode))
        }
        className="max-w-28 sm:max-w-none"
      >
        <option value="default">{shellText('themeDefault', locale)}</option>
        <option value="light">{shellText('themeLight', locale)}</option>
        <option value="dark">{shellText('themeDark', locale)}</option>
      </NativeSelect>
      {managed && (
        <span id={descriptionId} className="basis-full text-xs text-muted-foreground">
          {shellText('themeManaged', locale)}
        </span>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {shellText('themeError', locale)}
        </span>
      )}
    </label>
  );
}
