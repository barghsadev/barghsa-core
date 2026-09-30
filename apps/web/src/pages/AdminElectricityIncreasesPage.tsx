import { useEffect, useRef, useState } from 'react';
import { t } from '@barghsa/i18n/admin-ui';
import {
  Button,
  Card,
  CardContent,
  FinancialReviewSummary,
  Input,
  Label,
  ListPage,
} from '@barghsa/ui';
import {
  parseElectricityIncreaseStaffDecisionReview,
  type ElectricityIncreaseStaffDecisionReview,
} from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';

interface IncreaseRequest {
  requestId: string;
  profileId: string;
  contractId: string;
  versionId: string;
  orderId: string;
  originalKwh: string;
  requestedKwh: string;
  maxPercentage: number;
  effectiveFrom: string;
  periodEnd: string;
  createdAt: string;
  contractState: string;
  status: string;
  adjustmentInvoiceId: string | null;
  adjustmentInvoiceState: string | null;
  adjustmentPaidAmount: string | null;
  financialFollowUp: boolean;
}

export default function AdminElectricityIncreasesPage() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
  const [requests, setRequests] = useState<IncreaseRequest[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [view, setView] = useState<'pending' | 'expired'>('pending');
  const [acceptedView, setAcceptedView] = useState(view);
  const visibleRequests = acceptedView === view ? requests : null;
  const accessDenied = useRef(false);
  const reviewedRequest = useRef<IncreaseRequest | null>(null);
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [effectiveDate, setEffectiveDate] = useState<Record<string, string>>({});
  const [action, setAction] = useState<TeamAction | null>(null);
  const [decisionReview, setDecisionReview] =
    useState<ElectricityIncreaseStaffDecisionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const reviewRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const path =
      `/api/staff/electricity/increase-requests?status=${view}` +
      (before ? `&before=${encodeURIComponent(before)}` : '');
    void fetch(path, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if ([401, 403].includes(response.status)) throw new Error('denied');
        if (!response.ok) throw new Error('Queue unavailable');
        return response.json() as Promise<{
          requests: IncreaseRequest[];
          nextBefore: string | null;
        }>;
      })
      .then((value) => {
        if (!controller.signal.aborted) {
          if (
            !value ||
            !Array.isArray(value.requests) ||
            (value.nextBefore !== null && typeof value.nextBefore !== 'string')
          )
            throw new Error('Invalid queue');
          const selected = reviewedRequest.current;
          if (
            selected &&
            !value.requests.some((item) => JSON.stringify(item) === JSON.stringify(selected))
          )
            clearReview();
          accessDenied.current = false;
          setDenied(false);
          setAcceptedView(view);
          setRequests(value.requests);
          setNextBefore(value.nextBefore);
        }
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(true);
        if (caught instanceof Error && caught.message === 'denied') {
          deny();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [before, revision, view]);

  function deny() {
    accessDenied.current = true;
    setDenied(true);
    setError(true);
    setRequests(null);
    setNextBefore(null);
    setReason({});
    setEffectiveDate({});
    clearReview();
  }
  function clearReview() {
    ++reviewRequest.current;
    reviewedRequest.current = null;
    setDecisionReview(null);
    setAction(null);
    setReviewLoading(false);
    setReviewError(false);
  }
  useEffect(
    () => () => {
      ++reviewRequest.current;
    },
    []
  );

  async function reviewDecision(request: IncreaseRequest, decision: 'approve' | 'reject') {
    if (reviewLoading || loading || error || accessDenied.current || view !== 'pending') return;
    const reasonText = (reason[request.requestId] ?? '').trim();
    if (decision === 'reject' && !reasonText) return;
    const effectiveFrom =
      decision === 'approve' && effectiveDate[request.requestId]
        ? new Date(effectiveDate[request.requestId]!).toISOString()
        : undefined;
    const path = `/api/staff/electricity/increase-requests/${encodeURIComponent(request.requestId)}/${decision}`;
    const previewInput =
      decision === 'approve' ? (effectiveFrom ? { effectiveFrom } : {}) : { reason: reasonText };
    reviewedRequest.current = request;
    const generation = ++reviewRequest.current;
    setReviewLoading(true);
    setReviewError(false);
    try {
      const response = await fetch(`${path}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(previewInput),
      });
      if (generation !== reviewRequest.current) return;
      if ([401, 403].includes(response.status)) {
        deny();
        return;
      }
      if (!response.ok) throw new Error('Increase decision review unavailable');
      const review = parseElectricityIncreaseStaffDecisionReview(await response.json());
      if (generation !== reviewRequest.current) return;
      if (
        !review ||
        review.scope.profileId !== request.profileId ||
        review.scope.resourceId !== request.requestId ||
        review.data.action !== decision ||
        review.data.contractId !== request.contractId ||
        review.data.versionId !== request.versionId ||
        review.data.originalKwh !== request.originalKwh ||
        review.data.requestedKwh !== request.requestedKwh ||
        review.data.reason !== (decision === 'reject' ? reasonText : '') ||
        (effectiveFrom && review.data.effectiveFrom !== effectiveFrom)
      )
        throw new Error('Increase decision review mismatch');
      setDecisionReview(review);
      setAction({
        title: copy(decision),
        description: copy('reviewConfirm'),
        path,
        method: 'POST',
        body: {
          idempotencyKey: crypto.randomUUID(),
          expectedReviewHash: review.hash,
          ...(decision === 'approve'
            ? { effectiveFrom: review.data.effectiveFrom }
            : { reason: reasonText }),
        },
        conflictMessage: copy('conflict'),
        forbiddenMessage: copy('forbidden'),
      });
    } catch {
      if (generation === reviewRequest.current) {
        setDecisionReview(null);
        setReviewError(true);
      }
    } finally {
      if (generation === reviewRequest.current) setReviewLoading(false);
    }
  }

  const confirmationGeneration = reviewRequest.current;
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('title')}</h1>
          <p className="text-muted-foreground">{copy('description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={loading}
          onClick={() => {
            setBefore(null);
            setRevision((value) => value + 1);
          }}
        >
          {copy('refresh')}
        </Button>
      </header>
      <ListPage role="region" aria-label={copy('listTitle')}>
        <ListPage.Toolbar>
          <div className="flex flex-wrap gap-2" role="group" aria-label={copy('viewLabel')}>
            {(['pending', 'expired'] as const).map((status) => (
              <Button
                key={status}
                variant={view === status ? 'default' : 'outline'}
                onClick={() => {
                  if (status === view) return;
                  clearReview();
                  setReason({});
                  setEffectiveDate({});
                  setNextBefore(null);
                  setView(status);
                  setBefore(null);
                }}
              >
                {copy(`${status}Tab`)}
              </Button>
            ))}
          </div>
        </ListPage.Toolbar>
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!visibleRequests?.length}
          retainContent={!!visibleRequests?.length && !denied}
          loadingView={<p role="status">{copy('loading')}</p>}
          errorView={
            <div role="alert" className="space-y-2">
              <p>{copy(denied ? 'forbidden' : 'error')}</p>
              {!denied && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  {copy('retry')}
                </Button>
              )}
            </div>
          }
          emptyView={<p>{copy(view === 'pending' ? 'empty' : 'emptyExpired')}</p>}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {visibleRequests?.map((request) => (
              <Card key={request.requestId}>
                <CardContent className="space-y-3 pt-6 text-sm">
                  <h2 className="font-semibold">{copy('request')}</h2>
                  <p>
                    {copy('contract')}:{' '}
                    <a className="break-all text-primary underline" href="/admin/contracts">
                      <bdi dir="ltr">{request.contractId}</bdi>
                    </a>
                  </p>
                  <p>
                    {copy('order')}:{' '}
                    <bdi dir="ltr" className="break-all">
                      {request.orderId}
                    </bdi>
                  </p>
                  <p>
                    {copy('quantity')}: {numbers.irrDigits(request.originalKwh)} →{' '}
                    {numbers.irrDigits(request.requestedKwh)} kWh
                  </p>
                  <p>
                    {copy('change')}:{' '}
                    {numbers.number(
                      Number(
                        ((BigInt(request.requestedKwh) - BigInt(request.originalKwh)) * 10000n) /
                          BigInt(request.originalKwh)
                      ) / 100
                    )}
                    %
                  </p>
                  <p>
                    {copy('effective')}: {new Date(request.effectiveFrom).toLocaleString(locale)}
                  </p>
                  <p>
                    {copy('end')}: {new Date(request.periodEnd).toLocaleString(locale)}
                  </p>
                  <p>
                    {copy('status')}:{' '}
                    {copy(
                      `state.${['Active', 'Completed', 'Cancelled'].includes(request.contractState) ? request.contractState : 'other'}`
                    )}
                  </p>
                  {view === 'expired' ? (
                    <div className="space-y-1 rounded-md border p-3">
                      <p>
                        {copy('invoiceState')}:{' '}
                        {request.adjustmentInvoiceState
                          ? copy(`invoice.${request.adjustmentInvoiceState}`)
                          : copy('notIssued')}
                      </p>
                      {request.adjustmentInvoiceId ? (
                        <p className="break-all">
                          <a
                            className="text-primary underline underline-offset-2"
                            href={`/admin/invoices?invoiceId=${encodeURIComponent(request.adjustmentInvoiceId)}`}
                          >
                            <bdi dir="ltr">{request.adjustmentInvoiceId}</bdi>
                          </a>
                        </p>
                      ) : null}
                      {request.adjustmentPaidAmount ? (
                        <p>
                          {copy('paidAmount')}: {numbers.irrDigits(request.adjustmentPaidAmount)}{' '}
                          IRR
                        </p>
                      ) : null}
                      <p>{copy(request.financialFollowUp ? 'financeFollowUp' : 'expiredClosed')}</p>
                    </div>
                  ) : null}
                  {view === 'pending' ? (
                    <div className="space-y-2">
                      <Label htmlFor={`increase-effective-${request.requestId}`}>
                        {copy('approveDate')}
                      </Label>
                      <Input
                        id={`increase-effective-${request.requestId}`}
                        type="datetime-local"
                        value={effectiveDate[request.requestId] ?? ''}
                        onChange={(event) =>
                          setEffectiveDate((current) => ({
                            ...current,
                            [request.requestId]: event.target.value,
                          }))
                        }
                      />
                      <p className="text-muted-foreground">{copy('approveDateHelp')}</p>
                      <Button
                        disabled={reviewLoading || loading || error}
                        onClick={() => void reviewDecision(request, 'approve')}
                      >
                        {copy('approve')}
                      </Button>
                    </div>
                  ) : null}
                  {view === 'pending' ? (
                    <div className="space-y-2">
                      <Label htmlFor={`increase-reason-${request.requestId}`}>
                        {copy('reason')}
                      </Label>
                      <Input
                        id={`increase-reason-${request.requestId}`}
                        maxLength={1000}
                        value={reason[request.requestId] ?? ''}
                        onChange={(event) =>
                          setReason((current) => ({
                            ...current,
                            [request.requestId]: event.target.value,
                          }))
                        }
                      />
                      <Button
                        variant="destructive"
                        disabled={
                          !(reason[request.requestId] ?? '').trim() ||
                          reviewLoading ||
                          loading ||
                          error
                        }
                        onClick={() => void reviewDecision(request, 'reject')}
                      >
                        {copy('reject')}
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </ListPage.Content>
        {reviewLoading ? <p role="status">{copy('reviewLoading')}</p> : null}
        {reviewError ? <p role="alert">{copy('reviewError')}</p> : null}
        <ListPage.Pagination
          kind="cursor"
          hasMore={!!nextBefore && !error && !denied}
          loading={loading}
          label={copy('pages')}
          nextLabel={copy('more')}
          onNext={() => {
            if (nextBefore) setBefore(nextBefore);
          }}
        />
      </ListPage>
      {action ? (
        <TeamActionDialog
          action={action}
          summary={
            decisionReview ? (
              <FinancialReviewSummary
                title={copy('reviewTitle')}
                rows={[
                  {
                    id: 'contract',
                    label: copy('contract'),
                    value: decisionReview.data.contractId,
                  },
                  {
                    id: 'quantity',
                    label: copy('quantity'),
                    value: `${numbers.irrDigits(decisionReview.data.originalKwh)} → ${numbers.irrDigits(decisionReview.data.requestedKwh)} kWh`,
                  },
                  {
                    id: 'increment',
                    label: copy('increment'),
                    value: `${numbers.irrDigits(decisionReview.data.incrementalKwh)} kWh`,
                  },
                  {
                    id: 'policy',
                    label: copy('currentLimit'),
                    value:
                      decisionReview.data.maxPercentageAtDecision === null
                        ? copy('notApplicable')
                        : `${numbers.number(decisionReview.data.maxPercentageAtDecision)}%`,
                  },
                  {
                    id: 'effective',
                    label: copy('effective'),
                    value: decisionReview.data.effectiveFrom
                      ? new Date(decisionReview.data.effectiveFrom).toLocaleString(locale)
                      : copy('notApplicable'),
                  },
                  {
                    id: 'end',
                    label: copy('end'),
                    value: new Date(decisionReview.data.periodEnd).toLocaleString(locale),
                  },
                  {
                    id: 'invoice',
                    label: copy('originalInvoice'),
                    value: `${copy(`invoice.${decisionReview.data.originalInvoiceState}`)} · ${numbers.irrDigits(decisionReview.data.originalInvoiceTotalIrR)} IRR`,
                  },
                  {
                    id: 'paid',
                    label: copy('paidAmount'),
                    value: `${numbers.irrDigits(decisionReview.data.originalInvoicePaidIrR)} IRR`,
                  },
                  ...(decisionReview.data.reason
                    ? [{ id: 'reason', label: copy('reason'), value: decisionReview.data.reason }]
                    : []),
                ]}
                total={{
                  label: copy('decisionOutcome'),
                  value: copy(`outcome.${decisionReview.data.outcome}`),
                }}
                notice={
                  decisionReview.data.action === 'approve' ? (
                    <p>{copy('signingChargeNotice')}</p>
                  ) : undefined
                }
              />
            ) : undefined
          }
          onClose={() => {
            if (confirmationGeneration !== reviewRequest.current) return;
            clearReview();
          }}
          onSuccess={async () => {
            if (accessDenied.current || confirmationGeneration !== reviewRequest.current) return;
            clearReview();
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
