import { readWithDeadline, ServerQueryError } from '../lib/server-query-client.js';
import { Moon, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, NativeSelect } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { withCsrf } from '../lib/csrf.js';
import { sendToast } from '../lib/toast-api.js';
import { useBrandConfig } from '../providers/BrandThemeProvider.js';

type ThemeMode = 'light' | 'dark' | null;

function readMode(value: unknown): ThemeMode | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const mode = (value as { mode?: unknown }).mode;
  return mode === null || mode === 'light' || mode === 'dark' ? mode : undefined;
}

/** Keep account preference writes authoritative; published administrator policy wins. */
export function ThemeSwitcher() {
  const actor = useAccountUser();
  const { themePolicy, loading } = useBrandConfig();
  if (loading || themePolicy !== 'system') return null;
  return <OwnedThemeSwitcher key={actor} />;
}

function OwnedThemeSwitcher() {
  const locale = useLocale();
  const { theme, setTheme, resolvedTheme } = useBrandConfig();
  const [state, setState] = useState<
    'loading' | 'ready' | 'saving' | 'denied' | 'unconfirmed' | 'checking'
  >('loading');
  const active = useRef<AbortController | null>(null);

  const requestPreference = useCallback(
    async (save?: { mode: ThemeMode; locale: 'fa' | 'en' }, recheck = false) => {
      if (active.current) return;
      const request = new AbortController();
      active.current = request;
      if (save || recheck) setState(save ? 'saving' : 'checking');
      try {
        const mode = await readWithDeadline(request.signal, async (signal) => {
          const response = await fetch(
            '/api/user/settings/theme',
            save
              ? {
                  method: 'PUT',
                  signal,
                  headers: withCsrf({ 'Content-Type': 'application/json' }),
                  body: JSON.stringify({ mode: save.mode }),
                }
              : { signal, cache: 'no-store' }
          );
          if (!response.ok) throw new ServerQueryError(response.status);
          const mode = readMode(await response.json());
          if (mode === undefined || (save && mode !== save.mode)) throw new Error();
          return mode;
        });
        setTheme(mode ?? 'system');
        setState('ready');
        if (save) sendToast('success', shellText('themeSaved', save.locale));
      } catch (error) {
        if (request.signal.aborted) return;
        if (save && error instanceof ServerQueryError && error.status >= 400 && error.status < 500)
          setState('denied');
        else setState(save || recheck ? 'unconfirmed' : 'ready');
      } finally {
        if (active.current === request) active.current = null;
      }
    },
    [setTheme]
  );

  useEffect(() => {
    void requestPreference();
    return () => {
      active.current?.abort();
      active.current = null;
    };
  }, [requestPreference]);

  const Icon = resolvedTheme === 'dark' ? Moon : Sun;
  const editable = state === 'ready' || state === 'denied';
  const needsCheck = state === 'unconfirmed' || state === 'checking';
  return (
    <div className="inline-flex max-w-full flex-wrap items-center gap-1.5 text-sm">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <NativeSelect
        aria-label={shellText('theme', locale)}
        value={theme === 'system' ? 'default' : theme}
        disabled={!editable}
        onChange={(event) => {
          if (!editable) return;
          const mode = event.target.value === 'default' ? null : (event.target.value as ThemeMode);
          void requestPreference({ mode, locale });
        }}
        className="max-w-28 sm:max-w-none"
      >
        <option value="default">{shellText('themeDefault', locale)}</option>
        <option value="light">{shellText('themeLight', locale)}</option>
        <option value="dark">{shellText('themeDark', locale)}</option>
      </NativeSelect>
      {(needsCheck || state === 'denied') && (
        <div className="basis-full space-y-1 text-xs text-destructive">
          <p role="alert">{shellText(needsCheck ? 'changeUnconfirmed' : 'themeError', locale)}</p>
          {needsCheck && (
            <Button
              type="button"
              variant="outline"
              disabled={state === 'checking'}
              onClick={() => void requestPreference(undefined, true)}
            >
              {shellText('checkTheme', locale)}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
