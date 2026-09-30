import { Link } from '@tanstack/react-router';
import { BriefcaseBusiness, ListTodo, TriangleAlert } from 'lucide-react';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { staffDashboardReader, useStaffDashboardData } from '../hooks/useStaffDashboardData.js';
import { DashboardWidget } from './dashboard/DashboardWidget.js';
import { FailedJobsWidget, type FailedWorkCounts } from './FailedJobsWidget.js';
import { StaffWorkQueueWidget, type QueueCounts } from './StaffWorkQueueWidget.js';

interface WorkCounts {
  consultations: number | null;
  solarRequests: number | null;
  documentReviews: number | null;
  refundObligations: number | null;
}
function parseCounts<T>(value: unknown, keys: readonly string[]): T {
  if (!value || typeof value !== 'object') throw new Error('Invalid work counts');
  const counts = value as Record<string, unknown>;
  if (
    !keys.every(
      (key) =>
        counts[key] === null ||
        (typeof counts[key] === 'number' && Number.isSafeInteger(counts[key]) && counts[key] >= 0)
    )
  )
    throw new Error('Invalid work counts');
  return Object.fromEntries(keys.map((key) => [key, counts[key]])) as T;
}
const readQueue = staffDashboardReader((value) => {
  const counts = parseCounts<QueueCounts>(value, [
    'pendingTickets',
    'electricityOrders',
    'savingOrders',
    'unassignedConsultations',
  ]);
  if ((counts.electricityOrders === null) !== (counts.savingOrders === null))
    throw new Error('Invalid order permissions');
  return Object.values(counts).every((count) => count === null) ? null : counts;
});
const readWork = staffDashboardReader((value) => {
  const counts = parseCounts<WorkCounts>(value, [
    'consultations',
    'solarRequests',
    'documentReviews',
    'refundObligations',
  ]);
  return Object.values(counts).every((count) => count === null) ? null : counts;
});
const readFailures = staffDashboardReader((value) => {
  const counts = parseCounts<FailedWorkCounts>(value, [
    'failedJobs',
    'deadLetterNotifications',
    'failedRefundObligations',
  ]);
  if ((counts.failedJobs === null) !== (counts.deadLetterNotifications === null))
    throw new Error('Invalid job permissions');
  return Object.values(counts).every((count) => count === null) ? null : counts;
});
const cards = [
  { key: 'consultations', route: '/admin/consultations', label: 'consultations' },
  { key: 'solarRequests', route: '/admin/solar-requests', label: 'solarRequests' },
  { key: 'documentReviews', route: '/admin/documents', label: 'documentReviews' },
] as const;

function WorkQueue() {
  const locale = useLocale();
  const resource = useStaffDashboardData('/api/admin/dashboard/widgets/queue', readQueue);
  if (!resource) return null;
  return (
    <DashboardWidget
      title={t('dashboard.admin.work.queueTitle', locale)}
      icon={ListTodo}
      resource={resource}
      locale={locale}
    >
      {(counts) => <StaffWorkQueueWidget counts={counts} embedded />}
    </DashboardWidget>
  );
}
function OpenWork() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const resource = useStaffDashboardData('/api/admin/dashboard/widgets/work', readWork);
  if (!resource) return null;
  return (
    <DashboardWidget
      title={t('dashboard.admin.work.title', locale)}
      icon={BriefcaseBusiness}
      resource={resource}
      locale={locale}
    >
      {(counts) => (
        <div className="grid grid-cols-2 gap-3">
          {cards.map(({ key, route, label }) =>
            counts[key] === null ? null : (
              <Link
                key={key}
                to={route}
                className="rounded-xl border bg-card p-3 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
              className="rounded-xl border bg-card p-3 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
    </DashboardWidget>
  );
}
function Failures() {
  const locale = useLocale();
  const resource = useStaffDashboardData('/api/admin/dashboard/widgets/failures', readFailures);
  if (!resource) return null;
  return (
    <DashboardWidget
      title={t('dashboard.admin.failures.title', locale)}
      icon={TriangleAlert}
      resource={resource}
      locale={locale}
    >
      {(counts) => <FailedJobsWidget counts={counts} embedded />}
    </DashboardWidget>
  );
}

/** Sibling widgets own separate reads, retries and permission decisions. */
export function AdminBusinessWorkCounts() {
  return (
    <>
      <WorkQueue />
      <OpenWork />
      <Failures />
    </>
  );
}
