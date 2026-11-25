import { useEffect, useRef, useState } from 'react';
import { Button, ResultGlyph } from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { readWithDeadline } from '../lib/server-query-client.js';

type Alternative = { value: string; label: string; path: string };

export function statusAlternatives(
  values: readonly string[],
  status: string,
  label: (status: string) => string,
  endpoint: string,
  criteria: string | Record<string, string> = {}
) {
  return values
    .filter((value) => value !== status && value !== 'all')
    .map((value) => {
      const query = new URLSearchParams(criteria);
      query.set('status', value);
      query.set('limit', '1');
      query.set('offset', '0');
      return { value, label: label(value), path: `${endpoint}?${query}` };
    });
}

export function QueueEmptyState({
  locale,
  message,
  status,
  alternatives = [],
  hasResults,
  select,
  all,
  disabled,
}: {
  locale: Locale;
  message: string;
  status?: string;
  alternatives?: readonly Alternative[];
  hasResults?: (body: unknown, value: string) => boolean;
  select?: (status: string) => void;
  all?: () => void;
  disabled?: boolean;
}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const scope = JSON.stringify([actor, revision, alternatives.map(({ path }) => path)]);
  const inputs = useRef({ alternatives, hasResults });
  inputs.current = { alternatives, hasResults };
  const [result, setResult] = useState<{ scope: string; statuses: string[] } | null>(null);
  useEffect(() => {
    const { alternatives: checks, hasResults: validate } = inputs.current;
    if (!checks.length || !validate) return;
    const controller = new AbortController();
    let current = true;
    let denied = false;
    void Promise.all(
      checks.map(async ({ value, path }) => {
        try {
          return await readWithDeadline(
            controller.signal,
            async (signal) => {
              const response = await fetch(path, { credentials: 'include', signal });
              if (response.status === 401 || response.status === 403) {
                denied = true;
                controller.abort();
                return null;
              }
              return response.ok && validate(await response.json(), value) ? value : null;
            },
            5000
          );
        } catch {
          return null;
        }
      })
    ).then((matches) => {
      if (current)
        setResult({
          scope,
          statuses: denied ? [] : matches.filter((value): value is string => value !== null),
        });
    });
    return () => {
      current = false;
      controller.abort();
    };
  }, [scope]);

  const available = result?.scope === scope ? result.statuses : [];
  const checking = Boolean(hasResults && alternatives.length && result?.scope !== scope);
  return (
    <div
      data-slot="queue-empty-state"
      className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3"
    >
      <ResultGlyph />
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-medium">
          {status ? t('listStatus.none', locale).replace('{status}', status) : message}
        </p>
        <div role="status" className="text-muted-foreground">
          {checking
            ? t('listStatus.checking', locale)
            : available.length > 0 && t('listStatus.alternatives', locale)}
        </div>
        {(available.length > 0 || all) && (
          <div className="flex flex-wrap gap-2">
            {alternatives
              .filter(({ value }) => available.includes(value) && !(value === 'all' && all))
              .map(({ value, label }) => (
                <Button
                  key={value}
                  type="button"
                  variant="secondary"
                  aria-label={t('listStatus.view', locale).replace('{status}', label)}
                  disabled={disabled}
                  onClick={() => select?.(value)}
                >
                  {label}
                </Button>
              ))}
            {all && (
              <Button type="button" variant="ghost" disabled={disabled} onClick={all}>
                {t('listStatus.all', locale)}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function HistoryStatusEmpty({
  locale,
  message,
  probe,
  showAll,
}: {
  locale: Locale;
  message: string;
  probe: { path: string; hasResults: (body: unknown) => boolean } | null;
  showAll?: (() => void) | undefined;
}) {
  return (
    <QueueEmptyState
      locale={locale}
      message={message}
      {...(probe && showAll
        ? {
            alternatives: [{ value: 'all', label: t('listStatus.all', locale), path: probe.path }],
            hasResults: probe.hasResults,
            all: showAll,
          }
        : {})}
    />
  );
}
