import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { DashboardMetricRow, dashboardMetricLink } from './dashboard/DashboardMetricRow.js';

export interface FailedWorkCounts {
  failedJobs: number | null;
  deadLetterNotifications: number | null;
  failedRefundObligations: number | null;
}

const failures = [
  { key: 'failedJobs', href: '/admin/failed-jobs', label: 'failedJobs' },
  {
    key: 'deadLetterNotifications',
    href: '/admin/failed-notifications',
    label: 'deadLetterNotifications',
  },
  {
    key: 'failedRefundObligations',
    href: '/admin/contracts#refund-obligations',
    label: 'failedRefundObligations',
  },
] as const;

export function FailedJobsWidget({
  counts,
  embedded = false,
}: {
  counts: FailedWorkCounts;
  embedded?: boolean;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const Frame = embedded ? 'div' : 'section';
  const visible = failures.filter(({ key }) => counts[key] !== null);
  if (visible.length === 0) return null;

  return (
    <Frame
      className="space-y-3"
      aria-label={embedded ? undefined : t('dashboard.admin.failures.title', locale)}
    >
      {!embedded && (
        <h3 className="text-base font-semibold">{t('dashboard.admin.failures.title', locale)}</h3>
      )}
      <div className="grid divide-y">
        {visible.map(({ key, href, label }) => {
          const count = counts[key]!;
          return (
            <a key={key} href={href} className={dashboardMetricLink}>
              <DashboardMetricRow
                count={numbers.number(count)}
                label={t(`dashboard.admin.failures.${label}`, locale)}
                attention={
                  count > 0 ? t('dashboard.admin.failures.needsAttention', locale) : undefined
                }
              />
            </a>
          );
        })}
      </div>
    </Frame>
  );
}
