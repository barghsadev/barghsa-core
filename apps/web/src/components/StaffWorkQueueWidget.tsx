import { Link } from '@tanstack/react-router';
import { t } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

export interface QueueCounts {
  pendingTickets: number | null;
  electricityOrders: number | null;
  savingOrders: number | null;
  unassignedConsultations: number | null;
}

export function StaffWorkQueueWidget({
  counts,
  embedded = false,
}: {
  counts: QueueCounts;
  embedded?: boolean;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  if (
    counts.pendingTickets === null &&
    counts.electricityOrders === null &&
    counts.savingOrders === null &&
    counts.unassignedConsultations === null
  )
    return null;

  const cards = [
    {
      count: counts.electricityOrders,
      to: '/admin/electricity-orders',
      label: 'electricityOrders',
    },
    { count: counts.savingOrders, to: '/admin/saving-orders', label: 'savingOrders' },
  ] as const;

  return (
    <div className="space-y-3">
      {!embedded && (
        <h3 className="text-base font-semibold">{t('dashboard.admin.work.queueTitle', locale)}</h3>
      )}
      <div
        className={embedded ? 'grid grid-cols-2 gap-3' : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-4'}
      >
        {counts.pendingTickets !== null && (
          <Link
            to="/admin/tickets"
            search={{ status: 'active' }}
            className="rounded-xl border bg-card p-3 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span className="block text-2xl font-semibold">
              {numbers.number(counts.pendingTickets)}
            </span>
            <span className="text-sm text-muted-foreground">
              {t('dashboard.admin.work.pendingTickets', locale)}
            </span>
          </Link>
        )}
        {cards.map(({ count, to, label }) =>
          count === null ? null : (
            <Link
              key={label}
              to={to}
              className="rounded-xl border bg-card p-3 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="block text-2xl font-semibold">{numbers.number(count)}</span>
              <span className="text-sm text-muted-foreground">
                {t(`dashboard.admin.work.${label}`, locale)}
              </span>
            </Link>
          )
        )}
        {counts.unassignedConsultations !== null && (
          <Link
            to="/admin/consultations"
            search={{ assignment: 'unassigned' }}
            className="rounded-xl border bg-card p-3 text-card-foreground transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <span className="block text-2xl font-semibold">
              {numbers.number(counts.unassignedConsultations)}
            </span>
            <span className="text-sm text-muted-foreground">
              {t('dashboard.admin.work.unassignedConsultations', locale)}
            </span>
          </Link>
        )}
      </div>
    </div>
  );
}
