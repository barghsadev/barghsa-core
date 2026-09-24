import { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, PageLoading, StatusBadge } from '@barghsa/ui';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { BANK_RECEIPT_REJECT_REASON_MAX_LENGTH } from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { InvoiceBankReceiptHistory } from './InvoiceBankReceiptHistory.js';

const base = '/api/admin/invoices/bank-receipts';

interface Receipt {
  receiptId: string;
  invoiceId: string;
  profileId: string;
  amount: string;
  state: string;
  paymentDate: string;
  payerReference: string;
  customerNote: string | null;
  submittedAt: string;
  attachmentUrl: string | null;
  canConfirm: boolean;
  canReject: boolean;
  rejectionReason: string | null;
  invoiceAllocation: string | null;
  walletCreditAmount: string | null;
  confirmedAt: string | null;
  requiresDualApproval: boolean;
  dualApprovalPending: boolean;
}

interface Allocation {
  receiptId: string;
  invoiceId: string;
  invoiceState: string;
  receiptAmount: string;
  remaining: string;
  invoiceAllocation: string;
  walletCreditAmount: string;
}

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'include', signal });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

export function InvoiceBankReceiptQueue() {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const [items, setItems] = useState<Receipt[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>(
    'loading'
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<'pending' | 'history'>('pending');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [detail, setDetail] = useState<Receipt | null>(null);
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [allocationError, setAllocationError] = useState(false);
  const [reason, setReason] = useState('');
  const [action, setAction] = useState<TeamAction | null>(null);
  const [revision, setRevision] = useState(0);
  const detailRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (selectedId) detailRef.current?.scrollIntoView?.({ block: 'start' });
  }, [selectedId, selectedSource]);

  useEffect(() => {
    const controller = new AbortController();
    setListState('loading');
    void getJson<{ items: Receipt[] }>(base, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setItems(value.items);
          setListState('ready');
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setListState(error instanceof Error && error.message === '403' ? 'forbidden' : 'error');
      });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setAllocation(null);
      return;
    }
    const controller = new AbortController();
    const path = `${base}/${encodeURIComponent(selectedId)}`;
    setDetail(null);
    setAllocation(null);
    setDetailState('loading');
    setAllocationError(false);
    void Promise.allSettled([
      getJson<Receipt>(path, controller.signal),
      selectedSource === 'pending'
        ? getJson<Allocation>(`${path}/allocation`, controller.signal)
        : Promise.resolve(null),
    ]).then(([receipt, preview]) => {
      if (controller.signal.aborted) return;
      if (receipt.status === 'fulfilled') {
        setDetail(receipt.value);
        setDetailState('ready');
      } else {
        setDetailState('error');
      }
      if (preview.status === 'fulfilled') setAllocation(preview.value);
      else if (selectedSource === 'pending') setAllocationError(true);
    });
    return () => controller.abort();
  }, [selectedId, selectedSource, revision]);

  function refresh() {
    setRevision((value) => value + 1);
  }

  function review(kind: 'confirm' | 'reject') {
    if (!detail) return;
    if (
      kind === 'confirm' &&
      (!detail.canConfirm || detail.dualApprovalPending || !allocation || !detail.attachmentUrl)
    )
      return;
    const rejection = reason.trim();
    if (kind === 'reject' && (!detail.canReject || !rejection)) return;
    setAction({
      title: word(kind),
      description: kind === 'confirm' ? word('confirmNotice') : word('rejectNotice'),
      path: `${base}/${encodeURIComponent(detail.receiptId)}/${kind}`,
      method: 'POST',
      ...(kind === 'reject' ? { body: { reason: rejection } } : {}),
      conflictMessage: word('conflict'),
      forbiddenMessage: word('forbidden'),
    });
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-label={word('title')}>
      {time.notice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{word('title')}</h2>
          <p className="text-sm text-muted-foreground">{word('description')}</p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={listState === 'loading'}>
          {word('refresh')}
        </Button>
      </div>
      {listState === 'loading' ? <PageLoading label={word('loading')} /> : null}
      {listState === 'forbidden' ? <p role="alert">{word('forbidden')}</p> : null}
      {listState === 'error' ? <p role="alert">{word('loadError')}</p> : null}
      {listState === 'ready' && !items.length ? <p>{word('empty')}</p> : null}
      {listState === 'ready' && items.length ? (
        <ul className="divide-y rounded-lg border">
          {items.map((item) => (
            <li
              key={item.receiptId}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="space-y-1 text-sm">
                <p>
                  {word('invoice')}: <bdi className="break-all">{item.invoiceId}</bdi>
                </p>
                <p>
                  {numbers.money(item.amount)} · {time.format(item.submittedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge label={appText(`invoices.activity.state.${item.state}`, locale)} />
                <Button
                  variant="outline"
                  onClick={() => {
                    setReason('');
                    setSelectedSource('pending');
                    setSelectedId(item.receiptId);
                  }}
                >
                  {word('open')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        variant="outline"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen((value) => !value)}
      >
        {word('historyTitle')}
      </Button>
      {historyOpen ? (
        <InvoiceBankReceiptHistory
          revision={revision}
          onOpen={(receiptId) => {
            setReason('');
            setSelectedSource('history');
            setSelectedId(receiptId);
          }}
        />
      ) : null}
      {selectedId ? (
        <section
          ref={detailRef}
          className="space-y-4 rounded-lg border p-4"
          aria-label={word('detail')}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{word('detail')}</h3>
              {detail ? (
                <StatusBadge label={appText(`invoices.activity.state.${detail.state}`, locale)} />
              ) : null}
            </div>
            <Button variant="ghost" onClick={() => setSelectedId(null)}>
              {word('close')}
            </Button>
          </div>
          {detailState === 'loading' ? <PageLoading label={word('loading')} /> : null}
          {detailState === 'error' ? <p role="alert">{word('detailError')}</p> : null}
          {detail ? (
            <>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{word('receipt')}</dt>
                  <dd className="break-all">
                    <bdi>{detail.receiptId}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('invoice')}</dt>
                  <dd className="break-all">
                    <bdi>{detail.invoiceId}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('amount')}</dt>
                  <dd>{numbers.money(detail.amount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('paymentDate')}</dt>
                  <dd>
                    <bdi>{detail.paymentDate}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('reference')}</dt>
                  <dd className="break-all">
                    <bdi>{detail.payerReference}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('submitted')}</dt>
                  <dd>{time.format(detail.submittedAt)}</dd>
                </div>
                {detail.confirmedAt ? (
                  <div>
                    <dt className="text-muted-foreground">{word('confirmed')}</dt>
                    <dd>{time.format(detail.confirmedAt)}</dd>
                  </div>
                ) : null}
              </dl>
              {detail.customerNote ? <p className="text-sm">{detail.customerNote}</p> : null}
              {detail.attachmentUrl ? (
                <a
                  href={detail.attachmentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary underline underline-offset-4"
                >
                  {word('attachment')}
                </a>
              ) : (
                <p role="alert" className="text-sm">
                  {word(
                    selectedSource === 'history'
                      ? 'historyAttachmentUnavailable'
                      : 'attachmentUnavailable'
                  )}
                </p>
              )}
              {detail.rejectionReason ? (
                <p className="text-sm">
                  {word('historyRejectionReason')}: {detail.rejectionReason}
                </p>
              ) : null}
              {allocation ? (
                <dl className="grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt>{word('remaining')}</dt>
                    <dd>{numbers.money(allocation.remaining)}</dd>
                  </div>
                  <div>
                    <dt>{word('invoiceAllocation')}</dt>
                    <dd>{numbers.money(allocation.invoiceAllocation)}</dd>
                  </div>
                  <div>
                    <dt>{word('walletCredit')}</dt>
                    <dd>{numbers.money(allocation.walletCreditAmount)}</dd>
                  </div>
                  <div>
                    <dt>{word('invoiceState')}</dt>
                    <dd>{appText(`invoices.state.${allocation.invoiceState}`, locale)}</dd>
                  </div>
                </dl>
              ) : null}
              {allocationError ? (
                <Alert variant="destructive">
                  <AlertDescription>{word('allocationError')}</AlertDescription>
                </Alert>
              ) : null}
              {selectedSource === 'history' &&
              detail.state === 'Confirmed' &&
              detail.invoiceAllocation !== null ? (
                <dl className="grid gap-2 rounded-lg bg-muted p-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt>{word('invoiceAllocation')}</dt>
                    <dd>{numbers.money(detail.invoiceAllocation)}</dd>
                  </div>
                  <div>
                    <dt>{word('walletCredit')}</dt>
                    <dd>{numbers.money(detail.walletCreditAmount ?? '0')}</dd>
                  </div>
                </dl>
              ) : null}
              {detail.dualApprovalPending ? (
                <p role="status" className="text-sm">
                  {word('approvalPending')}{' '}
                  <a
                    href="/admin/approval-requests"
                    className="text-primary underline underline-offset-4"
                  >
                    {word('openApprovals')}
                  </a>
                </p>
              ) : null}
              {detail.requiresDualApproval && !detail.dualApprovalPending ? (
                <p className="text-sm text-muted-foreground">{word('approvalRequired')}</p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {detail.canConfirm && !detail.dualApprovalPending ? (
                  <Button
                    disabled={!allocation || !detail.attachmentUrl}
                    onClick={() => review('confirm')}
                  >
                    {word('confirm')}
                  </Button>
                ) : null}
                {detail.canReject ? (
                  <div className="flex flex-col gap-2">
                    <label htmlFor="invoice-receipt-reason">{word('reason')}</label>
                    <textarea
                      id="invoice-receipt-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      maxLength={BANK_RECEIPT_REJECT_REASON_MAX_LENGTH}
                      className="min-h-20 rounded-md border bg-background p-2"
                    />
                    <Button
                      variant="outline"
                      disabled={!reason.trim()}
                      onClick={() => review('reject')}
                    >
                      {word('reject')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          summary={
            allocation && action.path.endsWith('/confirm') ? (
              <p>
                {word('invoiceAllocation')}: {numbers.money(allocation.invoiceAllocation)} ·{' '}
                {word('walletCredit')}: {numbers.money(allocation.walletCreditAmount)}
              </p>
            ) : null
          }
          onClose={() => setAction(null)}
          onSuccess={async () => {
            setAction(null);
            setReason('');
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}
