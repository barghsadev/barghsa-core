import { Eye as TableEyeIcon } from 'lucide-react';
import { TableActionIcon } from './TableActionIcon.js';
import { Button, StatusBadge, buttonVariants, type ListView } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';
import { HistoryTable, TableCellDetails, type HistoryColumn } from './HistoryTable.js';

interface WalletReceiptSummary {
  transactionId: string;
  walletId: string;
  amount: string;
  currency: 'IRR';
  state: string;
  paymentDate: string | null;
  payerReference: string | null;
  bankName?: string | null;
  submittedAt: string;
  dualApproval?: { invoiceId: string | null } | null;
  overpayment?: { invoiceId: string } | null;
}
export function StaffWalletReceiptList({
  items,
  view,
  selectedId,
  disabled,
  onSelect,
  receiptSearch,
}: {
  items: readonly WalletReceiptSummary[];
  view: ListView;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  receiptSearch?: Record<string, unknown>;
}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => t(`admin.walletReceipts.${key}`, locale);
  const invoiceText = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const id = (value: string | null | undefined) => (
    <bdi dir="ltr" className="break-all">
      {value ?? '—'}
    </bdi>
  );
  const identity = (row: WalletReceiptSummary) => (
    <div className="min-w-0 space-y-1">
      <p className="wrap-anywhere font-semibold">{row.bankName ?? '—'}</p>
      <p className="text-xs font-normal text-muted-foreground">{id(row.transactionId)}</p>
      {row.payerReference && (
        <p className="text-xs font-normal text-muted-foreground">{id(row.payerReference)}</p>
      )}
    </div>
  );
  const status = (row: WalletReceiptSummary) => (
    <StatusBadge
      state={row.state === 'Released' ? 'approved' : row.state}
      label={appText(`wallet.history.state.${row.state}`, locale)}
    />
  );
  const amount = (row: WalletReceiptSummary) => (
    <bdi className="font-semibold whitespace-nowrap">
      {numbers.irrDigits(row.amount)} {row.currency}
    </bdi>
  );
  const related = (row: WalletReceiptSummary) => (
    <TableCellDetails
      fields={[
        { id: 'wallet', label: word('walletId'), value: id(row.walletId) },
        {
          id: 'invoice',
          label: invoiceText('invoice'),
          value: id(row.dualApproval?.invoiceId ?? row.overpayment?.invoiceId),
        },
        {
          id: 'deposit',
          label: word('paymentDate'),
          value: <ReceiptDepositDate value={row.paymentDate} locale={locale} />,
        },
        {
          id: 'submitted',
          label: word('submittedAt'),
          value: <time dateTime={row.submittedAt}>{time.format(row.submittedAt)}</time>,
        },
      ]}
    />
  );
  const fields: HistoryColumn<WalletReceiptSummary>[] = [
    { id: 'receipt', label: invoiceText('receipt'), render: identity },
    { id: 'state', label: invoiceText('historyState'), render: status },
    { id: 'amount', label: word('amount'), render: amount },
    { id: 'activity', label: appText('recordTable.activity', locale), render: related },
  ];
  const selectProps = (row: WalletReceiptSummary) => ({
    disabled,
    'aria-current': row.transactionId === selectedId ? ('true' as const) : undefined,
    onClick: () => onSelect(row.transactionId),
  });
  const cardFields = (row: WalletReceiptSummary) => (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        {identity(row)}
        {status(row)}
      </div>
      <div className="border-t pt-3">{amount(row)}</div>
      {related(row)}
    </>
  );
  if (view === 'table')
    return (
      <HistoryTable
        caption={`${word('queueLabel')} · ${appText('historyView.table', locale)}`}
        items={items}
        rowKey={(row) => row.transactionId}
        columns={[
          ...fields,
          {
            id: 'open',
            label: invoiceText('open'),
            actions: true,
            render: (row) =>
              receiptSearch && !disabled ? (
                <Link
                  to="/admin/wallet-receipts/$receiptId/{-$action}"
                  params={{ receiptId: row.transactionId, action: undefined }}
                  search={receiptSearch}
                  className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                  data-table-action-tooltip={invoiceText('open')}
                >
                  <TableActionIcon icon={TableEyeIcon}>{invoiceText('open')}</TableActionIcon>
                </Link>
              ) : (
                <Button
                  variant="outline"
                  {...selectProps(row)}
                  data-table-action-tooltip={invoiceText('open')}
                >
                  <TableActionIcon icon={TableEyeIcon}>{invoiceText('open')}</TableActionIcon>
                </Button>
              ),
          },
        ]}
      />
    );
  return (
    <ul className="space-y-2">
      {items.map((row) => (
        <li key={row.transactionId}>
          {receiptSearch && !disabled ? (
            <Link
              to="/admin/wallet-receipts/$receiptId/{-$action}"
              params={{ receiptId: row.transactionId, action: undefined }}
              search={receiptSearch}
              className="block space-y-3 rounded-xl border bg-card p-4 text-sm hover:bg-muted"
            >
              {cardFields(row)}
            </Link>
          ) : (
            <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
              {cardFields(row)}
              <Button
                type="button"
                variant="outline"
                {...selectProps(row)}
                aria-label={`${invoiceText('open')}: ${row.payerReference ?? row.transactionId}`}
              >
                {invoiceText('open')}
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
