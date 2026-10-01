import { Button, StatusBadge, type ListView } from '@barghsa/ui';
import { tWalletReceipts as t } from '@barghsa/i18n/wallet-receipts';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';
import { HistoryTable } from './HistoryTable.js';

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
}: {
  items: readonly WalletReceiptSummary[];
  view: ListView;
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
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
  const fields = [
    {
      id: 'receipt',
      label: invoiceText('receipt'),
      render: (row: WalletReceiptSummary) => id(row.transactionId),
    },
    {
      id: 'wallet',
      label: word('walletId'),
      render: (row: WalletReceiptSummary) => id(row.walletId),
    },
    {
      id: 'invoice',
      label: invoiceText('invoice'),
      render: (row: WalletReceiptSummary) =>
        id(row.dualApproval?.invoiceId ?? row.overpayment?.invoiceId),
    },
    {
      id: 'amount',
      label: word('amount'),
      render: (row: WalletReceiptSummary) => (
        <>
          {numbers.irrDigits(row.amount)} {row.currency}
        </>
      ),
    },
    {
      id: 'deposit',
      label: word('paymentDate'),
      render: (row: WalletReceiptSummary) => (
        <ReceiptDepositDate
          value={row.paymentDate}
          calendar={locale === 'fa' ? 'persian' : 'gregory'}
        />
      ),
    },
    {
      id: 'reference',
      label: word('payerReference'),
      render: (row: WalletReceiptSummary) => id(row.payerReference),
    },
    {
      id: 'bank',
      label: invoiceText('bankName'),
      render: (row: WalletReceiptSummary) => (
        <span className="break-words">{row.bankName ?? '—'}</span>
      ),
    },
    {
      id: 'state',
      label: invoiceText('historyState'),
      render: (row: WalletReceiptSummary) => (
        <StatusBadge label={appText(`wallet.history.state.${row.state}`, locale)} />
      ),
    },
    {
      id: 'submitted',
      label: word('submittedAt'),
      render: (row: WalletReceiptSummary) => (
        <time dateTime={row.submittedAt}>{time.format(row.submittedAt)}</time>
      ),
    },
  ];
  const selectProps = (row: WalletReceiptSummary) => ({
    disabled,
    'aria-current': row.transactionId === selectedId ? ('true' as const) : undefined,
    onClick: () => onSelect(row.transactionId),
  });
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
            render: (row) => (
              <Button variant="outline" {...selectProps(row)}>
                {invoiceText('open')}
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
          <button
            type="button"
            {...selectProps(row)}
            className={`w-full min-w-0 space-y-2 rounded-lg border border-border p-3 text-start text-sm disabled:opacity-50 ${row.transactionId === selectedId ? 'bg-muted text-foreground' : 'bg-card text-card-foreground hover:bg-muted'}`}
          >
            {fields.map((field) => (
              <span key={field.id} className="block min-w-0">
                <span className="block text-xs text-muted-foreground">{field.label}</span>
                {field.render(row)}
              </span>
            ))}
          </button>
        </li>
      ))}
    </ul>
  );
}
