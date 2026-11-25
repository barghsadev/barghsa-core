import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { Button, LoadingStatus, cn } from '@barghsa/ui';
import { notificationFormText } from '@barghsa/i18n/notification-forms';
import { tWorkspace as t, type Locale } from '@barghsa/i18n/workspace-admin';
import { useAccountTime } from '../hooks/useAccountTime.js';
import {
  customerCorrectionsApi,
  customerCorrectionsRoute,
  isCustomerCorrection,
  readCustomerCorrectionAccess,
  type CustomerCorrection,
  type CustomerCorrectionAccess,
  type CustomerCorrectionSearch,
} from '../lib/customer-corrections.js';
import { readWithDeadline } from '../lib/server-query-client.js';

export function CustomerCorrectionsSection({ locale }: { locale: Locale }) {
  return (
    <Link
      to={customerCorrectionsRoute}
      params={{ correctionId: undefined, action: undefined }}
      className="touch-action inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-semibold text-primary underline-offset-4 hover:underline"
    >
      {t('admin.notifications.corrections.title', locale)}
      <ArrowUpRight aria-hidden="true" className="size-4 rtl:-scale-x-100" />
    </Link>
  );
}

export default function CustomerCorrectionsPanel({
  locale,
  search,
  onSearchChange,
}: {
  locale: Locale;
  search: CustomerCorrectionSearch;
  onSearchChange: (search: CustomerCorrectionSearch) => void;
}) {
  const label = (key: string) => t(`admin.notifications.corrections.${key}`, locale);
  const time = useAccountTime(locale);
  const completed = search.completed === true;
  const offset = search.offset ?? 0;
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<{
    access: CustomerCorrectionAccess;
    rows: CustomerCorrection[];
    more: boolean;
  } | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const controller = new AbortController();
    setPhase('loading');
    setLoad(null);
    void readWithDeadline(controller.signal, async (signal) => {
      const access = await readCustomerCorrectionAccess(signal);
      if (!access.canView) return { access, rows: [], more: false };
      const response = await fetch(
        `${customerCorrectionsApi}?completed=${completed}&offset=${offset}`,
        { signal }
      );
      if (response.status === 401 || response.status === 403)
        return { access: { canView: false, canRetry: false }, rows: [], more: false };
      const rows: unknown = await response.json();
      if (
        !response.ok ||
        !Array.isArray(rows) ||
        rows.length > 26 ||
        !rows.every(isCustomerCorrection) ||
        new Set(rows.map((row) => row.id)).size !== rows.length ||
        rows.some((row) => Boolean(row.resolvedAt) !== completed)
      )
        throw new Error('Invalid correction list');
      return { access, rows: rows.slice(0, 25), more: rows.length > 25 };
    }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setLoad(result);
        setPhase('ready');
      },
      () => {
        if (!controller.signal.aborted) setPhase('error');
      }
    );
    return () => controller.abort();
  }, [completed, offset, revision]);

  return (
    <section
      className="min-w-0 space-y-4"
      aria-label={label('title')}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {time.notice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1">
          {[
            {
              selected: !completed,
              search: {},
              name: notificationFormText('correctionOpen', locale),
            },
            { selected: completed, search: { completed: true }, name: label('completed') },
          ].map((item) => (
            <Link
              key={item.name}
              to={customerCorrectionsRoute}
              params={{ correctionId: undefined, action: undefined }}
              search={item.search}
              aria-current={item.selected ? 'page' : undefined}
              className={cn(
                'touch-action inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium',
                item.selected
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {item.name}
            </Link>
          ))}
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label('refresh')}
          title={label('refresh')}
          disabled={phase === 'loading'}
          onClick={() => setRevision((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      {phase === 'loading' ? (
        <LoadingStatus>{label('loading')}</LoadingStatus>
      ) : phase === 'error' ? (
        <p role="alert">{label('error')}</p>
      ) : !load?.access.canView ? (
        <p role="alert">{label('denied')}</p>
      ) : !load.rows.length ? (
        <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
          {label('empty')}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {load.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1 break-words space-y-1">
                <Link
                  to={customerCorrectionsRoute}
                  params={{ correctionId: row.id, action: undefined }}
                  search={search}
                  className="wrap-anywhere text-sm font-semibold text-primary underline-offset-4 hover:underline"
                >
                  <bdi dir="ltr">{row.address}</bdi>
                </Link>
                <div>
                  <time dateTime={row.createdAt} className="text-xs text-muted-foreground">
                    {time.format(row.createdAt)}
                  </time>
                </div>
              </div>
              {row.resolvedAt ? (
                <p className="w-full whitespace-pre-wrap wrap-anywhere border-t pt-2 text-sm">
                  {row.resolutionNote}
                </p>
              ) : load.access.canRetry ? (
                <Link
                  to={customerCorrectionsRoute}
                  params={{ correctionId: row.id, action: 'resolve' }}
                  search={search}
                  className="touch-action inline-flex min-h-11 items-center gap-2 rounded-lg bg-muted px-3 text-sm font-medium text-primary hover:bg-accent"
                >
                  {label('resolve')}
                  <ArrowUpRight className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {load?.access.canView && (offset > 0 || load.more) && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={offset === 0}
            onClick={() => onSearchChange({ ...search, offset: Math.max(0, offset - 25) })}
          >
            {label('previous')}
          </Button>
          <Button
            variant="outline"
            disabled={!load.more || offset >= 999975}
            onClick={() => onSearchChange({ ...search, offset: offset + 25 })}
          >
            {label('next')}
          </Button>
        </div>
      )}
    </section>
  );
}
