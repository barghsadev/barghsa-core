import { LoadingStatus } from '@barghsa/ui';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n';
import { termsHistoryText } from '@barghsa/i18n/terms-history';
import { formatInTimezone } from '@barghsa/i18n/date-time';
import { readPublicTosHistory, type PublicTosHistory } from '../lib/public-tos-history.js';
import { readWithDeadline } from '../lib/server-query-client.js';

/** Only published metadata is loaded; following a version never accepts it. */
export function PublishedTermsHistory({
  locale,
  currentId,
}: {
  locale: Locale;
  currentId?: string | undefined;
}) {
  const [history, setHistory] = useState<PublicTosHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setError(false);
    try {
      const query = history?.nextCursor ? '?before=' + encodeURIComponent(history.nextCursor) : '';
      const value: unknown = await readWithDeadline(controller.signal, async (signal) => {
        const response = await fetch('/api/tos/versions' + query, {
          credentials: 'omit',
          cache: 'no-store',
          signal,
        });
        if (!response.ok) throw new Error('History unavailable');
        return response.json();
      });
      const page = readPublicTosHistory(value);
      if (!page) throw new Error('Invalid history');
      if (controller.signal.aborted) return;
      setHistory((previous) => {
        const seen = new Set(previous?.versions.map((version) => version.id));
        return {
          versions: [
            ...(previous?.versions ?? []),
            ...page.versions.filter((version) => !seen.has(version.id)),
          ],
          nextCursor: page.nextCursor,
        };
      });
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (active.current === controller) active.current = null;
    }
  }
  return (
    <details
      className="mt-8 border-t pt-4"
      onToggle={(event) => {
        if (event.currentTarget.open && !history && !loading && !error) void load();
      }}
    >
      <summary className="cursor-pointer py-3 font-medium">
        {termsHistoryText('history', locale)}
      </summary>
      <ul className="space-y-3">
        {history?.versions.map((version) => (
          <li key={version.id} className="flex flex-wrap gap-3">
            <Link
              to="/terms"
              search={{ lang: locale, version: version.id }}
              aria-current={version.id === currentId ? 'page' : undefined}
              className="underline underline-offset-4"
            >
              {version.versionId}
            </Link>
            <time dateTime={version.publishedAt} className="text-sm text-muted-foreground">
              {formatInTimezone(version.publishedAt, 'Asia/Tehran', locale, { dateStyle: 'long' })}
            </time>
          </li>
        ))}
      </ul>
      {loading && <LoadingStatus>{t('tos.page.loading', locale)}</LoadingStatus>}
      {error && <p role="alert">{termsHistoryText('historyError', locale)}</p>}
      {history?.versions.length === 0 && <p>{termsHistoryText('historyEmpty', locale)}</p>}
      {(error || history?.nextCursor) && (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load()}
          className="mt-3 rounded border px-4 py-3 text-sm"
        >
          {error ? t('tos.page.retry', locale) : termsHistoryText('moreVersions', locale)}
        </button>
      )}
    </details>
  );
}
