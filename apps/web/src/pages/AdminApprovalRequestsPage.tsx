import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { tInvoiceCorrections } from '@barghsa/i18n/invoice-corrections';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import { APPROVAL_REVIEW_REASON_MAX_LENGTH } from '@barghsa/shared/finance';
import { Button, FinancialReviewSummary, Label, ListPage } from '@barghsa/ui';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { useLocale } from '../hooks/useLocale.js';
import DualApprovalThresholdPanel from '../components/DualApprovalThresholdPanel.js';
import { Link, useSearch } from '@tanstack/react-router';
import { isInvoiceUuid } from '../lib/due-at-override.js';

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
  function clearDecision() {
    ++workGeneration.current;
    selected.current = null;
    setAction(null);
    setReview(null);
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
        accessDenied.current = true;
        setDenied(true);
        setItems([]);
        setReasons({});
        setSaved(false);
        clearDecision();
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
  function decide(request: Request, decision: 'approve' | 'reject') {
    if (loading || error || accessDenied.current || request.status !== 'pending') return;
    const reason = (reasons[request.id] ?? '').trim();
    if (decision === 'reject' && !reason) return;
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
    <section className="mx-auto max-w-4xl space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t('admin.approvals.title', locale)}</h1>
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
                  disabled={!!action}
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
            <Button variant="outline" disabled={loading} onClick={() => void load()}>
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
                  {t(`admin.approvals.${request.actionType}`, locale)}
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
                  <a className="text-blue-700 underline" href="/admin/wallet-receipts">
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
                  <div className="space-y-2">
                    <Label htmlFor={`reason-${request.id}`}>
                      {t('admin.approvals.rejectReason', locale)}
                    </Label>
                    <textarea
                      id={`reason-${request.id}`}
                      maxLength={APPROVAL_REVIEW_REASON_MAX_LENGTH}
                      className="block w-full rounded border p-2"
                      disabled={!!action}
                      value={reasons[request.id] ?? ''}
                      onChange={(event) =>
                        setReasons((previous) => ({
                          ...previous,
                          [request.id]: event.target.value,
                        }))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={!!action || loading || error}
                        onClick={() => decide(request, 'approve')}
                      >
                        {t('admin.approvals.approve', locale)}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          !!action || loading || error || !(reasons[request.id] ?? '').trim()
                        }
                        onClick={() => decide(request, 'reject')}
                      >
                        {t('admin.approvals.reject', locale)}
                      </Button>
                    </div>
                  </div>
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
              enabled: offset > 0 && !error && !action,
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
          summary={
            review ? (
              <FinancialReviewSummary
                title={t(`admin.approvals.${review.actionType}`, locale)}
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
          onSuccess={async () => {
            if (accessDenied.current || actionGeneration !== workGeneration.current) return;
            const id = selected.current?.id;
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
