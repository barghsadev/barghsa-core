import { RecordListSkeleton } from './RecordListSkeleton.js';
import { RecordDetailSkeleton } from './RecordSkeleton.js';
import { useOwnedInvoiceReview } from '../hooks/useOwnedInvoiceReview.js';
import { Link } from '@tanstack/react-router';
import type { InvoiceReceiptDecision } from '../lib/invoice-receipt-decision.js';
import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
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
  LoadingStatus,
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  Label,
  ListPage,
  ListRefreshButton,
  ListViewToggle,
  PageLoading,
  StatusBadge,
  Textarea,
} from '@barghsa/ui';
import { tWorkspace as adminText } from '@barghsa/i18n/workspace-admin';
import { receiptEditorMessages } from '@barghsa/i18n/receipt-editor';
import { t as appText } from '@barghsa/i18n/workspace';
import { confirmationText } from '@barghsa/i18n/confirmation';
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
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
} from './RecordEditorLayout.js';

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
type ReceiptAction = TeamAction & {
  kind: 'confirm' | 'reject';
  target: Pick<Receipt, 'receiptId' | 'invoiceId' | 'profileId' | 'amount'>;
  reason?: string;
};

function matchesReceiptDecision(value: unknown, action: ReceiptAction) {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Partial<Receipt>;
  if (
    receipt.receiptId !== action.target.receiptId ||
    receipt.invoiceId !== action.target.invoiceId ||
    receipt.profileId !== action.target.profileId ||
    receipt.amount !== action.target.amount
  )
    return false;
  return action.kind === 'reject'
    ? receipt.state === 'Rejected' && receipt.rejectionReason === action.reason
    : receipt.state === 'Confirmed' ||
        (receipt.state === 'UnderReview' && receipt.dualApprovalPending === true);
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

async function getJson<T>(
  url: string,
  signal: AbortSignal,
  readStaff: ReturnType<typeof useOwnedStaffServiceRead>
): Promise<T> {
  const response = await readStaff(
    'invoices',
    url.split('?')[0] === base ? 'list' : 'detail',
    url,
    signal
  );
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

export interface ReceiptHistoryQuery {
  query: import('../hooks/useListQuery.js').ListQueryBinding;
  open: boolean;
  setOpen: (open: boolean) => void;
}
export function InvoiceBankReceiptQueue(
  props: Parameters<typeof OwnedInvoiceBankReceiptQueue>[0] = {}
) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return (
    <OwnedInvoiceBankReceiptQueue
      key={JSON.stringify([actor, revision, props.recordId])}
      {...props}
    />
  );
}
function OwnedInvoiceBankReceiptQueue({
  initialSelection,
  historyQuery,
  pendingQuery,
  recordId,
  recordDecision,
  recordSearch,
  onOpenRecord,
  onLocked,
}: {
  initialSelection?: { receiptId: string; state: string } | null;
  historyQuery?: ReceiptHistoryQuery;
  pendingQuery?: ListQueryBinding;
  recordId?: string;
  recordDecision?: InvoiceReceiptDecision | undefined;
  recordSearch?: Record<string, unknown>;
  onOpenRecord?: (receiptId: string) => void;
  onLocked?: (locked: boolean) => void;
} = {}) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(actor, profileRevision);
  const readReview = useOwnedInvoiceReview(actor, profileRevision);
  const queueBinding = useReceiptQueueQuery(pendingQuery);
  const queueParams = receiptQueueParams(queueBinding);
  const queueScopeRef = useRef(queueParams);
  const [nextCursor, setNextCursor] = useState<FinanceCursor | null>(null);
  const actionRef = useRef<ReceiptAction | null>(null);
  const reviewGeneration = useRef(0);
  const reviewController = useRef<AbortController | null>(null);
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => adminText(`admin.invoiceReceipts.${key}`, locale);
  const editorText = receiptEditorMessages[locale];
  const { view, setView } = useListView('staff-invoice-receipts-pending');
  const [items, setItems] = useState<Receipt[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>(
    'loading'
  );
  const [selectedId, setSelectedId] = useState<string | null>(
    recordId ?? initialSelection?.receiptId ?? null
  );
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
  const [detailState, setDetailState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>(
    'loading'
  );
  const [allocationError, setAllocationError] = useState(false);
  const rejection = useReceiptRejectionForm('invoice');
  const [reason, setReason] = rejection.field('reason');
  const rejectionBusy = rejection.form.formState.isSubmitting;
  const [action, setAction] = useState<ReceiptAction | null>(null);
  const [financialReview, setFinancialReview] = useState<BankReceiptConfirmationReview | null>(
    null
  );
  const [reviewState, setReviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const detailRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
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
    reviewController.current?.abort();
    reviewController.current = null;
    reviewGeneration.current++;
    actionRef.current = null;
    setAction(null);
    setFinancialReview(null);
    setReviewState('idle');
  }, [selectedId, selectedSource, revision, detailRevision]);
  useEffect(() => {
    if (recordId) headingRef.current?.focus({ preventScroll: true });
    else if (selectedId) detailRef.current?.scrollIntoView?.({ block: 'start' });
  }, [selectedId, selectedSource, recordId, recordDecision]);
  const commandLocked = Boolean(
    action || (recordDecision && (rejectionBusy || reviewState === 'loading'))
  );
  useEffect(() => {
    onLocked?.(commandLocked);
    return () => onLocked?.(false);
  }, [commandLocked, onLocked]);

  useEffect(() => {
    if (recordId) return;
    const controller = new AbortController();
    setListState('loading');
    void getJson<{ items: Receipt[]; nextCursor?: FinanceCursor | null }>(
      `${base}${queueParams}`,
      controller.signal,
      readStaff
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
  }, [revision, listRevision, queueParams, recordId, readStaff]);

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
    const receiptRead = getJson<Receipt>(path, controller.signal, readStaff).then((receipt) => {
      if (receipt.receiptId !== selectedId) throw Error('Receipt does not match requested ID');
      if (!controller.signal.aborted) {
        setDetail(receipt);
        setDetailState('ready');
      }
      return receipt;
    });
    const readAllocation = () =>
      getJson<Allocation>(`${path}/allocation`, controller.signal, readStaff);
    const allocationRead = recordId
      ? receiptRead.then(
          (receipt) =>
            ['Confirmed', 'Rejected'].includes(receipt.state) ? null : readAllocation(),
          () => null
        )
      : selectedSource === 'pending'
        ? readAllocation()
        : Promise.resolve(null);
    void Promise.allSettled([receiptRead, allocationRead]).then(([receipt, preview]) => {
      if (controller.signal.aborted) return;
      if (receipt.status === 'fulfilled') {
        if (preview.status === 'fulfilled') {
          if (
            preview.value &&
            (preview.value.receiptId !== receipt.value.receiptId ||
              preview.value.invoiceId !== receipt.value.invoiceId ||
              preview.value.receiptAmount !== receipt.value.amount)
          )
            setAllocationError(true);
          else setAllocation(preview.value);
        } else setAllocationError(true);
      } else {
        const denied =
          receipt.reason instanceof Error && ['401', '403'].includes(receipt.reason.message);
        if (denied) rejection.form.reset({ reason: '' });
        setDetailState(denied ? 'forbidden' : 'error');
      }
    });
    return () => controller.abort();
  }, [selectedId, selectedSource, revision, detailRevision, recordId, readStaff]);

  function refresh() {
    setRevision((value) => value + 1);
  }

  async function review(kind: 'confirm' | 'reject', rejectionReason = reason.trim()) {
    if (
      !detail ||
      actionRef.current ||
      (recordDecision && recordDecision !== kind) ||
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
      reviewController.current?.abort();
      const controller = new AbortController();
      reviewController.current = controller;
      setReviewState('loading');
      try {
        const response = await readReview(
          `${base}/${encodeURIComponent(detail.receiptId)}/confirm/review`,
          {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            signal: controller.signal,
            body: '{}',
          }
        );
        if (!response.ok) throw new Error(String(response.status));
        const { parseBankReceiptConfirmationReview } = await import('@barghsa/shared/finance');
        confirmation = parseBankReceiptConfirmationReview(await response.json());
        if (
          controller.signal.aborted ||
          generation !== reviewGeneration.current ||
          selectedIdRef.current !== detail.receiptId
        )
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
        if (controller.signal.aborted || generation !== reviewGeneration.current) return;
        setFinancialReview(null);
        setReviewState('error');
        return;
      }
    }
    const proposal: ReceiptAction = {
      kind,
      target: {
        receiptId: detail.receiptId,
        invoiceId: detail.invoiceId,
        profileId: detail.profileId,
        amount: detail.amount,
      },
      ...(kind === 'reject' ? { reason: reasonText } : {}),
      risk: kind === 'confirm' ? 'financial' : 'both',
      title: word(kind),
      description: kind === 'confirm' ? word('confirmNotice') : word('rejectNotice'),
      path: `${base}/${encodeURIComponent(detail.receiptId)}/${kind}`,
      method: 'POST',
      responseDeadline: true,
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
    (recordId || listState === 'ready') &&
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

  const historical = recordId
    ? ['Confirmed', 'Rejected'].includes(detail?.state ?? '')
    : selectedSource === 'history';
  const DetailHeading = recordId ? 'h1' : 'h3';
  const TimelineHeading = recordId ? 'h2' : 'h4';
  const heading =
    recordDecision === 'confirm'
      ? editorText.confirmTitle
      : recordDecision === 'reject'
        ? editorText.rejectTitle
        : word('detail');
  const canConfirm = Boolean(detail?.canConfirm && !detail.dualApprovalPending);
  const allocationPreview = allocation && (
    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:p-4">
      <div className="min-w-0">
        <dt className="text-muted-foreground">{word('invoiceAllocation')}</dt>
        <dd className="wrap-anywhere font-semibold">
          {numbers.money(allocation.invoiceAllocation)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{word('walletCredit')}</dt>
        <dd className="wrap-anywhere font-semibold">
          {numbers.money(allocation.walletCreditAmount)}
        </dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{word('remaining')}</dt>
        <dd className="wrap-anywhere">{numbers.money(allocation.remaining)}</dd>
      </div>
      <div className="min-w-0">
        <dt className="text-muted-foreground">{word('invoiceState')}</dt>
        <dd>{appText(`invoices.state.${allocation.invoiceState}`, locale)}</dd>
      </div>
    </dl>
  );
  const confirmButton = (attachmentUrl: string | null) => (
    <Button
      onClick={() => void review('confirm')}
      disabled={
        !allocation || !attachmentUrl || reviewState === 'loading' || rejectionBusy || !!action
      }
    >
      {word('confirm')}
    </Button>
  );
  const attachment = detail?.attachmentUrl && (
    <StaffReceiptAttachmentPreview
      key={detail.receiptId}
      url={detail.attachmentUrl}
      previewUrl={`${base}/${encodeURIComponent(detail.receiptId)}/attachment-preview`}
      label={word('attachment')}
      openLabel={word('attachment')}
    />
  );
  return (
    <section
      id={recordId ? 'invoice-receipt-panel' : undefined}
      className={recordDecision ? 'min-w-0 space-y-4' : 'space-y-4 rounded-xl border bg-card p-5'}
      aria-label={word('title')}
    >
      {time.notice}
      {!recordId && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{word('title')}</h2>
              <p className="text-sm text-muted-foreground">{word('description')}</p>
            </div>
          </div>
          <ListPage>
            <ReceiptQueueControls
              binding={queueBinding}
              actions={
                <ListViewToggle
                  value={view}
                  onChange={setView}
                  labels={{
                    group: appText('historyView.group', locale),
                    table: appText('historyView.table', locale),
                    card: appText('historyView.card', locale),
                  }}
                />
              }
              refresh={
                <ListRefreshButton
                  label={word('refresh')}
                  onClick={refresh}
                  refreshing={listState === 'loading'}
                />
              }
            />
            <ListPage.Content
              loading={listState === 'loading'}
              error={listState === 'error' || listState === 'forbidden'}
              empty={items.length === 0}
              retainContent={items.length > 0 && listState !== 'forbidden'}
              loadingView={
                <RecordListSkeleton
                  label={word('loading')}
                  view={view}
                  headings={[
                    word('receipt'),
                    word('historyState'),
                    word('amount'),
                    appText('recordTable.activity', locale),
                    word('open'),
                  ]}
                />
              }
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
                    if (onOpenRecord) return onOpenRecord(receiptId);
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
                if (onOpenRecord) return onOpenRecord(receiptId);
                rejection.form.reset({ reason: '' });
                setSelectedSource('history');
                setSelectedId(receiptId);
              }}
            />
          ) : null}
        </>
      )}
      {selectedId ? (
        <section
          ref={detailRef}
          className={recordDecision ? 'min-w-0 space-y-4' : 'space-y-4 rounded-lg border p-4'}
          aria-label={word('detail')}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <DetailHeading
                ref={recordId ? headingRef : undefined}
                tabIndex={recordId ? -1 : undefined}
                className={recordId ? 'text-2xl font-semibold' : 'font-semibold'}
              >
                {heading}
              </DetailHeading>
              {detail ? (
                <StatusBadge label={appText(`invoices.activity.state.${detail.state}`, locale)} />
              ) : null}
            </div>
            {recordId && detailState === 'ready' ? (
              <ListRefreshButton
                label={recordDecision ? editorText.refreshReceipt : word('refresh')}
                onClick={refresh}
                refreshing={false}
                disabled={commandLocked}
              />
            ) : null}
            {!recordId && (
              <Button variant="ghost" onClick={() => setSelectedId(null)}>
                {word('close')}
              </Button>
            )}
          </div>
          {detailState === 'loading' &&
            (recordDecision ? (
              <PageLoading label={word('loading')} />
            ) : (
              <RecordDetailSkeleton label={word('loading')} layout="payment" />
            ))}
          {detailState === 'forbidden' ? <p role="alert">{word('forbidden')}</p> : null}
          {detailState === 'error' || (allocationError && recordDecision !== 'reject') ? (
            <div className="space-y-2">
              <Alert variant="destructive">
                <AlertDescription>
                  {word(detailState === 'error' ? 'detailError' : 'allocationError')}
                </AlertDescription>
              </Alert>
              <Button variant="outline" onClick={() => setDetailRevision((value) => value + 1)}>
                {appText('historyPagination.retry', locale)}
              </Button>
            </div>
          ) : null}
          {detail ? (
            <>
              {recordDecision ? (
                <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:p-4">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{word('amount')}</dt>
                    <dd className="wrap-anywhere font-semibold">{numbers.money(detail.amount)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{word('invoice')}</dt>
                    <dd>
                      <bdi title={detail.invoiceId} className="font-mono">
                        …{detail.invoiceId.slice(-12)}
                      </bdi>
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{word('reference')}</dt>
                    <dd className="wrap-anywhere">
                      <bdi className="font-mono">{detail.payerReference}</bdi>
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{word('paymentDate')}</dt>
                    <dd>
                      <ReceiptDepositDate
                        value={detail.paymentDate}
                        locale={locale}
                        calendar="gregory"
                      />
                    </dd>
                  </div>
                </dl>
              ) : (
                <>
                  <dl className="grid grid-cols-2 gap-3 rounded-xl bg-muted/40 p-4 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-muted-foreground">{word('amount')}</dt>
                      <dd className="mt-1 text-lg font-semibold">
                        <bdi>{numbers.money(detail.amount)}</bdi>
                      </dd>
                    </div>
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
                      <dt className="text-muted-foreground">{word('paymentDate')}</dt>
                      <dd>
                        <ReceiptDepositDate
                          value={detail.paymentDate}
                          locale={locale}
                          calendar="gregory"
                        />
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
                  {recordId && (canConfirm || detail.canReject) && (
                    <div className="flex flex-wrap gap-2">
                      {canConfirm && (
                        <Link
                          to="/admin/invoices/receipts/$receiptId/{-$decision}"
                          params={{ receiptId: recordId, decision: 'confirm' }}
                          search={recordSearch ?? {}}
                          data-testid="invoice-receipt-open-confirm"
                          className={buttonVariants()}
                        >
                          {editorText.confirmTitle}
                        </Link>
                      )}
                      {detail.canReject && (
                        <Link
                          to="/admin/invoices/receipts/$receiptId/{-$decision}"
                          params={{ receiptId: recordId, decision: 'reject' }}
                          search={recordSearch ?? {}}
                          data-testid="invoice-receipt-open-reject"
                          className={buttonVariants({ variant: 'outline' })}
                        >
                          {editorText.rejectTitle}
                        </Link>
                      )}
                    </div>
                  )}
                  {detail.customerNote ? <p className="text-sm">{detail.customerNote}</p> : null}
                  {attachment || (
                    <p role="alert" className="text-sm">
                      {word(historical ? 'historyAttachmentUnavailable' : 'attachmentUnavailable')}
                    </p>
                  )}
                  {detail.rejectionReason ? (
                    <p className="text-sm">
                      {word('historyRejectionReason')}: {detail.rejectionReason}
                    </p>
                  ) : null}
                  {detail.statusHistory?.length ? (
                    <section aria-label={word('reviewTimeline')} className="space-y-2 text-sm">
                      <TimelineHeading className="font-medium">
                        {word('reviewTimeline')}
                      </TimelineHeading>
                      <ReceiptStatusTimeline
                        history={detail.statusHistory}
                        label={word('reviewTimeline')}
                        locale={locale}
                        formatTimestamp={time.format}
                      />
                    </section>
                  ) : null}
                  {allocationPreview}
                  {historical &&
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
                </>
              )}
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
              {detail.requiresDualApproval &&
              !detail.dualApprovalPending &&
              recordDecision !== 'reject' ? (
                <p className="text-sm text-muted-foreground">{word('approvalRequired')}</p>
              ) : null}
              {recordDecision && attachment && (
                <details className="rounded-lg border bg-card">
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
                    {word('attachment')}
                  </summary>
                  <div className="px-4 pb-3">{attachment}</div>
                </details>
              )}
              {canConfirm && recordDecision === 'confirm' && (
                <div className={recordEditorSurface}>
                  <RecordEditorSection
                    title={editorText.invoiceReceiptAllocation}
                    description={editorText.invoiceReceiptConfirmHint}
                  >
                    {allocationPreview}
                    {!attachment && (
                      <p role="alert" className="text-sm">
                        {word('attachmentUnavailable')}
                      </p>
                    )}
                  </RecordEditorSection>
                  <RecordEditorActions>{confirmButton(detail.attachmentUrl)}</RecordEditorActions>
                </div>
              )}
              {!recordId && canConfirm && (
                <div className="flex justify-end">{confirmButton(detail.attachmentUrl)}</div>
              )}
              {detail.canReject && (!recordId || recordDecision === 'reject') ? (
                <form onSubmit={rejectReceipt} noValidate className={recordEditorSurface}>
                  <RecordEditorSection title={receiptEditorMessages[locale].rejectionDetails}>
                    <div className={recordEditorField}>
                      <Label htmlFor="invoice-receipt-reason">{word('reason')}</Label>
                      <Textarea
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
                        rows={2}
                        placeholder={receiptEditorMessages[locale].rejectionExample}
                        className="min-h-14 max-h-48"
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
                    </div>
                  </RecordEditorSection>
                  <RecordEditorActions>
                    <Button
                      type="submit"
                      variant="outline"
                      className="border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive"
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
                  </RecordEditorActions>
                </form>
              ) : null}
              {((recordDecision === 'confirm' && !canConfirm) ||
                (recordDecision === 'reject' && !detail.canReject)) && (
                <p role="status" className="rounded-lg border bg-card px-4 py-3 text-sm">
                  {editorText.actionUnavailable}
                </p>
              )}
              {reviewState === 'loading' ? (
                <LoadingStatus>{word('reviewLoading')}</LoadingStatus>
              ) : null}
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
            if (!recordId) setSelectedId(null);
            else setDetailState('forbidden');
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
          onUnconfirmed={() => {
            if (actionRef.current !== action) return;
            actionRef.current = null;
            setAction(null);
            setDetail(null);
            setAllocation(null);
            refresh();
          }}
          onSuccess={async (result) => {
            if (actionRef.current !== action) return;
            if (!matchesReceiptDecision(result, action))
              throw new Error('Receipt decision mismatch');
            actionRef.current = null;
            setAction(null);
            setFinancialReview(null);
            rejection.form.reset({ reason: '' });
            refresh();
            return confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </section>
  );
}
