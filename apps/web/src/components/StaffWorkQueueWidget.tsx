import { Link } from '@tanstack/react-router';
import { staffWorkText } from '@barghsa/i18n/staff-work-preview';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { DashboardMetricRow, dashboardMetricLink } from './dashboard/DashboardMetricRow.js';

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
        <h3 className="text-base font-semibold">{staffWorkText('queueTotals', locale)}</h3>
      )}
      <div className="grid divide-y">
        {counts.pendingTickets !== null && (
          <Link to="/admin/tickets" search={{ status: 'active' }} className={dashboardMetricLink}>
            <DashboardMetricRow
              count={numbers.number(counts.pendingTickets)}
              label={staffWorkText('pendingTickets', locale)}
            />
          </Link>
        )}
        {cards.map(({ count, to, label }) =>
          count === null ? null : (
            <Link key={label} to={to} className={dashboardMetricLink}>
              <DashboardMetricRow
                count={numbers.number(count)}
                label={staffWorkText(label, locale)}
              />
            </Link>
          )
        )}
        {counts.unassignedConsultations !== null && (
          <Link
            to="/admin/consultations"
            search={{ assignment: 'unassigned' }}
            className={dashboardMetricLink}
          >
            <DashboardMetricRow
              count={numbers.number(counts.unassignedConsultations)}
              label={staffWorkText('unassignedConsultations', locale)}
            />
          </Link>
        )}
      </div>
    </div>
  );
}
