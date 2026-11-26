import { useEffect, useId, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
  CardFooter,
  cn,
  type ListView,
} from '@barghsa/ui';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { tWalletReceipts as receiptText } from '@barghsa/i18n/wallet-receipts';
import type { WalletBankReceiptHistory } from '@barghsa/shared/finance';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Eye,
  EyeOff,
  LockKeyhole,
  LockKeyholeOpen,
  RotateCcw,
  SlidersHorizontal,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { Currency } from './Currency.js';
import { isInvoiceUuid } from '../lib/invoice-uuid.js';
import type { useAccountTime } from '../hooks/useAccountTime.js';
import { HistoryTable, TableCellDetails } from './HistoryTable.js';
import { TableActionIcon } from './TableActionIcon.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';
import { WalletReceiptHistoryDetails } from './WalletReceiptHistoryDetails.js';

export interface WalletTransaction {
  bankReceipt?: WalletBankReceiptHistory;
  staffSource?: 'ledger' | 'bank_receipt' | 'online' | 'invoice';
  receiptId?: string;
  id: string;
  type: string;
  amount: string;
  state: string;
  refId: string | null;
  description: string | null;
  createdAt: string;
}
const icons: Record<string, LucideIcon> = {
  topup: ArrowDownLeft,
  payment: ArrowUpRight,
  refund: RotateCcw,
  reservation: LockKeyhole,
  release: LockKeyholeOpen,
  reversal: RotateCcw,
  compensating: SlidersHorizontal,
};

/** Both layouts use the same accepted page, exact amounts and customer receipt projection. */
export function WalletTransactionRecords({
  items,
  view,
  profileId,
  locale,
  formatTime,
  staff = false,
}: {
  items: readonly WalletTransaction[];
  view: ListView;
  profileId: string;
  locale: Locale;
  formatTime: ReturnType<typeof useAccountTime>['format'];
  staff?: boolean;
}) {
  const detailsPrefix = useId();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    setOpened((current) =>
      [...current].every((id) => ids.has(id))
        ? current
        : new Set([...current].filter((id) => ids.has(id)))
    );
  }, [items]);
  const word = (key: string) => t(`wallet.history.${key}`, locale);
  const receiptLabel = (key: string) => receiptText(`wallet.receipt.${key}`, locale);
  const identity = (value: string | null | undefined) =>
    value ? (
      <bdi dir="ltr" className="break-all">
        {value}
      </bdi>
    ) : (
      <>—</>
    );
  const type = (item: WalletTransaction) => {
    const Icon = icons[item.type] ?? Wallet;
    return (
      <span className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {word(`type.${item.type}`)}
      </span>
    );
  };
  const amount = (item: WalletTransaction) => {
    const value = BigInt(item.amount);
    return (
      <span className="grid gap-0.5">
        <bdi
          dir="ltr"
          className={cn(
            'font-semibold tabular-nums',
            item.state === 'Completed' && value > 0n
              ? 'text-success'
              : item.state === 'Completed' && value < 0n
                ? 'text-destructive'
                : 'text-foreground'
          )}
        >
          {value > 0n ? '+' : ''}
          <Currency
            amount={item.amount}
            showCurrencyCode={false}
            variant="small"
            locale={locale}
          />{' '}
          {word('irr')}
        </bdi>
        {staff && item.state === 'Completed' && value !== 0n && (
          <span className="text-xs text-muted-foreground">
            {word(value > 0n ? 'credit' : 'debit')}
          </span>
        )}
      </span>
    );
  };
  const state = (item: WalletTransaction) => (
    <Badge
      variant={
        item.state === 'Completed'
          ? 'success'
          : ['Failed', 'Rejected', 'Reversed'].includes(item.state)
            ? 'destructive'
            : 'outline'
      }
    >
      {item.bankReceipt && item.state === 'Released'
        ? receiptLabel('confirmed')
        : word(`state.${item.state}`)}
    </Badge>
  );
  const date = (item: WalletTransaction) => (
    <time dateTime={item.createdAt}>
      {formatTime(item.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
    </time>
  );
  const reference = (item: WalletTransaction) =>
    item.type === 'payment' && item.refId && isInvoiceUuid(item.refId) ? (
      <a
        className="touch-action text-primary underline underline-offset-2"
        href={
          staff
            ? `/admin/invoices/${encodeURIComponent(item.refId)}`
            : `/invoices/${encodeURIComponent(item.refId)}`
        }
      >
        {word('viewInvoice')}: {identity(item.refId)}
      </a>
    ) : (
      identity(item.refId)
    );
  const descriptionText = (item: WalletTransaction) => {
    if (item.bankReceipt && item.state === 'Pending')
      return receiptLabel(`awaiting.${item.bankReceipt.timeline.awaiting ?? 'review'}`);
    if (item.bankReceipt && item.state === 'Released') return receiptLabel('confirmed');
    return item.state === 'Completed'
      ? word(`description.${item.type}`)
      : t(`invoices.activity.description.${item.state}`, locale);
  };
  const description = (item: WalletTransaction) => (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-foreground">{descriptionText(item)}</p>
      {item.description && (
        <p className="break-words [overflow-wrap:anywhere]" dir="auto">
          {item.description}
        </p>
      )}
    </div>
  );
  const source = (item: WalletTransaction) => {
    const origin =
      item.staffSource ?? (item.type === 'payment' && item.refId ? 'invoice' : 'ledger');
    if (origin === 'bank_receipt' && item.receiptId && isInvoiceUuid(item.receiptId)) {
      return (
        <a
          className="touch-action text-primary underline underline-offset-2"
          href={`/admin/wallet-receipts/${encodeURIComponent(item.receiptId)}`}
        >
          {word('source.bank_receipt')}
        </a>
      );
    }
    return word(`source.${origin}`);
  };
  const deposit = (item: WalletTransaction) => (
    <ReceiptDepositDate value={item.bankReceipt?.paymentDate} locale={locale} />
  );
  const detailsId = (item: WalletTransaction) => `${detailsPrefix}-${item.id}`;
  function changeDetails(id: string, open: boolean) {
    setOpened((current) => {
      if (current.has(id) === open) return current;
      const next = new Set(current);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  const details = (item: WalletTransaction) =>
    item.bankReceipt ? (
      <WalletReceiptHistoryDetails
        id={detailsId(item)}
        receiptId={item.id}
        profileId={profileId}
        receipt={item.bankReceipt}
        locale={locale}
        formatTime={formatTime}
        open={opened.has(item.id)}
        onOpenChange={(open) => changeDetails(item.id, open)}
      />
    ) : null;
  if (view === 'table' && staff)
    return (
      <HistoryTable
        caption={`${word('title')} · ${t('historyView.table', locale)}`}
        items={items}
        rowKey={(item) => item.id}
        columns={[
          {
            id: 'type',
            label: word('type'),
            render: (item) => (
              <div className="min-w-0 space-y-1">
                {type(item)}
                {item.description && (
                  <p className="wrap-anywhere text-xs font-normal text-muted-foreground" dir="auto">
                    {item.description}
                  </p>
                )}
              </div>
            ),
          },
          { id: 'state', label: word('state'), render: state },
          { id: 'amount', label: word('amount'), render: amount },
          {
            id: 'activity',
            label: t('recordTable.activity', locale),
            render: (item) => (
              <TableCellDetails
                fields={[
                  { id: 'date', label: word('date'), value: date(item) },
                  { id: 'transaction', label: word('transactionId'), value: identity(item.id) },
                  { id: 'reference', label: word('reference'), value: reference(item) },
                ]}
              />
            ),
          },
          { id: 'source', label: word('source'), render: source },
        ]}
      />
    );
  if (view === 'table')
    return (
      <HistoryTable
        caption={`${word('title')} · ${t('historyView.table', locale)}`}
        items={items}
        rowKey={(item) => item.id}
        renderExpandedRow={(item) => opened.has(item.id) && details(item)}
        columns={[
          { id: 'date', label: word('date'), render: date },
          { id: 'type', label: word('type'), render: type },
          { id: 'state', label: word('state'), render: state },
          { id: 'amount', label: word('amount'), render: amount },
          { id: 'id', label: word('transactionId'), render: (item) => identity(item.id) },
          { id: 'reference', label: word('reference'), render: reference },
          { id: 'description', label: word('description'), render: description },
          {
            id: 'bank',
            label: receiptLabel('bankName'),
            render: (item: WalletTransaction) => (
              <span className="break-words [overflow-wrap:anywhere]" dir="auto">
                {item.bankReceipt?.bankName ?? '—'}
              </span>
            ),
          },
          { id: 'deposit', label: receiptLabel('paymentDate'), render: deposit },
          {
            id: 'transfer',
            label: receiptLabel('payerReference'),
            render: (item: WalletTransaction) => identity(item.bankReceipt?.payerReference),
          },
          {
            id: 'details',
            label: <span className="sr-only">{receiptLabel('details')}</span>,
            actions: true,
            render: (item: WalletTransaction) => {
              if (!item.bankReceipt) return null;
              const open = opened.has(item.id);
              return (
                <Button
                  type="button"
                  variant="outline"
                  aria-expanded={open}
                  aria-controls={open ? detailsId(item) : undefined}
                  data-table-action-tooltip={receiptLabel('details')}
                  onClick={() => changeDetails(item.id, !open)}
                >
                  <TableActionIcon icon={open ? EyeOff : Eye}>
                    {receiptLabel('details')}
                  </TableActionIcon>
                </Button>
              );
            },
          },
        ]}
      />
    );
  return (
    <ol
      aria-label={`${word('title')} · ${t('historyView.card', locale)}`}
      className="flex min-w-0 flex-col gap-3"
    >
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <Card size="sm">
            <CardHeader className="flex flex-wrap items-start justify-between gap-2">
              <CardTitle>{type(item)}</CardTitle>
              <CardAction>{amount(item)}</CardAction>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {state(item)}
                {date(item)}
              </div>
              {staff && item.description ? (
                <p className="wrap-anywhere text-sm text-muted-foreground" dir="auto">
                  {item.description}
                </p>
              ) : (
                description(item)
              )}
              <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{word('transactionId')}</dt>
                  <dd>{identity(item.id)}</dd>
                </div>
                {item.refId && (
                  <div>
                    <dt className="text-muted-foreground">{word('reference')}</dt>
                    <dd className="break-all">{reference(item)}</dd>
                  </div>
                )}
                {staff && (
                  <div>
                    <dt className="text-muted-foreground">{word('source')}</dt>
                    <dd>{source(item)}</dd>
                  </div>
                )}
                {!staff && item.bankReceipt && (
                  <>
                    <div>
                      <dt className="text-muted-foreground">{receiptLabel('bankName')}</dt>
                      <dd className="break-words [overflow-wrap:anywhere]" dir="auto">
                        {item.bankReceipt.bankName ?? '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{receiptLabel('paymentDate')}</dt>
                      <dd>{deposit(item)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{receiptLabel('payerReference')}</dt>
                      <dd>{identity(item.bankReceipt.payerReference)}</dd>
                    </div>
                  </>
                )}
              </dl>
            </CardContent>
            {!staff && item.bankReceipt && (
              <CardFooter className="block">{details(item)}</CardFooter>
            )}
          </Card>
        </li>
      ))}
    </ol>
  );
}
