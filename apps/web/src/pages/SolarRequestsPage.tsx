import { useEffect, useState } from 'react';
import { tSolar } from '@barghsa/i18n/solar';
import { useLocale } from '../hooks/useLocale.js';

interface RequestRow {
  id: string;
  status: string;
  building_type: string;
  grid_type: string;
  submitted_at: string;
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
      <a
        href="/solar/requests/new"
        className="inline-block rounded-md bg-primary px-4 py-2 text-primary-foreground"
      >
        {copy('submit')}
      </a>
      {loading && <p role="status">{copy('loading')}</p>}
      {error && <p role="alert">{copy('notFound')}</p>}
      {!loading && !error && !rows.length && <p>{copy('none')}</p>}
      <ul className="space-y-3">
        {rows.map((row) => (
          <li key={row.id}>
            <a
              href={`/solar/requests/${row.id}`}
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
              <time className="text-sm text-muted-foreground" dateTime={row.submitted_at}>
                {new Intl.DateTimeFormat(locale).format(new Date(row.submitted_at))}
              </time>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
