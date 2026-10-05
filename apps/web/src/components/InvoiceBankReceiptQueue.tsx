import { useReceiptRejectionForm } from '../hooks/useReceiptRejectionForm.js';
import type { FormEvent } from 'react';
import { ReceiptStatusTimeline } from './ReceiptStatusTimeline.js';
import type { InvoiceReceiptActivity } from '../lib/customer-invoices.js';
import { useReceiptQueueQuery, receiptQueueParams } from '../hooks/useReceiptQueueQuery.js';
import { ReceiptQueueControls, ReceiptQueuePagination } from './ReceiptQueueControls.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import type { FinanceCursor } from '../lib/finance-list-query.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  ListPage,
  ListViewToggle,
  PageLoading,
  StatusBadge,
} from '@barghsa/ui';
import { t as adminText } from '@barghsa/i18n/admin-ui';
import { t as appText } from '@barghsa/i18n/app';
import { BANK_RECEIPT_REJECT_REASON_MAX_LENGTH } from '@barghsa/shared/finance/browser';
import type { BankReceiptConfirmationReview } from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { InvoiceBankReceiptHistory } from './InvoiceBankReceiptHistory.js';
import { BankReceiptFinancialReview } from './BankReceiptFinancialReview.js';
import { withCsrf } from '../lib/csrf.js';
import { useListView } from '../hooks/useListView.js';
import { StaffInvoiceReceiptList } from './StaffInvoiceReceiptList.js';
import { ReceiptDepositDate } from './ReceiptDepositDate.js';
import { StaffReceiptAttachmentPreview } from './StaffReceiptAttachmentPreview.js';

const base = '/api/admin/invoices/bank-receipts';

interface Receipt {
  receiptId: string;
  invoiceId: string;
  profileId: string;
  amount: string;
  state: string;
  paymentDate: string;
  payerReference: string;
  bankName: string | null;
  customerNote: string | null;
  submittedAt: string;
  attachmentUrl: string | null;
  attachmentKey?: string | null;
  canConfirm: boolean;
  canReject: boolean;
  rejectionReason: string | null;
  invoiceAllocation: string | null;
  walletCreditAmount: string | null;
  confirmedAt: string | null;
  requiresDualApproval: boolean;
  dualApprovalPending: boolean;
  statusHistory?: InvoiceReceiptActivity['statusHistory'];
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

export interface ReceiptHistoryQuery {
  query: import('../hooks/useListQuery.js').ListQueryBinding;
  open: boolean;
  setOpen: (open: boolean) => void;
}
export function InvoiceBankReceiptQueue({
  initialSelection,
  historyQuery,
  pendingQuery,
}: {
  initialSelection?: { receiptId: string; state: string } | null;
  historyQuery?: ReceiptHistoryQuery;
  pendingQuery?: ListQueryBinding;
} = {}) {
  const queueBinding = useReceiptQueueQuery(pendingQuery);
  const queueParams = receiptQueueParams(queueBinding);
  const queueScopeRef = useRef(queueParams);
  const [nextCursor, setNextCursor] = useState<FinanceCursor | null>(null);
  const actionRef = useRef<TeamAction | null>(null);
  const reviewGeneration = useRef(0);
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const { view, setView } = useListView('staff-invoice-receipts-pending');
  const [items, setItems] = useState<Receipt[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>(
    'loading'
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialSelection?.receiptId ?? null);
  const [selectedSource, setSelectedSource] = useState<'pending' | 'history'>(
    initialSelection?.state === 'Confirmed' || initialSelection?.state === 'Rejected'
      ? 'history'
      : 'pending'
  );
  const [localHistoryOpen, setLocalHistoryOpen] = useState(
    initialSelection?.state === 'Confirmed' || initialSelection?.state === 'Rejected'
  );
  const historyOpen = historyQuery?.open ?? localHistoryOpen;
  const setHistoryOpen = (value: boolean) =>
    historyQuery ? historyQuery.setOpen(value) : setLocalHistoryOpen(value);
  const [detail, setDetail] = useState<Receipt | null>(null);
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [allocationError, setAllocationError] = useState(false);
  const rejection = useReceiptRejectionForm('invoice');
  const [reason, setReason] = rejection.field('reason');
  const rejectionBusy = rejection.form.formState.isSubmitting;
  const [action, setAction] = useState<TeamAction | null>(null);
  const [financialReview, setFinancialReview] = useState<BankReceiptConfirmationReview | null>(
    null
  );
  const [reviewState, setReviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  actionRef.current = action;

  useLayoutEffect(() => {
    if (queueScopeRef.current === queueParams) return;
    queueScopeRef.current = queueParams;
    setItems([]);
    setNextCursor(null);
    setListState('loading');
    if (selectedSource === 'pending') {
      reviewGeneration.current++;
      selectedIdRef.current = null;
      setSelectedId(null);
      setDetail(null);
      setAllocation(null);
      rejection.form.reset({ reason: '' });
      actionRef.current = null;
      setAction(null);
      setFinancialReview(null);
      setReviewState('idle');
    }
  }, [queueParams]);
  useLayoutEffect(() => {
    reviewGeneration.current++;
    actionRef.current = null;
    setAction(null);
    setFinancialReview(null);
    setReviewState('idle');
  }, [selectedId, selectedSource, revision]);
  useEffect(() => {
    if (selectedId) detailRef.current?.scrollIntoView?.({ block: 'start' });
  }, [selectedId, selectedSource]);

  useEffect(() => {
    const controller = new AbortController();
    setListState('loading');
    void getJson<{ items: Receipt[]; nextCursor?: FinanceCursor | null }>(
      `${base}${queueParams}`,
      controller.signal
    )
      .then((value) => {
        if (!controller.signal.aborted && queueScopeRef.current === queueParams) {
          setItems(value.items);
          setNextCursor(value.nextCursor ?? null);
          setListState('ready');
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted && queueScopeRef.current === queueParams) {
          const forbidden =
            error instanceof Error && (error.message === '403' || error.message === '401');
          if (forbidden) {
            reviewGeneration.current++;
            selectedIdRef.current = null;
            actionRef.current = null;
            setItems([]);
            setNextCursor(null);
            setSelectedId(null);
            setDetail(null);
            setAllocation(null);
            rejection.form.reset({ reason: '' });
            actionRef.current = null;
            setAction(null);
            setFinancialReview(null);
          }
          setListState(forbidden ? 'forbidden' : 'error');
        }
      });
    return () => controller.abort();
  }, [revision, listRevision, queueParams]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setAllocation(null);
      setReviewState('idle');
      return;
    }
    const controller = new AbortController();
    const path = `${base}/${encodeURIComponent(selectedId)}`;
    setDetail(null);
    setAllocation(null);
    setDetailState('loading');
    setAllocationError(false);
    setReviewState('idle');
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

  async function review(kind: 'confirm' | 'reject', rejectionReason = reason.trim()) {
    if (
      !detail ||
      actionRef.current ||
      (kind === 'confirm' && rejection.form.isSubmissionPending())
    )
      return;
    if (
      kind === 'confirm' &&
      (!detail.canConfirm || detail.dualApprovalPending || !allocation || !detail.attachmentUrl)
    )
      return;
    const reasonText = rejectionReason;
    if (kind === 'reject' && (!detail.canReject || !reasonText)) return;
    const generation = reviewGeneration.current;
    let confirmation: BankReceiptConfirmationReview | null = null;
    if (kind === 'confirm') {
      setReviewState('loading');
      try {
        const response = await fetch(
          `${base}/${encodeURIComponent(detail.receiptId)}/confirm/review`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: '{}',
          }
        );
        if (!response.ok) throw new Error(String(response.status));
        const { parseBankReceiptConfirmationReview } = await import('@barghsa/shared/finance');
        confirmation = parseBankReceiptConfirmationReview(await response.json());
        if (generation !== reviewGeneration.current || selectedIdRef.current !== detail.receiptId)
          return;
        if (
          !confirmation ||
          confirmation.scope.action !== 'invoice.bank-receipt-confirmation' ||
          confirmation.scope.resourceId !== detail.receiptId ||
          confirmation.scope.profileId !== detail.profileId ||
          confirmation.data.receipt.amount !== detail.amount ||
          confirmation.data.invoice?.invoice.id !== detail.invoiceId
        )
          throw new Error('Invalid invoice receipt review');
        setFinancialReview(confirmation);
        setReviewState('idle');
      } catch {
        if (generation !== reviewGeneration.current) return;
        setFinancialReview(null);
        setReviewState('error');
        return;
      }
    }
    const proposal: TeamAction = {
      title: word(kind),
      description: kind === 'confirm' ? word('confirmNotice') : word('rejectNotice'),
      path: `${base}/${encodeURIComponent(detail.receiptId)}/${kind}`,
      method: 'POST',
      ...(kind === 'reject'
        ? { body: { reason: reasonText } }
        : { body: { expectedReviewHash: confirmation!.hash } }),
      conflictMessage: word('conflict'),
      forbiddenMessage: word('forbidden'),
    };
    actionRef.current = proposal;
    setAction(proposal);
  }

  const canRejectNow = useRef(false);
  canRejectNow.current = Boolean(
    detail?.canReject &&
    detailState === 'ready' &&
    listState === 'ready' &&
    reviewState !== 'loading' &&
    !action
  );
  function rejectReceipt(event: FormEvent) {
    event.preventDefault();
    if (!canRejectNow.current || !detail) return;
    const generation = reviewGeneration.current;
    const receiptId = detail.receiptId;
    void rejection.form.handleSubmit(async (values) => {
      if (
        !canRejectNow.current ||
        generation !== reviewGeneration.current ||
        selectedIdRef.current !== receiptId
      )
        return;
      await review('reject', values.reason.trim());
    })(event);
  }

  return (
    <section className="space-y-4 rounded-xl border bg-card p-5" aria-label={word('title')}>
      {time.notice}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{word('title')}</h2>
          <p className="text-sm text-muted-foreground">{word('description')}</p>
        </div>
      </div>
      <ListPage>
        <ListPage.Toolbar
          filters={<ReceiptQueueControls binding={queueBinding} />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <ListViewToggle
                value={view}
                onChange={setView}
                labels={{
                  group: appText('historyView.group', locale),
                  table: appText('historyView.table', locale),
                  card: appText('historyView.card', locale),
                }}
              />
              <Button variant="outline" onClick={refresh} disabled={listState === 'loading'}>
                {word('refresh')}
              </Button>
            </div>
          }
        />
        <ListPage.Content
          loading={listState === 'loading'}
          error={listState === 'error' || listState === 'forbidden'}
          empty={items.length === 0}
          retainContent={items.length > 0 && listState !== 'forbidden'}
          loadingView={<PageLoading label={word('loading')} />}
          errorView={
            listState === 'forbidden' ? (
              <p role="alert">{word('forbidden')}</p>
            ) : (
              <div className="space-y-2">
                <p role="alert">{word('loadError')}</p>
                <Button variant="outline" onClick={() => setListRevision((value) => value + 1)}>
                  {appText('historyPagination.retry', locale)}
                </Button>
              </div>
            )
          }
          emptyView={<p>{word('empty')}</p>}
        >
          {items.length ? (
            <StaffInvoiceReceiptList
              items={items}
              view={view}
              caption={word('title')}
              onOpen={(receiptId) => {
                rejection.form.reset({ reason: '' });
                setSelectedSource('pending');
                setSelectedId(receiptId);
              }}
            />
          ) : null}
        </ListPage.Content>
        {listState !== 'forbidden' && (
          <ReceiptQueuePagination
            binding={queueBinding}
            nextCursor={listState === 'error' ? null : nextCursor}
            loading={listState === 'loading'}
          />
        )}
      </ListPage>
      <Button
        variant="outline"
        aria-expanded={historyOpen}
        onClick={() => setHistoryOpen(!historyOpen)}
      >
        {word('historyTitle')}
      </Button>
      {historyOpen ? (
        <InvoiceBankReceiptHistory
          {...(historyQuery ? { binding: historyQuery.query } : {})}
          revision={revision}
          onOpen={(receiptId) => {
            rejection.form.reset({ reason: '' });
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
                    <ReceiptDepositDate value={detail.paymentDate} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('reference')}</dt>
                  <dd className="break-all">
                    <bdi>{detail.payerReference}</bdi>
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{word('bankName')}</dt>
                  <dd className="break-words">{detail.bankName ?? '—'}</dd>
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
                <StaffReceiptAttachmentPreview
                  key={detail.receiptId}
                  url={detail.attachmentUrl}
                  attachmentKey={detail.attachmentKey}
                  label={word('attachment')}
                  openLabel={word('attachment')}
                />
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
              {detail.statusHistory?.length ? (
                <section aria-label={word('reviewTimeline')} className="space-y-2 text-sm">
                  <h4 className="font-medium">{word('reviewTimeline')}</h4>
                  <ReceiptStatusTimeline
                    history={detail.statusHistory}
                    label={word('reviewTimeline')}
                    locale={locale}
                    formatTimestamp={time.format}
                  />
                </section>
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
                    onClick={() => void review('confirm')}
                    disabled={
                      !allocation ||
                      !detail.attachmentUrl ||
                      reviewState === 'loading' ||
                      rejectionBusy ||
                      !!action
                    }
                  >
                    {word('confirm')}
                  </Button>
                ) : null}
                {detail.canReject ? (
                  <form onSubmit={rejectReceipt} noValidate className="flex min-w-0 flex-col gap-2">
                    <label htmlFor="invoice-receipt-reason">{word('reason')}</label>
                    <textarea
                      {...rejection.bind('reason')}
                      id="invoice-receipt-reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      disabled={rejectionBusy || !!action}
                      required
                      aria-required="true"
                      aria-describedby={
                        rejection.errors.reason
                          ? `${rejection.errorId('reason')} invoice-receipt-reason-hint`
                          : 'invoice-receipt-reason-hint'
                      }
                      maxLength={BANK_RECEIPT_REJECT_REASON_MAX_LENGTH}
                      className="min-h-20 rounded-md border bg-background p-2"
                    />
                    <p id="invoice-receipt-reason-hint" className="text-xs text-muted-foreground">
                      {word('reasonHint')}
                    </p>
                    {rejection.errors.reason && (
                      <p
                        id={rejection.errorId('reason')}
                        role="alert"
                        className="text-sm text-destructive"
                      >
                        {rejection.errors.reason.message}
                      </p>
                    )}
                    <Button
                      type="submit"
                      variant="outline"
                      disabled={!canRejectNow.current || rejectionBusy}
                      aria-busy={rejectionBusy || undefined}
                    >
                      {rejectionBusy && (
                        <span
                          aria-hidden="true"
                          className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
                        />
                      )}
                      {word('reject')}
                    </Button>
                  </form>
                ) : null}
              </div>
              {reviewState === 'loading' ? <p role="status">{word('reviewLoading')}</p> : null}
              {reviewState === 'error' ? <p role="alert">{word('reviewError')}</p> : null}
            </>
          ) : null}
        </section>
      ) : null}
      {action ? (
        <TeamActionDialog
          action={action}
          summary={
            financialReview && action.path.endsWith('/confirm') ? (
              <BankReceiptFinancialReview
                review={financialReview}
                formatDate={time.format}
                formatPaymentDate={(value) => value ?? '—'}
              />
            ) : null
          }
          onValidationError={(fields) =>
            actionRef.current === action &&
            action.path.endsWith('/reject') &&
            rejection.applyServerErrors(fields)
          }
          onDenied={() => {
            if (actionRef.current !== action) return;
            reviewGeneration.current++;
            selectedIdRef.current = null;
            actionRef.current = null;
            setAction(null);
            setSelectedId(null);
            setDetail(null);
            setAllocation(null);
            setFinancialReview(null);
            setItems([]);
            setNextCursor(null);
            rejection.form.reset({ reason: '' });
            setListState('forbidden');
          }}
          onClose={() => {
            if (actionRef.current !== action) return;
            actionRef.current = null;
            setAction(null);
            setFinancialReview(null);
          }}
          onSuccess={async () => {
            if (actionRef.current !== action) return;
            actionRef.current = null;
            setAction(null);
            setFinancialReview(null);
            rejection.form.reset({ reason: '' });
            refresh();
          }}
        />
      ) : null}
    </section>
  );
}
