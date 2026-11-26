import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { SERVICE_DUE_PERIOD_TYPES } from '@barghsa/shared/finance/browser';
import type { ServiceDuePeriodType } from '@barghsa/shared/finance';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { useLocale } from '../hooks/useLocale.js';

export interface InvoiceTimingPanelProps {
  onLocked?: ((locked: boolean) => void) | undefined;
  service?: ServiceDuePeriodType | undefined;
  search?: Record<string, unknown> | undefined;
}

export function InvoiceTimingServiceList({
  section,
  search,
  disabled,
  summary,
}: {
  section: 'due-periods' | 'reminders';
  search: Record<string, unknown> | undefined;
  disabled: boolean;
  summary: (service: ServiceDuePeriodType) => string;
}) {
  const locale = useLocale();
  return (
    <ul className="divide-y">
      {SERVICE_DUE_PERIOD_TYPES.map((service) => (
        <li key={service}>
          <Link
            to="/admin/invoices/tools/{-$section}/{-$service}"
            params={{ section, service }}
            search={search}
            disabled={disabled}
            className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:opacity-65 sm:px-6"
          >
            <span className="font-semibold">
              {t(`admin.invoices.reminders.service.${service}`, locale)}
            </span>
            <span className="rounded-md bg-muted/70 px-2 py-1 text-end font-medium tabular-nums">
              {summary(service)}
            </span>
            <ChevronRight
              className="size-4 shrink-0 text-primary rtl:rotate-180"
              aria-hidden="true"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
