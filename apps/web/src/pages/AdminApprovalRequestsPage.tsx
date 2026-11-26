import { CommandFeedback } from '../components/CommandFeedback.js';
import { useStaffQueryRead } from '../hooks/useStaffQueryRead.js';
import { contractText } from '@barghsa/i18n/contracts';
import { confirmationText } from '@barghsa/i18n/confirmation';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { tInvoiceCorrections } from '@barghsa/i18n/invoice-corrections';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { formatRelativeTime } from '../lib/relative-time.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { RecordListSkeleton } from '../components/RecordListSkeleton.js';
import {
  Button,
  FinancialReviewSummary,
  Label,
  ListPage,
  ListRefreshButton,
  StatusBadge,
  buttonVariants,
} from '@barghsa/ui';
import {
  ApprovalDecisionForm,
  type ApprovalDecisionDraft,
} from '../components/ApprovalDecisionForm.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import { Link, useBlocker } from '@tanstack/react-router';
import { approvalRequestRoute } from '../lib/decision-queue-query.js';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { existingDraftReturns } from '../lib/electricity-existing-returns.js';
import { QueueEmptyState } from '../components/QueueEmptyState.js';

type Status = 'pending' | 'approved' | 'rejected';
interface Request {
  id: string;
  actionType:
    'refund' | 'manual_adjustment' | 'bank_payment_confirmation' | 'contract_cancellation';
  amountIrR: string;
  initiatorId: string;
  initiatorUsername: string | null;
  reason: string;
  status: Status;
  reviewerId: string | null;
  reviewerUsername: string | null;
  reviewReason: string | null;
  details: Record<string, unknown> | null;
  createdAt?: string;
  reviewedAt?: string | null;
}
function approvalAmount(request: Request) {
  const amount = request.details?.adjustmentAmount;
  if (
    request.actionType === 'manual_adjustment' &&
    typeof amount === 'string' &&
    /^-?\d{1,19}$/.test(amount) &&
    (BigInt(amount) < 0n ? -BigInt(amount) : BigInt(amount)) === BigInt(request.amountIrR)
  )
    return amount;
  return request.amountIrR;
}
function adoptedReturns(request: Request) {
  const review = request.details?.financialReview;
  if (
    request.details?.entityType !== 'electricity_order_termination' ||
    !review ||
    typeof review !== 'object' ||
    !('data' in review) ||
    !review.data ||
    typeof review.data !== 'object'
  )
    return [];
  return existingDraftReturns(
    'existingReturns' in review.data ? review.data.existingReturns : undefined
  );
}
const PAGE_SIZE = 25;
const approvalStatuses = ['pending', 'approved', 'rejected'] as const;

export function AdminApprovalRequestsView({
  requestId,
  decision,
  queries,
  recordSearch,
}: {
  requestId?: string;
  decision?: 'reject' | undefined;
  queries?: ListQueryBinding;
  recordSearch?: Record<string, unknown>;
}) {
  return (
    <ApprovalWorkspace
      key={requestId || `queue:${queries?.query.filters.status || 'pending'}`}
      decision={decision}
      {...(requestId ? { requestId } : {})}
      {...(queries ? { queries } : {})}
      {...(recordSearch ? { recordSearch } : {})}
    />
  );
}
export default AdminApprovalRequestsView;

function ApprovalNavigationGuard({ locked }: { locked: boolean }) {
  useBlocker({ shouldBlockFn: () => locked, enableBeforeUnload: () => locked });
  return null;
}

function ApprovalWorkspace({
  requestId,
  decision,
  queries,
  recordSearch,
}: {
  requestId?: string;
  decision?: 'reject' | undefined;
  queries?: ListQueryBinding;
  recordSearch?: Record<string, unknown>;
}) {
  const locale = useLocale();
  const read = useStaffQueryRead('operations');
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const renderDecision = Boolean(requestId || !recordSearch);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (requestId && recordSearch) heading.current?.focus({ preventScroll: true });
  }, [requestId, decision]);
  const [localStatus, setStatus] = useState<Status>('pending');
  const [localOffset, setOffset] = useState(0);
  const status = (queries?.query.filters.status || localStatus) as Status;
  const offset = queries ? (queries.query.page - 1) * PAGE_SIZE : localOffset;
  const [items, setItems] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [adjustmentDecision, setAdjustmentDecision] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [validating, setValidating] = useState<string | null>(null);
  const validationOwner = useRef<number | null>(null);
  const decisionDraft = useRef<ApprovalDecisionDraft | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [action, setAction] = useState<TeamAction | null>(null);
  const [review, setReview] = useState<Request | null>(null);
  const generation = useRef(0);
  const workGeneration = useRef(0);
  const commandGeneration = useRef(0);
  const lastOffset = useRef(offset);
  if (lastOffset.current !== offset) {
    lastOffset.current = offset;
    ++workGeneration.current;
  }
  useEffect(() => {
    clearDecision();
    setSaved(false);
  }, [offset]);
  const activeController = useRef<AbortController | null>(null);
  const accessDenied = useRef(false);
  const selected = useRef<Request | null>(null);
  const [denied, setDenied] = useState(false);
  const [acceptedScope, setAcceptedScope] = useState('');
  const scope = JSON.stringify([requestId, status]);
  const visibleItems = acceptedScope === scope ? items : [];
  const currentItems = useRef(visibleItems);
  currentItems.current = visibleItems;
  const available = useRef(false);
  available.current = !loading && !error && !denied && acceptedScope === scope;
  function clearDecision() {
    ++workGeneration.current;
    selected.current = null;
    decisionDraft.current = null;
    validationOwner.current = null;
    setValidating(null);
    setAction(null);
    setReview(null);
  }
  function changeStatus(next: string) {
    if (action || validating !== null) return;
    if (queries) {
      queries.setQuery({ filters: { status: next } });
      return;
    }
    clearDecision();
    setReasons({});
    setStatus(next as Status);
    setOffset(0);
    setSaved(false);
  }
  function denyAccess() {
    ++generation.current;
    activeController.current?.abort();
    accessDenied.current = true;
    setDenied(true);
    setLoading(false);
    setError(true);
    setItems([]);
    setReasons({});
    setSaved(false);
    setUnconfirmed(false);
    returnFocus.current = null;
    clearDecision();
  }
  const load = useCallback(async () => {
    activeController.current?.abort();
    const controller = new AbortController();
    activeController.current = controller;
    const current = ++generation.current;
    setLoading(true);
    setError(false);
    try {
      const data = await read(
        requestId
          ? `/api/admin/approval-requests/${encodeURIComponent(requestId)}`
          : `/api/admin/approval-requests?status=${status}&limit=${PAGE_SIZE + 1}&offset=${offset}`,
        requestId ? 'detail' : 'list',
        controller.signal,
        async (response) => {
          if ([401, 403].includes(response.status)) throw new Error('denied');
          if (!response.ok) throw new Error('Queue unavailable');
          return response.json() as Promise<unknown>;
        },
        current
      );
      if (requestId) {
        if (
          !data ||
          typeof data !== 'object' ||
          (data as Request).id !== requestId ||
          !['pending', 'approved', 'rejected'].includes((data as Request).status)
        )
          throw new Error('Invalid approval request');
      } else {
        if (!Array.isArray(data)) throw new Error('Invalid queue');
      }
      if (current !== generation.current || controller.signal.aborted) return;
      const rows = requestId ? [data as Request] : (data as Request[]);
      if (
        selected.current &&
        !rows.some((row) => JSON.stringify(row) === JSON.stringify(selected.current))
      )
        clearDecision();
      accessDenied.current = false;
      setDenied(false);
      setAcceptedScope(scope);
      setItems(rows);
    } catch (caught: unknown) {
      if (current !== generation.current || controller.signal.aborted) return;
      setError(true);
      if (caught instanceof Error && caught.message === 'denied') {
        denyAccess();
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, [status, offset, requestId, scope, read]);
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      activeController.current?.abort();
    };
  }, [load]);

  useEffect(
    () => () => {
      ++workGeneration.current;
    },
    []
  );
  async function validateReject(request: Request, run: (owner: number) => Promise<void>) {
    if (
      !available.current ||
      selected.current ||
      validationOwner.current !== null ||
      accessDenied.current
    )
      return;
    const owner = workGeneration.current;
    validationOwner.current = owner;
    setValidating(request.id);
    try {
      await run(owner);
    } finally {
      if (validationOwner.current === owner) {
        validationOwner.current = null;
        setValidating(null);
      }
    }
  }
  function decide(
    request: Request,
    decision: 'approve' | 'reject',
    draft: ApprovalDecisionDraft,
    reason = '',
    owner?: number
  ) {
    if (
      !available.current ||
      accessDenied.current ||
      selected.current ||
      request.status !== 'pending' ||
      (owner !== undefined && owner !== workGeneration.current) ||
      (decision === 'approve' && validationOwner.current !== null) ||
      !currentItems.current.some((row) => JSON.stringify(row) === JSON.stringify(request))
    )
      return;
    try {
      adoptedReturns(request);
    } catch {
      setError(true);
      return;
    }
    decisionDraft.current = draft;
    returnFocus.current = draft.focus;
    setSaved(false);
    setUnconfirmed(false);
    setAdjustmentDecision(
      request.actionType === 'manual_adjustment' && Boolean(request.details?.invoiceAdjustment)
    );
    ++workGeneration.current;
    commandGeneration.current = workGeneration.current;
    selected.current = request;
    setReview(request);
    setAction({
      risk: decision === 'reject' ? 'both' : 'financial',
      title: t(`admin.approvals.${decision}`, locale),
      description: t('admin.approvals.confirm', locale),
      path: `/api/admin/approval-requests/${encodeURIComponent(request.id)}/${decision}`,
      method: 'POST',
      ...(decision === 'reject' ? { body: { reason } } : {}),
      conflictMessage: t('admin.approvals.conflict', locale),
      forbiddenMessage: t('admin.approvals.forbidden', locale),
    });
  }

  const actionGeneration = commandGeneration.current;
  const actionLocked = !!action || validating !== null;
  const rejectionReason =
    action?.body &&
    typeof action.body === 'object' &&
    'reason' in action.body &&
    typeof action.body.reason === 'string'
      ? action.body.reason
      : undefined;
  return (
    <section
      aria-labelledby="approval-requests-title"
      className={
        decision ? 'mx-auto min-w-0 max-w-3xl space-y-4' : 'mx-auto min-w-0 max-w-4xl space-y-4'
      }
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {recordSearch && requestId && <ApprovalNavigationGuard locked={actionLocked} />}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          {requestId && decision ? (
            <Link
              to={approvalRequestRoute}
              params={{ requestId, decision: undefined }}
              search={recordSearch ?? {}}
              disabled={actionLocked}
              className="touch-action inline-flex items-center text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
            >
              {t('admin.approvals.backToRequest', locale)}
            </Link>
          ) : (
            requestId && (
              <Link
                to="/admin/approval-requests"
                search={recordSearch ?? {}}
                className="touch-action inline-flex items-center text-sm text-primary underline underline-offset-4"
              >
                {t('admin.approvals.backToQueue', locale)}
              </Link>
            )
          )}
          <h1
            ref={heading}
            tabIndex={requestId ? -1 : undefined}
            id="approval-requests-title"
            className="text-2xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!"
          >
            {t(
              decision
                ? 'admin.approvals.rejectRequest'
                : requestId
                  ? 'admin.approvals.decisionTitle'
                  : 'admin.approvals.title',
              locale
            )}
          </h1>
          {!requestId && (
            <p className="text-sm text-muted-foreground">
              {t('admin.approvals.description', locale)}
            </p>
          )}
        </div>
        {recordSearch && !requestId && (
          <Link
            to="/admin/approval-requests/thresholds/{-$view}"
            params={{ view: undefined }}
            search={recordSearch}
            className={buttonVariants({ variant: 'outline' })}
          >
            {t('admin.approvals.thresholdsLink', locale)}
          </Link>
        )}
        {requestId && (
          <ListRefreshButton
            label={t('admin.approvals.refresh', locale)}
            disabled={loading || actionLocked}
            onClick={() => void load()}
          />
        )}
      </header>
      <ListPage role="region" aria-label={t('admin.approvals.listTitle', locale)}>
        {!requestId && (
          <ListPage.Toolbar>
            <div className="flex flex-wrap items-center gap-3">
              <Label htmlFor="approval-status">{t('admin.approvals.status', locale)}</Label>
              <select
                id="approval-status"
                className="rounded border bg-card text-card-foreground p-2"
                value={status}
                disabled={!!action || validating !== null}
                onChange={(event) => changeStatus(event.target.value)}
              >
                {approvalStatuses.map((value) => (
                  <option key={value} value={value}>
                    {t(`admin.approvals.${value}`, locale)}
                  </option>
                ))}
              </select>
              <ListRefreshButton
                label={t('admin.approvals.refresh', locale)}
                disabled={loading || validating !== null}
                onClick={() => void load()}
              />
            </div>
          </ListPage.Toolbar>
        )}
        <CommandFeedback
          message={
            saved
              ? adjustmentDecision
                ? (tInvoiceCorrections('decisionSaved', locale) ?? null)
                : t('admin.approvals.saved', locale)
              : null
          }
        />
        {unconfirmed && <p role="alert">{confirmationText('unconfirmed', locale)}</p>}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!visibleItems.length}
          retainContent={!!visibleItems.length && !denied}
          loadingView={
            requestId ? (
              <RecordDetailSkeleton label={t('admin.approvals.loading', locale)} layout="payment" />
            ) : (
              <RecordListSkeleton
                label={t('admin.approvals.loading', locale)}
                view="card"
                headings={[]}
              />
            )
          }
          errorView={
            <div role="alert" className="space-y-2">
              <p>{t(denied ? 'admin.approvals.loadForbidden' : 'admin.approvals.error', locale)}</p>
              {!denied && (
                <Button type="button" variant="outline" onClick={() => void load()}>
                  {t('admin.approvals.retry', locale)}
                </Button>
              )}
            </div>
          }
          emptyView={
            !requestId && offset === 0 ? (
              <QueueEmptyState
                locale={locale}
                message={t('admin.approvals.empty', locale)}
                status={t(`admin.approvals.${status}`, locale)}
                alternatives={approvalStatuses
                  .filter((value) => value !== status)
                  .map((value) => ({
                    value,
                    label: t(`admin.approvals.${value}`, locale),
                    path: `/api/admin/approval-requests?status=${value}&limit=1&offset=0`,
                  }))}
                hasResults={(body, value) =>
                  Array.isArray(body) && body.some((row) => row?.status === value)
                }
                select={changeStatus}
              />
            ) : (
              <p>{t('admin.approvals.empty', locale)}</p>
            )
          }
        >
          <ul className="space-y-4">
            {visibleItems.slice(0, PAGE_SIZE).map((request) => {
              const metadata = (
                <dl className="grid min-w-0 grid-cols-2 gap-2.5 border-t pt-3 text-sm sm:grid-cols-3">
                  {[
                    [
                      t('admin.approvals.initiator', locale),
                      request.initiatorUsername ?? request.initiatorId,
                    ],
                    ...(request.createdAt
                      ? [
                          [
                            t('admin.approvals.createdAt', locale),
                            (requestId ? '' : formatRelativeTime(request.createdAt, locale)) ||
                              time.format(request.createdAt),
                          ],
                        ]
                      : []),
                    ...(request.reviewerId
                      ? [
                          [
                            t('admin.approvals.reviewer', locale),
                            request.reviewerUsername ?? request.reviewerId,
                          ],
                        ]
                      : []),
                    ...(renderDecision
                      ? [
                          [
                            t(
                              requestId
                                ? 'admin.approvals.linkedRequest'
                                : 'admin.approvals.requestId',
                              locale
                            ),
                            request.id,
                          ],
                          ...(request.reviewedAt
                            ? [
                                [
                                  t('admin.approvals.reviewedAt', locale),
                                  time.format(request.reviewedAt),
                                ],
                              ]
                            : []),
                          ...(['receiptId', 'invoiceId', 'walletId'] as const).flatMap((key) =>
                            typeof request.details?.[key] === 'string'
                              ? [
                                  [
                                    t(`admin.approvals.${key}`, locale),
                                    request.details[key] as string,
                                  ],
                                ]
                              : []
                          ),
                          ...(request.actionType === 'refund' &&
                          (request.details?.destination === 'wallet' ||
                            request.details?.destination === 'external_bank')
                            ? [
                                [
                                  t('admin.approvals.destination', locale),
                                  t(
                                    request.details.destination === 'wallet'
                                      ? 'admin.invoices.walletRefunds.title'
                                      : 'admin.invoices.externalRefunds.title',
                                    locale
                                  ),
                                ],
                              ]
                            : []),
                        ]
                      : []),
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {value}
                      </dd>
                    </div>
                  ))}
                  {renderDecision && request.reviewReason && (
                    <div className="col-span-full">
                      <dt className="text-xs text-muted-foreground">
                        {t('admin.approvals.reviewReason', locale)}
                      </dt>
                      <dd dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {request.reviewReason}
                      </dd>
                    </div>
                  )}
                </dl>
              );
              return (
                <li
                  key={request.id}
                  className="min-w-0 space-y-3 rounded-xl border bg-card p-4 text-card-foreground"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-semibold">
                      {request.details?.entityType === 'electricity_order_termination'
                        ? t(
                            'electricity.rawDraft.' +
                              (request.details.terminalAction === 'reject' ? 'reject' : 'cancel'),
                            locale
                          )
                        : request.actionType === 'contract_cancellation' &&
                            request.details?.terminalAction === 'reject'
                          ? contractText('rejectionTitle', locale)
                          : t(`admin.approvals.${request.actionType}`, locale)}
                    </h2>
                    <StatusBadge
                      state={request.status}
                      label={t(`admin.approvals.${request.status}`, locale)}
                    />
                  </div>
                  <div
                    className={
                      renderDecision
                        ? 'grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'
                        : undefined
                    }
                  >
                    <dl
                      className={
                        renderDecision
                          ? 'min-w-0 space-y-0.5 rounded-lg border bg-muted/30 px-3 py-2.5'
                          : 'min-w-0 space-y-0.5'
                      }
                    >
                      <dt className="text-xs text-muted-foreground">
                        {t('admin.approvals.amount', locale)}
                      </dt>
                      <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">
                        <bdi>{numbers.money(approvalAmount(request))}</bdi>
                      </dd>
                    </dl>
                    {renderDecision && (
                      <dl className="min-w-0 space-y-0.5 rounded-lg border px-3 py-2.5 text-sm">
                        <dt className="text-xs text-muted-foreground">
                          {t('admin.approvals.reason', locale)}
                        </dt>
                        <dd dir="auto" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {request.reason}
                        </dd>
                      </dl>
                    )}
                  </div>
                  {decision ? (
                    <details className="rounded-lg border px-3 text-sm">
                      <summary className="min-h-11 cursor-pointer py-3 font-medium">
                        {t('admin.approvals.requestDetails', locale)}
                      </summary>
                      <div className="pb-3">{metadata}</div>
                    </details>
                  ) : (
                    metadata
                  )}
                  {recordSearch && !requestId && request.reason && (
                    <p className="line-clamp-2 text-sm text-muted-foreground">{request.reason}</p>
                  )}
                  {renderDecision && request.details?.entityType === 'wallet_bank_receipt' && (
                    <a
                      className="text-primary underline"
                      href={
                        typeof request.details.receiptId === 'string' &&
                        isInvoiceUuid(request.details.receiptId)
                          ? `/admin/wallet-receipts/${encodeURIComponent(request.details.receiptId)}`
                          : '/admin/wallet-receipts'
                      }
                    >
                      {t('admin.approvals.walletReceipts', locale)}
                    </a>
                  )}
                  {renderDecision &&
                    request.actionType === 'refund' &&
                    typeof request.details?.invoiceId === 'string' &&
                    isInvoiceUuid(request.details.invoiceId) &&
                    (request.details.destination === 'wallet' ||
                      request.details.destination === 'external_bank') && (
                      <a
                        className="inline-block text-primary underline"
                        href={`/admin/invoices/${encodeURIComponent(request.details.invoiceId)}/refunds/${request.details.destination === 'wallet' ? 'wallet' : 'bank'}`}
                      >
                        {t('admin.approvals.returnToRefund', locale)}
                      </a>
                    )}
                  {recordSearch && !requestId && (
                    <Link
                      to={approvalRequestRoute}
                      params={{ requestId: request.id, decision: undefined }}
                      search={recordSearch}
                      aria-label={`${t('admin.approvals.openRequest', locale)} · ${request.id}`}
                      className={buttonVariants({
                        size: 'sm',
                        variant: 'outline',
                        className: 'min-h-11',
                      })}
                    >
                      {t('admin.approvals.openRequest', locale)}
                    </Link>
                  )}
                  {renderDecision && request.status === 'pending' && (
                    <ApprovalDecisionForm
                      key={decision ?? 'review'}
                      requestId={request.id}
                      rejectionRoute={
                        requestId && recordSearch
                          ? {
                              active: decision === 'reject',
                              link: (
                                <Link
                                  to={approvalRequestRoute}
                                  params={{ requestId, decision: decision ? undefined : 'reject' }}
                                  search={recordSearch}
                                  disabled={actionLocked || loading || (!decision && error)}
                                  className={buttonVariants({
                                    variant: decision ? 'ghost' : 'outline',
                                    className: 'aria-disabled:opacity-60',
                                  })}
                                >
                                  {t(
                                    decision
                                      ? 'admin.approvals.cancelRejection'
                                      : 'admin.approvals.reject',
                                    locale
                                  )}
                                </Link>
                              ),
                            }
                          : undefined
                      }
                      initialReason={reasons[request.id] ?? ''}
                      disabled={!!action || validating !== null || loading || error}
                      draftDisabled={!!action || validating !== null || loading}
                      {...(validating === request.id ||
                      (action &&
                        selected.current?.id === request.id &&
                        action.path.endsWith('/reject'))
                        ? { pending: 'reject' as const }
                        : action && selected.current?.id === request.id
                          ? { pending: 'approve' as const }
                          : {})}
                      onChange={(reason) =>
                        setReasons((previous) => ({ ...previous, [request.id]: reason }))
                      }
                      validate={(run) => validateReject(request, run)}
                      decide={(decision, draft, reason, owner) =>
                        decide(request, decision, draft, reason, owner)
                      }
                    />
                  )}
                  {decision && request.status !== 'pending' && !saved && (
                    <p role="status" className="rounded-lg border bg-muted/25 p-3 text-sm">
                      {t('admin.approvals.rejectionUnavailable', locale)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </ListPage.Content>
        {!requestId && (
          <ListPage.Pagination
            kind="cursor"
            label={t('admin.approvals.pages', locale)}
            loading={loading}
            hasMore={
              !error &&
              !action &&
              validating === null &&
              visibleItems.length > PAGE_SIZE &&
              (!queries || queries.query.page < 1_000_000)
            }
            nextLabel={t('admin.approvals.next', locale)}
            onNext={() =>
              queries
                ? queries.setQuery({ page: queries.query.page + 1 })
                : setOffset((value) => value + PAGE_SIZE)
            }
            previous={{
              enabled: offset > 0 && !error && !action && validating === null,
              label: t('admin.approvals.previous', locale),
              onClick: () =>
                queries
                  ? queries.setQuery({ page: Math.max(1, queries.query.page - 1) })
                  : setOffset((value) => Math.max(0, value - PAGE_SIZE)),
            }}
          />
        )}
      </ListPage>
      {action && (
        <TeamActionDialog
          action={action}
          toastErrors={!requestId}
          finalFocus={() => returnFocus.current}
          onValidationError={(fields) =>
            action.path.endsWith('/reject') &&
            actionGeneration === workGeneration.current &&
            !accessDenied.current &&
            (decisionDraft.current?.applyServerErrors(fields) ?? false)
          }
          onDenied={() => {
            if (actionGeneration === workGeneration.current) denyAccess();
          }}
          onUnconfirmed={() => {
            if (actionGeneration !== workGeneration.current || accessDenied.current) return;
            available.current = false;
            clearDecision();
            setUnconfirmed(true);
            void load();
          }}
          summary={
            review ? (
              <FinancialReviewSummary
                title={
                  review.details?.entityType === 'electricity_order_termination'
                    ? t('electricity.rawDraft.walletReturn', locale)
                    : review.actionType === 'contract_cancellation' &&
                        review.details?.terminalAction === 'reject'
                      ? contractText('rejectionFinancialReview', locale)
                      : t(`admin.approvals.${review.actionType}`, locale)
                }
                rows={[
                  {
                    id: 'request',
                    label: t('admin.approvals.requestId', locale),
                    value: review.id,
                  },
                  {
                    id: 'initiator',
                    label: t('admin.approvals.initiator', locale),
                    value: review.initiatorUsername ?? review.initiatorId,
                  },
                  {
                    id: 'reason',
                    label: t('admin.approvals.reason', locale),
                    value: review.reason,
                  },
                  ...(rejectionReason
                    ? [
                        {
                          id: 'rejection-reason',
                          label: t('admin.approvals.rejectReason', locale),
                          value: rejectionReason,
                        },
                      ]
                    : []),
                  ...(review.actionType === 'contract_cancellation' &&
                  (review.details?.terminalAction === 'reject' ||
                    review.details?.entityType === 'electricity_order_termination')
                    ? [
                        ...(review.details?.entityType === 'electricity_order_termination'
                          ? (['orderId', 'profileId'] as const)
                          : (['contractId', 'profileId', 'versionId'] as const)
                        ).flatMap((key) =>
                          typeof review.details?.[key] === 'string'
                            ? [
                                {
                                  id: key,
                                  label:
                                    key === 'orderId'
                                      ? t('electricity.rawDraft.order', locale)
                                      : contractText(
                                          key === 'contractId'
                                            ? 'contractReference'
                                            : key === 'profileId'
                                              ? 'profile'
                                              : 'version',
                                          locale
                                        ),
                                  value: review.details[key] as string,
                                },
                              ]
                            : []
                        ),
                        ...(typeof review.details.refundDecision === 'object' &&
                        review.details.refundDecision !== null &&
                        'refunds' in review.details.refundDecision &&
                        Array.isArray(review.details.refundDecision.refunds)
                          ? review.details.refundDecision.refunds.flatMap(
                              (line: unknown, index: number) =>
                                line &&
                                typeof line === 'object' &&
                                'invoiceId' in line &&
                                typeof line.invoiceId === 'string' &&
                                'amount' in line &&
                                typeof line.amount === 'string' &&
                                /^[1-9][0-9]{0,18}$/.test(line.amount) &&
                                'destination' in line &&
                                line.destination === 'wallet'
                                  ? [
                                      {
                                        id: 'rejection-refund-' + line.invoiceId,
                                        label:
                                          contractText('cancellationInvoice', locale) +
                                          ' ' +
                                          (index + 1),
                                        value:
                                          line.invoiceId +
                                          ' · ' +
                                          numbers.money(line.amount) +
                                          ' · ' +
                                          contractText('cancellation.wallet', locale),
                                      },
                                    ]
                                  : []
                            )
                          : []),
                        ...adoptedReturns(review).map((refund) => ({
                          id: 'existing-' + refund.id,
                          label: t('electricity.rawDraft.existingReturn', locale),
                          value:
                            refund.id +
                            ' · ' +
                            t('admin.invoices.walletRefunds.state.' + refund.state, locale) +
                            ' · ' +
                            t(
                              'electricity.rawDraft.' +
                                (refund.exhausted ? 'manualRetryRequired' : 'retryPreserved'),
                              locale
                            ),
                        })),
                      ]
                    : []),
                  ...(typeof review.details?.invoiceId === 'string'
                    ? [
                        {
                          id: 'invoice',
                          label: t('admin.approvals.invoiceId', locale),
                          value: review.details.invoiceId,
                        },
                      ]
                    : []),
                  ...(review.actionType === 'refund' &&
                  (review.details?.destination === 'wallet' ||
                    review.details?.destination === 'external_bank')
                    ? [
                        {
                          id: 'destination',
                          label: t('admin.approvals.destination', locale),
                          value: t(
                            review.details.destination === 'wallet'
                              ? 'admin.invoices.walletRefunds.title'
                              : 'admin.invoices.externalRefunds.title',
                            locale
                          ),
                        },
                      ]
                    : []),
                ]}
                total={{
                  label: t('admin.approvals.amount', locale),
                  value: numbers.money(approvalAmount(review)),
                }}
                notice={
                  review.details?.invoiceAdjustment
                    ? tInvoiceCorrections('approvalEffect', locale)
                    : t('admin.approvals.confirm', locale)
                }
              />
            ) : undefined
          }
          onClose={() => {
            if (actionGeneration === workGeneration.current) clearDecision();
          }}
          onSuccess={async (result) => {
            if (accessDenied.current || actionGeneration !== workGeneration.current) return;
            const id = selected.current?.id;
            const expectedStatus = action.path.endsWith('/reject') ? 'rejected' : 'approved';
            if (
              !result ||
              typeof result !== 'object' ||
              (result as Request).id !== id ||
              (result as Request).status !== expectedStatus
            )
              throw new Error('Invalid approval acknowledgement');
            decisionDraft.current?.clear();
            clearDecision();
            if (id)
              setReasons((old) => {
                const next = { ...old };
                delete next[id];
                return next;
              });
            setSaved(true);
            await load();
          }}
        />
      )}
    </section>
  );
}
