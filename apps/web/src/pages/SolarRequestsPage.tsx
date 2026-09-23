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
}

export function SolarRequestsPage() {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const profileResponse = await fetch('/api/profiles', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (!profileResponse.ok) throw new Error('profile');
        const profile = (await profileResponse.json()) as { activeProfileId: string | null };
        if (!profile.activeProfileId) return;
        const response = await fetch(
          `/api/solar/requests?profileId=${encodeURIComponent(profile.activeProfileId)}`,
          {
            credentials: 'include',
            signal: controller.signal,
          }
        );
        if (!response.ok) throw new Error('requests');
        const result = (await response.json()) as { requests: RequestRow[] };
        if (!controller.signal.aborted) setRows(result.requests);
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, []);
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
    </main>
  );
}
