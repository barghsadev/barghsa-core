import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { FailedJobsWidget } from './FailedJobsWidget.js';
import { StaffWorkQueueWidget } from './StaffWorkQueueWidget.js';

interface Counts {
  consultations: number | null;
  unassignedConsultations: number | null;
  electricityOrders: number | null;
  savingOrders: number | null;
  pendingTickets: number | null;
  solarRequests: number | null;
  documentReviews: number | null;
  refundObligations: number | null;
  failedRefundObligations: number | null;
  failedJobs: number | null;
  deadLetterNotifications: number | null;
}

function validCount(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function parseCounts(value: unknown): Counts {
  if (!value || typeof value !== 'object') throw new Error('Invalid work counts');
  const counts = value as Record<string, unknown>;
  if (
    !validCount(counts.consultations) ||
    !validCount(counts.unassignedConsultations) ||
    !validCount(counts.electricityOrders) ||
    !validCount(counts.savingOrders) ||
    !validCount(counts.pendingTickets) ||
    !validCount(counts.solarRequests) ||
    !validCount(counts.documentReviews) ||
    !validCount(counts.refundObligations) ||
    !validCount(counts.failedRefundObligations) ||
    !validCount(counts.failedJobs) ||
    !validCount(counts.deadLetterNotifications) ||
    (counts.failedJobs === null) !== (counts.deadLetterNotifications === null) ||
    (counts.refundObligations === null) !== (counts.failedRefundObligations === null) ||
    (counts.electricityOrders === null) !== (counts.savingOrders === null) ||
    (counts.consultations === null) !== (counts.unassignedConsultations === null) ||
    (counts.consultations !== null &&
      counts.unassignedConsultations !== null &&
      counts.unassignedConsultations > counts.consultations) ||
    (counts.refundObligations !== null &&
      counts.failedRefundObligations !== null &&
      counts.failedRefundObligations > counts.refundObligations)
  )
    throw new Error('Invalid work counts');
  return counts as unknown as Counts;
}

const cards = [
  { key: 'consultations', route: '/admin/consultations', label: 'consultations' },
  { key: 'solarRequests', route: '/admin/solar-requests', label: 'solarRequests' },
  { key: 'documentReviews', route: '/admin/documents', label: 'documentReviews' },
] as const;

export function AdminBusinessWorkCounts() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'hidden'>('loading');
  useEffect(() => {
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch('/api/admin/dashboard/business-work-counts', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) {
          if (!cancelled) setState('hidden');
          return;
        }
        if (!response.ok) throw new Error('Work counts unavailable');
        const next = parseCounts(await response.json());
        if (!cancelled) {
          setCounts(next);
          setState('ready');
        }
      } catch {
        if (!cancelled) setState('error');
      } finally {
        pending = false;
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  if (state === 'hidden') return null;
  return (
    <section className="mb-6 space-y-3" aria-label={t('dashboard.admin.work.title', locale)}>
      <h2 className="text-lg font-semibold">{t('dashboard.admin.work.title', locale)}</h2>
      {state === 'loading' && <p role="status">{t('dashboard.admin.work.loading', locale)}</p>}
      {state === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {t('dashboard.admin.work.error', locale)}
        </p>
      )}
      {state === 'ready' && counts && <StaffWorkQueueWidget counts={counts} />}
      {state === 'ready' && counts && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {cards.map(({ key, route, label }) =>
            counts[key] === null ? null : (
              <Link
                key={key}
                to={route}
                className="rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="block text-2xl font-semibold">{numbers.number(counts[key])}</span>
                <span className="text-sm text-muted-foreground">
                  {t(`dashboard.admin.work.${label}`, locale)}
                </span>
              </Link>
            )
          )}
          {counts.refundObligations !== null && (
            <a
              href="/admin/contracts#refund-obligations"
              className="rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-2xl font-semibold">
                {numbers.number(counts.refundObligations)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t('dashboard.admin.work.refundObligations', locale)}
              </span>
            </a>
          )}
        </div>
      )}
      {state === 'ready' && counts && <FailedJobsWidget counts={counts} />}
    </section>
  );
}
