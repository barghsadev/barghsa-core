import { Button, StatusBadge, type ListView } from '@barghsa/ui';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { t as appText } from '@barghsa/i18n/workspace';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { HistoryTable } from './HistoryTable.js';
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
    <StatusBadge label={appText(`invoices.activity.state.${item.state}`, locale)} />
  );
  const open = (item: ReceiptSummary) => (
    <Button variant="outline" onClick={() => onOpen(item.receiptId)}>
      {word('open')}
    </Button>
  );
  if (view === 'table')
    return (
      <HistoryTable
        caption={`${caption} · ${appText('historyView.table', locale)}`}
        items={items}
        rowKey={(item) => item.receiptId}
        columns={[
          {
            id: 'receipt',
            label: word('receipt'),
            render: (item) => (
              <bdi dir="ltr" className="break-all">
                {item.receiptId}
              </bdi>
            ),
          },
          {
            id: 'invoice',
            label: word('invoice'),
            render: (item) => (
              <bdi dir="ltr" className="break-all">
                {item.invoiceId}
              </bdi>
            ),
          },
          { id: 'amount', label: word('amount'), render: (item) => numbers.money(item.amount) },
          {
            id: 'bank',
            label: word('bankName'),
            render: (item) => <span className="break-words">{item.bankName ?? '—'}</span>,
          },
          {
            id: 'deposit',
            label: word('paymentDate'),
            render: (item) => <ReceiptDepositDate value={item.paymentDate} />,
          },
          { id: 'state', label: word('historyState'), render: status },
          {
            id: 'submitted',
            label: word('submitted'),
            render: (item) => (
              <time dateTime={item.submittedAt}>{time.format(item.submittedAt)}</time>
            ),
          },
          { id: 'open', label: word('open'), render: open },
        ]}
      />
    );
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((item) => (
        <li
          key={item.receiptId}
          className="flex min-w-0 flex-wrap items-center justify-between gap-3 p-3"
        >
          <dl className="min-w-0 space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground">{word('receipt')}</dt>
              <dd>
                <bdi dir="ltr" className="break-all">
                  {item.receiptId}
                </bdi>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('invoice')}</dt>
              <dd>
                <bdi dir="ltr" className="break-all">
                  {item.invoiceId}
                </bdi>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('amount')}</dt>
              <dd className="font-medium">{numbers.money(item.amount)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('bankName')}</dt>
              <dd className="break-words">{item.bankName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('paymentDate')}</dt>
              <dd>
                <ReceiptDepositDate value={item.paymentDate} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{word('submitted')}</dt>
              <dd>
                <time dateTime={item.submittedAt}>{time.format(item.submittedAt)}</time>
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            {status(item)}
            {open(item)}
          </div>
        </li>
      ))}
    </ul>
  );
}
