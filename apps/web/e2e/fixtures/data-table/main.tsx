import '@barghsa/ui/styles.css';
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { DataTable } from '../../../../../packages/ui/src/components/base-ui/data-table';
import {
  ActionCell,
  AvatarCell,
  CurrencyCell,
  DateCell,
  LinkCell,
  NumberCell,
  StatusCell,
  TextCell,
} from '../../../../../packages/ui/src/components/base-ui/data-table-cells';

const rows = [
  { id: 'b', name: 'Beta', fixed: 'Kept B' },
  { id: 'a', name: 'Alpha', fixed: 'Kept A' },
];
function Fixture() {
  const params = new URLSearchParams(location.search);
  const [locale, setLocale] = React.useState<'en' | 'fa'>(
    params.get('locale') === 'fa' ? 'fa' : 'en'
  );
  const [sortable, setSortable] = React.useState(!params.has('no-sort'));
  const [mode, setMode] = React.useState(params.get('state') ?? 'rows');
  const [selected, setSelected] = React.useState<Set<string | number>>(new Set());
  const [sortEvents, setSortEvents] = React.useState(0);
  const [selectionEvents, setSelectionEvents] = React.useState(0);
  const [actionEvents, setActionEvents] = React.useState(0);
  const advanced = params.has('advanced');
  const labels =
    locale === 'fa'
      ? {
          amount: 'مبلغ',
          count: 'تعداد',
          date: 'تاریخ',
          actions: 'اقدامات',
          view: 'نمایش',
          remove: 'حذف',
          paid: 'پرداخت‌شده',
          records: 'صورتحساب‌ها',
        }
      : {
          amount: 'Amount',
          count: 'Count',
          date: 'Date',
          actions: 'Actions',
          view: 'View',
          remove: 'Delete',
          paid: 'Paid',
          records: 'Invoices',
        };
  const numeral = params.has('latin') ? 'latn' : locale === 'fa' ? 'arabext' : 'latn';
  const money = () => (
    <CurrencyCell
      amount="9007199254740993123"
      format={(amount) =>
        new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'IRR',
          maximumFractionDigits: 0,
          numberingSystem: numeral,
        }).format(BigInt(amount))
      }
    />
  );
  const date = () => (
    <DateCell
      value="2026-10-01T22:30:00Z"
      format={(value) =>
        new Intl.DateTimeFormat(locale, {
          timeZone: 'Asia/Tehran',
          dateStyle: 'short',
          numberingSystem: numeral,
        }).format(new Date(value))
      }
    />
  );
  const action = (name: string) => (
    <ActionCell
      label={`${labels.actions} ${name}`}
      actions={[
        { id: 'view', label: labels.view, onSelect: () => setActionEvents((count) => count + 1) },
        {
          id: 'delete',
          label: labels.remove,
          disabled: true,
          destructive: true,
          onSelect: () => setActionEvents((count) => count + 100),
        },
      ]}
    />
  );
  const data = params.has('long')
    ? Array.from({ length: 30 }, (_, index) => ({
        id: `row-${index}`,
        name: `Record ${index + 1}`,
        fixed: `Kept ${index + 1}`,
      }))
    : rows;
  const controlled = !new URLSearchParams(location.search).has('uncontrolled');
  return (
    <main>
      <button onClick={() => setSelected(new Set(['a']))}>Select Alpha externally</button>
      <button onClick={() => setSelected(new Set())}>Clear externally</button>
      <button onClick={() => setLocale((value) => (value === 'en' ? 'fa' : 'en'))}>
        Switch language
      </button>
      <button onClick={() => setMode('loading')}>Show loading</button>
      <button onClick={() => setMode('empty')}>Show empty</button>
      <button onClick={() => setMode('rows')}>Show rows</button>
      <button onClick={() => setSortable((value) => !value)}>Toggle sorting</button>
      <DataTable
        caption={labels.records}
        className={params.has('long') ? 'max-h-64' : undefined}
        {...(advanced
          ? {
              rowLabel: (row: (typeof rows)[number]) => row.name,
              canExpandRow: (row: (typeof rows)[number]) => row.id !== 'a',
              renderExpandedRow: (row: (typeof rows)[number]) => (
                <TextCell value={`Details ${row.name} <script>literal</script>`} />
              ),
            }
          : {})}
        {...(params.has('responsive')
          ? {
              renderCard: (row: (typeof rows)[number]) => (
                <div className="space-y-3">
                  <h2 className="font-semibold">
                    <AvatarCell name={row.name} />
                  </h2>
                  <dl className="space-y-2">
                    <div>
                      <dt className="text-xs text-muted-foreground">{labels.amount}</dt>
                      <dd>{money()}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">{labels.date}</dt>
                      <dd>{date()}</dd>
                    </div>
                  </dl>
                  <div className="flex items-center justify-between gap-3">
                    <StatusCell state="paid" label={labels.paid} />
                    {action(row.name)}
                  </div>
                </div>
              ),
            }
          : {})}
        sortable={sortable}
        {...(params.has('initial-sort')
          ? { initialSortColumn: 'name', initialSortDirection: 'asc' as const }
          : {})}
        locale={locale}
        {...(params.has('latin') ? { numerals: 'latn' as const } : {})}
        loading={mode === 'loading'}
        columns={[
          { id: 'name', header: 'Name', accessorKey: 'name' },
          {
            id: 'fixed',
            header: 'Fixed column',
            accessorKey: 'fixed',
            enableHiding: false,
            sortable: false,
          },
          ...(advanced
            ? [
                {
                  id: 'count',
                  header: labels.count,
                  sortable: false,
                  cell: () => <NumberCell value={12345} locale={locale} numerals={numeral} />,
                },
                { id: 'amount', header: labels.amount, sortable: false, cell: money },
                { id: 'date', header: labels.date, sortable: false, cell: date },
                {
                  id: 'state',
                  header: labels.paid,
                  sortable: false,
                  cell: () => <StatusCell state="paid" label={labels.paid} />,
                },
                {
                  id: 'identity',
                  header: 'Identity',
                  sortable: false,
                  cell: (row: (typeof rows)[number]) => <AvatarCell name={row.name} />,
                },
                {
                  id: 'reference',
                  header: 'Reference',
                  sortable: false,
                  cell: (row: (typeof rows)[number]) => (
                    <LinkCell href={`/invoices/${row.id}`}>Invoice {row.name}</LinkCell>
                  ),
                },
                {
                  id: 'actions',
                  header: labels.actions,
                  sortable: false,
                  cell: (row: (typeof rows)[number]) => action(row.name),
                },
              ]
            : []),
        ]}
        data={mode === 'empty' ? [] : data}
        keyExtractor={(row) => row.id}
        selectable
        {...(controlled ? { selectedRows: selected } : {})}
        onSelectionChange={(value) => {
          setSelected(value);
          setSelectionEvents((count) => count + 1);
        }}
        onSortChange={() => setSortEvents((count) => count + 1)}
      />
      <output aria-label="Sort events">{sortEvents}</output>
      <output aria-label="Selection events">{selectionEvents}</output>
      <output aria-label="Selected keys">{[...selected].sort().join(',')}</output>
      <output aria-label="Action events">{actionEvents}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Fixture />
  </React.StrictMode>
);
