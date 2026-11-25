import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { tSaving } from '@barghsa/i18n/saving';
import { FileCheck2Icon, MessagesSquareIcon, PackageIcon, ReceiptTextIcon } from 'lucide-react';

export interface QuickStatusCardsProps {
  /** Contracts in the Active lifecycle state. */
  activeContracts: number;
  /** Pending orders awaiting processing. */
  pendingOrders: number;
  /** Open support tickets. */
  openTickets: number;
  /** Unpaid / overdue invoices. */
  unpaidInvoices: number;
  /** UI locale. */
  locale?: Locale;
}

export function QuickStatusCards({
  activeContracts,
  pendingOrders,
  openTickets,
  unpaidInvoices,
  locale = 'fa',
}: QuickStatusCardsProps) {
  const numbers = useNumberFormatting(locale);
  const cards = [
    {
      key: 'contracts',
      label: 'dashboard.overview.contractStatus',
      href: '/contracts',
      search: { state: 'Active' },
      count: activeContracts,
      icon: FileCheck2Icon,
    },
    {
      key: 'orders',
      label: 'dashboard.overview.activeOrders',
      count: pendingOrders,
      icon: PackageIcon,
    },
    {
      key: 'tickets',
      label: 'dashboard.overview.openTickets',
      href: '/tickets',
      search: { status: 'active', scope: 'active' },
      count: openTickets,
      icon: MessagesSquareIcon,
    },
    {
      key: 'invoices',
      label: 'dashboard.overview.pendingInvoices',
      href: '/invoices',
      search: { status: 'unpaid' },
      count: unpaidInvoices,
      icon: ReceiptTextIcon,
    },
  ];
  const row = 'flex min-h-12 min-w-0 items-center gap-2 rounded-lg px-2 text-sm';
  return (
    <div className="space-y-2" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <ul className="grid grid-cols-2 gap-x-2">
        {cards.map(({ key, label, href, search, count, icon: Icon }) => {
          const value = (
            <>
              <Icon aria-hidden="true" className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">
                {t(label, locale)}
              </span>
              <strong className="ms-auto shrink-0 font-semibold tabular-nums">
                {numbers.number(count)}
              </strong>
            </>
          );
          return (
            <li key={key} className="min-w-0">
              {href ? (
                <Link to={href} search={search} className={row + ' hover:bg-muted'}>
                  {value}
                </Link>
              ) : (
                <span className={row}>{value}</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="grid grid-cols-2 gap-x-2 border-t text-sm leading-snug font-medium">
        <Link
          to="/electricity/orders"
          search={{ status: 'pending' }}
          className="inline-flex min-h-11 min-w-0 items-center break-words text-primary underline underline-offset-4"
        >
          {t('electricity.orders.title', locale)}
        </Link>
        <Link
          to="/savings/orders"
          search={{ status: 'pending' }}
          className="inline-flex min-h-11 min-w-0 items-center break-words text-primary underline underline-offset-4"
        >
          {tSaving('orders', locale)}
        </Link>
      </div>
    </div>
  );
}
