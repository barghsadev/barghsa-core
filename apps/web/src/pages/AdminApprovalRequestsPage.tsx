import { contractText } from '@barghsa/i18n/contracts';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { tInvoiceCorrections } from '@barghsa/i18n/invoice-corrections';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { Button, FinancialReviewSummary, Label, ListPage } from '@barghsa/ui';
import {
  ApprovalDecisionForm,
  type ApprovalDecisionDraft,
} from '../components/ApprovalDecisionForm.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import DualApprovalThresholdPanel from '../components/DualApprovalThresholdPanel.js';
import { Link, useSearch } from '@tanstack/react-router';
import { isInvoiceUuid } from '../lib/due-at-override.js';
import { existingDraftReturns } from '../lib/electricity-existing-returns.js';

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

export default function AdminApprovalRequestsPage({
  queries,
}: { queries?: ListQueryBinding } = {}) {
  const { requestId } = useSearch({ from: '/admin/approval-requests' });
  return (
    <AdminApprovalRequestsView
      {...(requestId ? { requestId } : {})}
      {...(queries ? { queries } : {})}
    />
  );
}

export function AdminApprovalRequestsView({
  requestId,
  queries,
}: {
  requestId?: string;
  queries?: ListQueryBinding;
}) {
  return (
    <ApprovalWorkspace
      key={requestId || `queue:${queries?.query.filters.status || 'pending'}`}
      {...(requestId ? { requestId } : {})}
      {...(queries ? { queries } : {})}
    />
  );
}
function ApprovalWorkspace({
  requestId,
  queries,
}: {
  requestId?: string;
  queries?: ListQueryBinding;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const [localStatus, setStatus] = useState<Status>('pending');
  const [localOffset, setOffset] = useState(0);
  const status = (queries?.query.filters.status || localStatus) as Status;
  const offset = queries ? (queries.query.page - 1) * PAGE_SIZE : localOffset;
  const [items, setItems] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
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
      const response = await fetch(
        requestId
          ? `/api/admin/approval-requests/${encodeURIComponent(requestId)}`
          : `/api/admin/approval-requests?status=${status}&limit=${PAGE_SIZE + 1}&offset=${offset}`,
        { credentials: 'include', signal: controller.signal }
      );
      if ([401, 403].includes(response.status)) throw new Error('denied');
      if (!response.ok) throw new Error('Queue unavailable');
      const data: unknown = await response.json();
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
  }, [status, offset, requestId, scope]);
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
    setAdjustmentDecision(
      request.actionType === 'manual_adjustment' && Boolean(request.details?.invoiceAdjustment)
    );
    ++workGeneration.current;
    commandGeneration.current = workGeneration.current;
    selected.current = request;
    setReview(request);
    setAction({
      title: t(`admin.approvals.${decision}`, locale),
      description: `${t('admin.approvals.confirm', locale)} ${request.id} · ${numbers.money(approvalAmount(request))} ${decision === 'reject' ? `· ${reason}` : request.details?.invoiceAdjustment ? tInvoiceCorrections('approvalEffect', locale) : ''}`,
      path: `/api/admin/approval-requests/${encodeURIComponent(request.id)}/${decision}`,
      method: 'POST',
      ...(decision === 'reject' ? { body: { reason } } : {}),
      conflictMessage: t('admin.approvals.conflict', locale),
      forbiddenMessage: t('admin.approvals.forbidden', locale),
    });
  }

  const actionGeneration = commandGeneration.current;
  return (
    <section
      aria-labelledby="approval-requests-title"
      className="mx-auto max-w-4xl space-y-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="space-y-2">
        <h1 id="approval-requests-title" className="text-2xl font-semibold">
          {t('admin.approvals.title', locale)}
        </h1>
        <p className="text-sm text-muted-foreground">{t('admin.approvals.description', locale)}</p>
      </header>
      <DualApprovalThresholdPanel />
      {requestId && (
        <div className="space-y-2 rounded-lg border border-primary bg-card p-4 text-sm">
          <p>
            {t('admin.approvals.linkedRequest', locale)}: <bdi>{requestId}</bdi>
          </p>
          <Link
            to="/admin/approval-requests"
            search={(previous) => ({ ...previous, requestId: undefined })}
            className="inline-block text-primary underline"
          >
            {t('admin.approvals.backToQueue', locale)}
          </Link>
        </div>
      )}
      <ListPage role="region" aria-label={t('admin.approvals.listTitle', locale)}>
        <ListPage.Toolbar>
          <div className="flex flex-wrap items-center gap-3">
            {!requestId && (
              <>
                <Label htmlFor="approval-status">{t('admin.approvals.status', locale)}</Label>
                <select
                  id="approval-status"
                  className="rounded border bg-card text-card-foreground p-2"
                  value={status}
                  disabled={!!action || validating !== null}
                  onChange={(event) => {
                    if (queries) {
                      queries.setQuery({ filters: { status: event.target.value } });
                      return;
                    }
                    clearDecision();
                    setReasons({});
                    setStatus(event.target.value as Status);
                    setOffset(0);
                    setSaved(false);
                  }}
                >
                  {(['pending', 'approved', 'rejected'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`admin.approvals.${value}`, locale)}
                    </option>
                  ))}
                </select>
              </>
            )}
            <Button
              variant="outline"
              disabled={loading || validating !== null}
              onClick={() => void load()}
            >
              {t('admin.approvals.refresh', locale)}
            </Button>
          </div>
        </ListPage.Toolbar>
        {saved && (
          <p role="status">
            {adjustmentDecision
              ? tInvoiceCorrections('decisionSaved', locale)
              : t('admin.approvals.saved', locale)}
          </p>
        )}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!visibleItems.length}
          retainContent={!!visibleItems.length && !denied}
          loadingView={<p role="status">{t('admin.approvals.loading', locale)}</p>}
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
          emptyView={<p>{t('admin.approvals.empty', locale)}</p>}
        >
          <ul className="space-y-4">
            {visibleItems.slice(0, PAGE_SIZE).map((request) => (
              <li
                key={request.id}
                className="space-y-3 rounded-lg border bg-card text-card-foreground p-4 break-words"
              >
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
                <dl className="grid gap-2 text-sm sm:grid-cols-2">
                  {[
                    [t('admin.approvals.requestId', locale), request.id],
                    [t('admin.approvals.amount', locale), numbers.money(approvalAmount(request))],
                    [
                      t('admin.approvals.initiator', locale),
                      request.initiatorUsername ?? request.initiatorId,
                    ],
                    [t('admin.approvals.reason', locale), request.reason],
                    [
                      t('admin.approvals.status', locale),
                      t(`admin.approvals.${request.status}`, locale),
                    ],
                    ...(['receiptId', 'invoiceId', 'walletId'] as const).flatMap((key) =>
                      typeof request.details?.[key] === 'string'
                        ? [[t(`admin.approvals.${key}`, locale), request.details[key] as string]]
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
                    ...(request.reviewerId
                      ? [
                          [
                            t('admin.approvals.reviewer', locale),
                            request.reviewerUsername ?? request.reviewerId,
                          ],
                        ]
                      : []),
                    ...(request.reviewReason
                      ? [[t('admin.approvals.reviewReason', locale), request.reviewReason]]
                      : []),
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="whitespace-pre-wrap">{value}</dd>
                    </div>
                  ))}
                </dl>
                {request.details?.entityType === 'wallet_bank_receipt' && (
                  <a className="text-primary underline" href="/admin/wallet-receipts">
                    {t('admin.approvals.walletReceipts', locale)}
                  </a>
                )}
                {request.actionType === 'refund' &&
                  typeof request.details?.invoiceId === 'string' &&
                  isInvoiceUuid(request.details.invoiceId) &&
                  (request.details.destination === 'wallet' ||
                    request.details.destination === 'external_bank') && (
                    <a
                      className="inline-block text-primary underline"
                      href={`/admin/invoices?invoiceId=${encodeURIComponent(request.details.invoiceId)}#${request.details.destination === 'wallet' ? 'wallet-refunds-panel' : 'external-refunds-panel'}`}
                    >
                      {t('admin.approvals.returnToRefund', locale)}
                    </a>
                  )}
                {request.status === 'pending' && (
                  <ApprovalDecisionForm
                    requestId={request.id}
                    initialReason={reasons[request.id] ?? ''}
                    disabled={!!action || validating !== null || loading || error}
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
              </li>
            ))}
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
