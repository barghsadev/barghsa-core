import { useId } from 'react';
import { Button, Input, ListToolbar, ListSortDropdown, ListPage } from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { encodeFinanceCursor, type FinanceCursor } from '../lib/finance-list-query.js';
import { useLocale } from '../hooks/useLocale.js';

export function ReceiptQueueControls({ binding }: { binding: ListQueryBinding }) {
  const locale = useLocale();
  const id = useId();
  return (
    <ListToolbar
      search={
        <label className="flex min-w-0 flex-col gap-1 text-sm" htmlFor={id}>
          {t('historySearch.label', locale)}
          <Input
            id={id}
            type="search"
            value={binding.searchInput}
            onChange={(event) => binding.setSearchInput(event.target.value)}
            maxLength={120}
            placeholder={t('historySearch.receiptQueue', locale)}
          />
        </label>
      }
      sort={
        <ListSortDropdown
          value={`submitted_at:${binding.query.order}`}
          onChange={(value) => binding.setQuery({ order: value.endsWith('desc') ? 'desc' : 'asc' })}
          label={t('historySearch.sort', locale)}
          options={(['asc', 'desc'] as const).map((order) => ({
            value: `submitted_at:${order}`,
            label: t(order === 'asc' ? 'historySearch.oldest' : 'historySearch.newest', locale),
          }))}
        />
      }
      actions={
        binding.query.search || binding.query.order !== 'asc' ? (
          <Button variant="ghost" onClick={binding.clear}>
            {t('historyFilters.clearAll', locale)}
          </Button>
        ) : undefined
      }
    />
  );
}
export function ReceiptQueuePagination({
  binding,
  nextCursor,
  loading,
}: {
  binding: ListQueryBinding;
  nextCursor: FinanceCursor | null;
  loading: boolean;
}) {
  const locale = useLocale();
  const next = encodeFinanceCursor(nextCursor);
  return (
    <ListPage.Pagination
      kind="cursor"
      label={t('historyPagination.label', locale)}
      hasMore={binding.canAdvance(next)}
      loading={loading}
      onNext={() => binding.next(next)}
      nextLabel={t(
        `invoices.receipts.${binding.query.order === 'asc' ? 'newer' : 'older'}`,
        locale
      )}
      previous={{
        enabled: binding.hasPrevious,
        label: t('historyPagination.previous', locale),
        onClick: binding.previous,
      }}
    />
  );
}
