import { createFileRoute } from '@tanstack/react-router';
import {
  BANK_RECEIPT_STATUSES,
  parseStatusFilter,
  DEFAULT_HISTORY_SORT,
} from '@barghsa/shared/validation';
import { BankReceiptsPage } from '../../../pages/BankReceiptsPage.js';
import { receiptHistorySearch } from '../../../lib/receipt-history-search.js';
import { removeHistoryFilter } from '../../../lib/history-filter-state.js';

export const Route = createFileRoute('/_app/invoices/receipts')({
  validateSearch: receiptHistorySearch,
  component: ReceiptsRoute,
});

function ReceiptsRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <BankReceiptsPage
      recordSearch={search}
      query={{ q: search.q ?? '', sort: search.sort ?? DEFAULT_HISTORY_SORT }}
      dateRange={{ from: search.from, to: search.to }}
      amountRange={{ min: search.min, max: search.max }}
      onApplyFilters={(selection) =>
        void navigate({
          search: {
            q: selection.query.q.trim() || undefined,
            sort: selection.query.sort === DEFAULT_HISTORY_SORT ? undefined : selection.query.sort,
            statuses: selection.statuses.join(',') || undefined,
            from: selection.dateRange.from,
            to: selection.dateRange.to,
            min: selection.amountRange?.min,
            max: selection.amountRange?.max,
          },
        })
      }
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
      onRemoveFilter={(key, value) =>
        void navigate({ search: (current) => removeHistoryFilter(current, key, value) })
      }
      statuses={parseStatusFilter(search.statuses, BANK_RECEIPT_STATUSES) ?? []}
      onStatusesChange={(statuses) =>
        void navigate({
          search: (current) => ({ ...current, statuses: statuses.join(',') || undefined }),
        })
      }
    />
  );
}
