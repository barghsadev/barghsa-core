import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

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

export function FailedJobsWidget({ counts }: { counts: FailedWorkCounts }) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const visible = failures.filter(({ key }) => counts[key] !== null);
  if (visible.length === 0) return null;

  return (
    <section className="space-y-3" aria-label={t('dashboard.admin.failures.title', locale)}>
      <h3 className="text-base font-semibold">{t('dashboard.admin.failures.title', locale)}</h3>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ key, href, label }) => {
          const count = counts[key]!;
          return (
            <a
              key={key}
              href={href}
              className={`rounded-xl border bg-card p-4 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${count > 0 ? 'border-destructive/40' : ''}`}
            >
              <span
                className={`block text-2xl font-semibold ${count > 0 ? 'text-destructive' : ''}`}
              >
                {numbers.number(count)}
              </span>
              <span className="text-sm text-muted-foreground">
                {t(`dashboard.admin.failures.${label}`, locale)}
              </span>
              {count > 0 && (
                <span className="mt-2 block text-xs font-medium text-destructive">
                  {t('dashboard.admin.failures.needsAttention', locale)}
                </span>
              )}
            </a>
          );
        })}
      </div>
    </section>
  );
}
