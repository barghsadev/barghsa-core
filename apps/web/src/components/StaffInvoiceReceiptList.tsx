import { Eye as TableEyeIcon } from 'lucide-react';
import { TableActionIcon } from './TableActionIcon.js';
import { Button, StatusBadge, type ListView } from '@barghsa/ui';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { HistoryTable, TableCellDetails, type HistoryColumn } from './HistoryTable.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';

interface ReceiptSummary {
  receiptId: string;
  invoiceId: string;
  amount: string;
  bankName: string | null;
  state: string;
  paymentDate: string;
  submittedAt: string;
}
export function StaffInvoiceReceiptList({
  items,
  view,
  caption,
  onOpen,
}: {
  items: readonly ReceiptSummary[];
  view: ListView;
  caption: string;
  onOpen: (receiptId: string) => void;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const status = (item: ReceiptSummary) => (
    <StatusBadge
      state={item.state === 'Confirmed' ? 'approved' : item.state}
      label={appText(`invoices.activity.state.${item.state}`, locale)}
    />
  );
  const open = (item: ReceiptSummary) => (
    <Button
      variant="outline"
      onClick={() => onOpen(item.receiptId)}
      data-table-action-tooltip={word('open')}
    >
      <TableActionIcon icon={TableEyeIcon}>{word('open')}</TableActionIcon>
    </Button>
  );
  const amount = (item: ReceiptSummary) => (
    <bdi className="font-semibold whitespace-nowrap">{numbers.money(item.amount)}</bdi>
  );
  const identity = (item: ReceiptSummary) => (
    <div className="min-w-0 space-y-1">
      <p className="wrap-anywhere font-semibold">{item.bankName ?? '—'}</p>
      <p className="text-xs font-normal text-muted-foreground">
        <bdi dir="ltr" className="wrap-anywhere">
          {item.receiptId}
        </bdi>
      </p>
    </div>
  );
  const related = (item: ReceiptSummary) => (
    <TableCellDetails
      fields={[
        { id: 'invoice', label: word('invoice'), value: <bdi dir="ltr">{item.invoiceId}</bdi> },
        {
          id: 'deposit',
          label: word('paymentDate'),
          value: <ReceiptDepositDate value={item.paymentDate} locale={locale} calendar="gregory" />,
        },
        {
          id: 'submitted',
          label: word('submitted'),
          value: <time dateTime={item.submittedAt}>{time.format(item.submittedAt)}</time>,
        },
      ]}
    />
  );
  const columns: HistoryColumn<ReceiptSummary>[] = [
    { id: 'receipt', label: word('receipt'), render: identity },
    { id: 'state', label: word('historyState'), render: status },
    { id: 'amount', label: word('amount'), render: amount },
    { id: 'activity', label: appText('recordTable.activity', locale), render: related },
    { id: 'open', label: word('open'), render: open, actions: true },
  ];

  if (view === 'table')
    return (
      <HistoryTable
        caption={`${caption} · ${appText('historyView.table', locale)}`}
        items={items}
        rowKey={(item) => item.receiptId}
        columns={columns}
      />
    );
  return (
    <ul className="grid gap-3">
      {items.map((item) => (
        <li
          key={item.receiptId}
          className="min-w-0 space-y-3 rounded-xl border bg-card p-4 text-sm"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            {identity(item)}
            {status(item)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            {amount(item)}
            {open(item)}
          </div>
          {related(item)}
        </li>
      ))}
    </ul>
  );
}
