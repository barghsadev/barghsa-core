import { useEffect, useState } from 'react';
import {
  Badge,
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
import { HistoryTable } from './HistoryTable.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';
import { WalletReceiptHistoryDetails } from './WalletReceiptHistoryDetails.js';

export interface WalletTransaction {
  bankReceipt?: WalletBankReceiptHistory;
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
        className="text-primary underline underline-offset-2"
        href={
          staff
            ? `/admin/invoices?invoiceId=${encodeURIComponent(item.refId)}`
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
      <p className="text-muted-foreground">{descriptionText(item)}</p>
      {item.description && (
        <p className="break-words [overflow-wrap:anywhere]" dir="auto">
          {item.description}
        </p>
      )}
    </div>
  );
  const deposit = (item: WalletTransaction) => (
    <ReceiptDepositDate
      value={item.bankReceipt?.paymentDate}
      locale={locale}
      calendar={locale === 'fa' ? 'persian' : 'gregory'}
    />
  );
  const details = (item: WalletTransaction) =>
    item.bankReceipt ? (
      <WalletReceiptHistoryDetails
        receiptId={item.id}
        profileId={profileId}
        receipt={item.bankReceipt}
        locale={locale}
        formatTime={formatTime}
        open={opened.has(item.id)}
        onOpenChange={(open) =>
          setOpened((current) => {
            if (current.has(item.id) === open) return current;
            const next = new Set(current);
            if (open) next.add(item.id);
            else next.delete(item.id);
            return next;
          })
        }
      />
    ) : null;
  if (view === 'table')
    return (
      <HistoryTable
        caption={`${word('title')} · ${t('historyView.table', locale)}`}
        items={items}
        rowKey={(item) => item.id}
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
            render: (item) => (
              <span className="break-words [overflow-wrap:anywhere]" dir="auto">
                {item.bankReceipt?.bankName ?? '—'}
              </span>
            ),
          },
          { id: 'deposit', label: receiptLabel('paymentDate'), render: deposit },
          {
            id: 'transfer',
            label: receiptLabel('payerReference'),
            render: (item) => identity(item.bankReceipt?.payerReference),
          },
          { id: 'details', label: receiptLabel('details'), render: details },
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
              {description(item)}
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
                {item.bankReceipt && (
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
            {item.bankReceipt && <CardFooter className="block">{details(item)}</CardFooter>}
          </Card>
        </li>
      ))}
    </ol>
  );
}
