import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { tSolar } from '@barghsa/i18n/solar';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { solarNextAction } from '../lib/solar-next-action.js';

interface RequestRow {
  id: string;
  status: string;
  building_type: string;
  grid_type: string;
  submitted_at: string;
  contract_id: string | null;
  contract_published: boolean;
  initial_invoice_id: string | null;
  initial_invoice_state: string | null;
}

export function SolarRequestsPage() {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [before, setBefore] = useState<string | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void (async () => {
      try {
        const profileResponse = await fetch('/api/profiles', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!profileResponse.ok) throw new Error('profile');
        const profile = (await profileResponse.json()) as { activeProfileId: string | null };
        if (!profile.activeProfileId) {
          setRows([]);
          setNextBefore(null);
          return;
        }
        const params = new URLSearchParams({ profileId: profile.activeProfileId });
        if (before) params.set('before', before);
        const response = await fetch(`/api/solar/requests?${params}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('requests');
        const result = (await response.json()) as {
          requests: RequestRow[];
          nextBefore: string | null;
        };
        if (!controller.signal.aborted) {
          setRows((current) => {
            if (!before) return result.requests;
            const shown = new Set(current.map((request) => request.id));
            return [...current, ...result.requests.filter((request) => !shown.has(request.id))];
          });
          setNextBefore(result.nextBefore);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [before, revision]);
  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-semibold">{copy('myRequests')}</h1>
      <Link
        to="/solar/requests/new"
        className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        {copy('submit')}
      </Link>
      {loading && <p role="status">{copy('loading')}</p>}
      {error && <p role="alert">{copy('notFound')}</p>}
      {error && (
        <button
          type="button"
          className="text-primary underline"
          onClick={() => setRevision((n) => n + 1)}
        >
          {copy('retry')}
        </button>
      )}
      {!loading && !error && !rows.length && <p>{copy('none')}</p>}
      <ul className="space-y-3">
        {rows.map((row) => {
          const action = solarNextAction(row, locale);
          return (
            <li key={row.id}>
              <Link
                to="/solar/requests/$requestId"
                params={{ requestId: row.id }}
                className="block rounded-xl border p-4 hover:border-primary"
              >
                <span className="font-medium">
                  {copy(row.building_type === 'non_household' ? 'nonHousehold' : 'building')}
                </span>
                <span className="ms-3 text-muted-foreground">
                  {copy(row.grid_type === 'off_grid' ? 'offGrid' : 'onGrid')}
                </span>
                <span className="mt-2 block text-sm">
                  {copy('status')}: {copy(`status_${row.status}`)}
                </span>
                <span className="mt-2 block text-sm text-muted-foreground">
                  {t('workflow.nextAction', locale)}: {action.text}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {t('workflow.owner', locale)}: {t(`workflow.owner.${action.owner}`, locale)}
                </span>
                <time className="text-sm text-muted-foreground" dateTime={row.submitted_at}>
                  {new Intl.DateTimeFormat(locale).format(new Date(row.submitted_at))}
                </time>
              </Link>
            </li>
          );
        })}
      </ul>
      {nextBefore && !error && (
        <button
          type="button"
          className="rounded-md border px-4 py-2 text-sm disabled:opacity-50"
          disabled={loading}
          onClick={() => setBefore(nextBefore)}
        >
          {copy('moreRequests')}
        </button>
      )}
    </main>
  );
}
