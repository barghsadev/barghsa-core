import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';
import { FileCheck2, Package, LifeBuoy, ReceiptText, ArrowUpRight } from 'lucide-react';
import { cn } from '@barghsa/ui';

export interface QuickStatusCardsProps {
  /** Active contracts (confirmed electricity orders). */
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
      icon: FileCheck2,
      label: 'dashboard.overview.contractStatus',
      href: '/electricity',
      search: { status: 'CONFIRMED' },
      count: activeContracts,
    },
    {
      key: 'orders',
      icon: Package,
      label: 'dashboard.overview.activeOrders',
      href: '/electricity',
      search: { status: 'PENDING' },
      count: pendingOrders,
    },
    {
      key: 'tickets',
      icon: LifeBuoy,
      label: 'dashboard.overview.openTickets',
      href: '/tickets',
      count: openTickets,
    },
    {
      key: 'invoices',
      icon: ReceiptText,
      label: 'dashboard.overview.pendingInvoices',
      href: '/invoices',
      count: unpaidInvoices,
    },
  ];
  return (
    <div
      className="grid h-full grid-cols-1 gap-4 sm:grid-cols-2"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {cards.map(({ key, icon: Icon, label, href, search, count }) => (
        <Link
          key={key}
          to={href}
          search={search}
          className="group flex flex-col gap-5 rounded-xl border bg-card p-5 text-card-foreground shadow-sm transition-shadow hover:border-input hover:shadow-md"
        >
          <div className="flex items-center justify-between gap-3">
            <Icon
              className={cn(
                'size-5',
                key === 'contracts' && count > 0
                  ? 'text-success'
                  : key !== 'contracts' && count > 2
                    ? 'text-destructive'
                    : key !== 'contracts' && count > 0
                      ? 'text-warning'
                      : 'text-muted-foreground'
              )}
              strokeWidth={1.7}
              aria-hidden="true"
            />
            <ArrowUpRight
              className="size-4 text-muted-foreground rtl:-rotate-90"
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm text-muted-foreground">{t(label, locale)}</p>
            <p className="text-3xl font-semibold tabular-nums">{numbers.number(count)}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
