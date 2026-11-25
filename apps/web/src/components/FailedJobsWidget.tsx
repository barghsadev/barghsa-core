import { staffWorkText } from '@barghsa/i18n/staff-work-preview';
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
    href: '/admin/contracts/refunds',
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
      aria-label={embedded ? undefined : staffWorkText('failures', locale)}
    >
      {!embedded && (
        <h3 className="text-base font-semibold">{staffWorkText('failures', locale)}</h3>
      )}
      <div className="grid divide-y">
        {visible.map(({ key, href, label }) => {
          const count = counts[key]!;
          return (
            <a key={key} href={href} className={dashboardMetricLink}>
              <DashboardMetricRow
                count={numbers.number(count)}
                label={staffWorkText(label, locale)}
                attention={count > 0 ? staffWorkText('needsAttention', locale) : undefined}
              />
            </a>
          );
        })}
      </div>
    </Frame>
  );
}
