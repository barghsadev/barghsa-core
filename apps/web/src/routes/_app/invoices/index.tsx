import { createFileRoute, lazyRouteComponent } from '@tanstack/react-router';
import {
  CUSTOMER_INVOICE_STATUSES,
  DEFAULT_INVOICE_LIST_SORT,
  parseStatusFilter,
  parseDateRangeFilter,
  parseInvoiceListQuery,
  parseNumberRange,
} from '@barghsa/shared/validation';
import { RouteSkeleton } from '../../../components/RouteSkeleton.js';
import { RouteErrorBoundary } from '../../../components/RouteErrorBoundary.js';

const InvoicesPage = lazyRouteComponent(
  () => import('../../../pages/InvoicesPage.js'),
  'InvoicesPage'
);

function InvoiceListRoute() {
  const { status, statuses, from, to, q, sort, min, max } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <InvoicesPage
      onClearFilters={() =>
        void navigate({
          search: (current) => ({
            ...current,
            q: undefined,
            statuses: undefined,
            from: undefined,
            to: undefined,
            min: undefined,
            max: undefined,
          }),
        })
      }
      unpaidOnly={status === 'unpaid'}
      statuses={statuses?.split(',') ?? []}
      onStatusesChange={(selected) =>
        void navigate({
          search: (current) => ({ ...current, statuses: selected.join(',') || undefined }),
        })
      }
      dateRange={{ from, to }}
      onDateRangeChange={(range) =>
        void navigate({ search: (current) => ({ ...current, from: range.from, to: range.to }) })
      }
      query={{ q: q ?? '', sort: sort ?? DEFAULT_INVOICE_LIST_SORT }}
      onQueryChange={(query) =>
        void navigate({
          search: (current) => ({
            ...current,
            q: query.q || undefined,
            sort: query.sort === DEFAULT_INVOICE_LIST_SORT ? undefined : query.sort,
          }),
        })
      }
      amountRange={{ min, max }}
      onAmountRangeChange={(range) =>
        void navigate({ search: (current) => ({ ...current, min: range.min, max: range.max }) })
      }
    />
  );
}

export const Route = createFileRoute('/_app/invoices/')({
  validateSearch: (search: Record<string, unknown>) => {
    const query = parseInvoiceListQuery(search.q, search.sort) ?? {
      q: '',
      sort: DEFAULT_INVOICE_LIST_SORT,
    };
    return {
      status: search.status === 'unpaid' ? ('unpaid' as const) : undefined,
      statuses:
        parseStatusFilter(search.statuses, CUSTOMER_INVOICE_STATUSES)?.join(',') || undefined,
      ...(parseDateRangeFilter(search.from, search.to) ?? { from: undefined, to: undefined }),
      ...(parseNumberRange(search.min, search.max) ?? { min: undefined, max: undefined }),
      q: query.q || undefined,
      sort: query.sort === DEFAULT_INVOICE_LIST_SORT ? undefined : query.sort,
    };
  },
  component: InvoiceListRoute,
  pendingComponent: () => <RouteSkeleton />,
  errorComponent: RouteErrorBoundary,
});
