import { useId, useRef, useState } from 'react';
import {
  Field,
  FieldError,
  FieldLabel,
  Input,
  ListSortDropdown,
  ListToolbar,
  NativeSelect,
  NativeSelectOption,
  NumberFilter,
  TextFilter,
  useFilterApply,
} from '@barghsa/ui';
import { t } from '@barghsa/i18n/workspace';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import {
  HISTORY_SORT_OPTIONS,
  parseNumberRange,
  type HistoryQuery,
} from '@barghsa/shared/validation';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { useHistoryFilterDraft } from '../hooks/useHistoryFilterDraft.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import { HistoryFilterPanel } from './HistoryFilterPanel.js';
import { HistoryDateFilter } from './HistoryDateFilter.js';

function InvoiceIdFilter({
  value,
  onChange,
  label,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  error: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const trimmed = value.trim();
  const invalid = trimmed !== '' && !isInvoiceUuid(trimmed);
  const showError = submitted && invalid;
  useFilterApply(() => {
    if (!invalid) return () => {};
    setSubmitted(true);
    input.current?.focus();
    return null;
  });

  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        ref={input}
        id={id}
        value={value}
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        aria-invalid={showError || undefined}
        aria-describedby={showError ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {showError && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </Field>
  );
}

export function InvoiceReceiptHistoryFilters({ binding }: { binding: ListQueryBinding }) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const statusId = useId();
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const statuses = ['Confirmed', 'Rejected'].map((value) => ({
    value,
    label: t(`invoices.activity.state.${value}`, locale),
  }));
  const { filters, search, order } = binding.query;
  const applied = {
    query: {
      q: search,
      sort: `submitted_at:${order}` as HistoryQuery['sort'],
      invoiceId: filters.invoiceId ?? '',
    },
    statuses: filters.state ? [filters.state] : [],
    dateRange: { from: filters.from || undefined, to: filters.to || undefined },
    amountRange: { min: filters.min || undefined, max: filters.max || undefined },
  };
  const draft = useHistoryFilterDraft(applied, (selection) =>
    binding.setQuery({
      search: selection.query.q,
      order: selection.query.sort.endsWith('asc') ? 'asc' : 'desc',
      filters: {
        state: selection.statuses[0] ?? '',
        invoiceId: selection.query.invoiceId.trim(),
        from: selection.dateRange.from ?? '',
        to: selection.dateRange.to ?? '',
        min: selection.amountRange?.min ?? '',
        max: selection.amountRange?.max ?? '',
      },
    })
  );
  return (
    <HistoryFilterPanel
      {...applied}
      onClear={() =>
        binding.setQuery({
          search: '',
          filters: Object.fromEntries(Object.keys(filters).map((key) => [key, ''])),
        })
      }
      onOpen={draft.begin}
      onApply={draft.apply}
      onRemoveFilter={(key) =>
        binding.setQuery(
          key === 'search'
            ? { search: '' }
            : {
                filters:
                  key === 'status'
                    ? { state: '' }
                    : key === 'date'
                      ? { from: '', to: '' }
                      : { min: '', max: '' },
              }
        )
      }
      statusOptions={statuses}
      dateLabel={word('submitted')}
      formatDate={time.format}
      extraChips={
        filters.invoiceId
          ? [
              {
                id: 'invoice',
                label: `${word('invoice')}: ${filters.invoiceId}`,
                displayLabel: `${word('invoice')} · …${filters.invoiceId.slice(-8)}`,
                onRemove: () => binding.setQuery({ filters: { invoiceId: '' } }),
              },
            ]
          : []
      }
    >
      <ListToolbar
        search={
          <TextFilter
            value={draft.draft.query.q}
            onChange={(q) => draft.setQuery({ ...draft.draft.query, q })}
            label={t('historySearch.label', locale)}
            placeholder={t('historySearch.receiptQueue', locale)}
          />
        }
        sort={
          <ListSortDropdown
            value={draft.draft.query.sort}
            onChange={(sort) =>
              draft.setQuery({ ...draft.draft.query, sort: sort as HistoryQuery['sort'] })
            }
            label={t('historySearch.sort', locale)}
            options={HISTORY_SORT_OPTIONS.map((value) => ({
              value,
              label: t(
                value.endsWith('asc') ? 'historySearch.oldest' : 'historySearch.newest',
                locale
              ),
            }))}
          />
        }
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Field className="min-w-0">
          <FieldLabel htmlFor={statusId}>{word('historyState')}</FieldLabel>
          <NativeSelect
            id={statusId}
            value={draft.draft.statuses[0] ?? ''}
            onChange={(event) => draft.setStatuses(event.target.value ? [event.target.value] : [])}
          >
            <NativeSelectOption value="">{word('historyAll')}</NativeSelectOption>
            {statuses.map(({ value, label }) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <InvoiceIdFilter
          value={draft.draft.query.invoiceId}
          onChange={(invoiceId) => draft.setQuery({ ...draft.draft.query, invoiceId })}
          label={word('invoice')}
          error={word('historyInvalidInvoice')}
        />
      </div>
      <HistoryDateFilter
        value={draft.draft.dateRange}
        onChange={draft.setDateRange}
        locale={locale}
        time={time}
        label={word('submitted')}
      />
      <NumberFilter
        value={draft.draft.amountRange ?? {}}
        onChange={draft.setAmountRange}
        parseRange={parseNumberRange}
        labels={{
          label: t('invoices.filter.amount', locale),
          min: t('invoices.filter.min', locale),
          max: t('invoices.filter.max', locale),
          apply: t('invoices.filter.applyAmount', locale),
          clear: t('invoices.filter.clearAmount', locale),
          invalid: t('invoices.filter.invalidAmount', locale),
        }}
      />
    </HistoryFilterPanel>
  );
}
