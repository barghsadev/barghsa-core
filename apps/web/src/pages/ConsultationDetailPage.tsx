import { CommandFeedback } from '../components/CommandFeedback.js';
import { ConfirmationFields } from '@barghsa/ui';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { historyContextText } from '../lib/history-context.js';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  LoadingStatus,
  Button,
  Alert,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FinancialReviewSummary,
  StatusTimeline,
} from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useZodForm,
} from '@barghsa/ui/form';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  confirmedConsultationInformation,
  consultationReceipt,
  consultationUuid,
  definitiveConsultationRejection,
  type ConsultationReasonDraft,
  type ConsultationInformationCommand,
} from '../lib/consultation-form.js';
import { tConsultation } from '@barghsa/i18n/consultation';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import {
  parseConsultationOfferReview,
  type ConsultationOfferReview,
} from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { withCsrf } from '../lib/csrf.js';
import { WorkflowStatusBanner } from '../components/WorkflowStatusBanner.js';
import { workflowFeedback } from '@barghsa/i18n/workflow-feedback';
import { consultationNextAction } from '../lib/consultation-next-action.js';
import { readWithDeadline, ServerQueryError } from '../lib/server-query-client.js';

interface Detail {
  request: {
    id: string;
    profile_id: string;
    status: string;
    product_snapshot: { title: { fa: string; en: string } };
    submitted_at: string;
    staff_owner_username: string | null;
    staff_owner_id?: string | null;
    staff_team: string | null;
    fee: string | null;
    scope: string | null;
    deliverables: string | null;
    expected_next_step: string | null;
    offer_valid_until: string | null;
    invoice_id: string | null;
    invoice_state: string | null;
    has_paid_invoice: boolean;
    accepted_at: string | null;
  };
  history: Array<{
    status: string;
    actor_type: 'staff' | 'customer' | 'unknown';
    actor_name?: string | null;
    reason: string | null;
    created_at: string;
  }>;
  adjustments: Array<{
    id: string;
    adjustment_kind: 'charge' | 'credit';
    amount: string;
    state: string;
  }>;
  refunds: Array<{ id: string; amount: string; state: string; destination: string }>;
}

function optionalText(value: unknown): boolean {
  return value == null || typeof value === 'string';
}

function validTimestamp(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

async function postConsultationAction(
  requestId: string,
  action: 'provide-info' | 'offer-review' | 'accept' | 'decline',
  body: Record<string, string>,
  owner: AbortSignal
) {
  return readWithDeadline(owner, async (signal) => {
    const response = await fetch(
      `/api/consultations/requests/${encodeURIComponent(requestId)}/${action}`,
      {
        method: 'POST',
        credentials: 'include',
        headers: withCsrf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal,
      }
    );
    return { response, result: await response.json().catch(() => null) };
  });
}

export function ConsultationDetailPage() {
  const { requestId } = useParams({ from: '/_app/consultations/$requestId' });
  const navigate = useNavigate();
  const locale = useLocale();
  const time = useAccountTime(locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => tConsultation(key, locale);
  const actorId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const reader = useId();
  const client = useQueryClient();
  const scope = JSON.stringify([actorId, profileRevision, requestId]);
  const currentScope = useRef(scope);
  const generation = useRef(0);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    ++generation.current;
  }
  const [acceptedScope, setAcceptedScope] = useState(scope);
  const [detailState, setDetail] = useState<Detail | null>(null);
  const detail = acceptedScope === scope ? detailState : null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'notFound' | 'detailLoadError' | null>(null);
  const schemaGeneration = generation.current;
  const informationForm = useZodForm<ConsultationReasonDraft>(
    async () => {
      const schemas = await import('../lib/consultation-form-schemas.js');
      return schemaGeneration === generation.current
        ? schemas.reasonSchema(copy('informationInvalid'))
        : schemas.inactiveReasonSchema;
    },
    { defaultValues: { reason: '' }, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const informationFields = useActionFieldErrors(
    informationForm,
    { reason: copy('informationInvalid') },
    copy('actionError')
  );
  const pendingInformation = useRef<ConsultationInformationCommand | null>(null);
  const actionTransport = useRef<AbortController | null>(null);
  const [informationUnconfirmed, setInformationUnconfirmed] = useState(false);
  const actionPending = useRef(false);
  const profileId = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [infoSent, setInfoSent] = useState(false);
  const [revision, setRevision] = useState(0);
  const [decisionReview, setDecisionReview] = useState<ConsultationOfferReview | null>(null);
  const [offerRecovery, setOfferRecovery] = useState<{
    review: ConsultationOfferReview;
    checked: boolean;
  } | null>(null);
  function clearPrivateDetail() {
    ++generation.current;
    profileId.current = null;
    setDetail(null);
    informationForm.reset({ reason: '' });
    pendingInformation.current = null;
    setInformationUnconfirmed(false);
    actionPending.current = false;
    setSending(false);
    setActionError(false);
    setInfoSent(false);
    setDecisionReview(null);
    setOfferRecovery(null);
  }
  useEffect(() => {
    clearPrivateDetail();
    return () => actionTransport.current?.abort();
  }, [scope]);
  useEffect(
    () => () => {
      ++generation.current;
    },
    []
  );
  const detailQueryKey = queryKeys.consultations.detail(
    {
      context: 'account',
      ownerId: actorId?.trim() ? actorId : reader,
      accountId: actorId,
      revision: profileRevision,
    },
    JSON.stringify([reader, scope, revision])
  );
  const detailQuery = useServerDetailQuery<Detail>({
    queryKey: detailQueryKey,
    enabled: false,
    manual: true,
    read: async (signal) => {
      const response = await fetch(`/api/consultations/requests/${encodeURIComponent(requestId)}`, {
        credentials: 'include',
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new ServerQueryError(response.status);
      const value = (await response.json()) as Detail;
      if (
        !value ||
        value.request?.id !== requestId ||
        !consultationUuid(value.request.profile_id) ||
        typeof value.request.status !== 'string' ||
        typeof value.request.product_snapshot?.title?.en !== 'string' ||
        typeof value.request.product_snapshot?.title?.fa !== 'string' ||
        !validTimestamp(value.request.submitted_at) ||
        typeof value.request.has_paid_invoice !== 'boolean' ||
        ![
          value.request.staff_owner_username,
          value.request.staff_owner_id,
          value.request.staff_team,
          value.request.scope,
          value.request.deliverables,
          value.request.expected_next_step,
          value.request.invoice_id,
          value.request.invoice_state,
        ].every(optionalText) ||
        ![value.request.offer_valid_until, value.request.accepted_at].every(
          (stamp) => stamp == null || validTimestamp(stamp)
        ) ||
        !Array.isArray(value.history) ||
        !value.history.every(
          (event) =>
            event &&
            typeof event.status === 'string' &&
            typeof event.actor_type === 'string' &&
            (event.reason === null || typeof event.reason === 'string') &&
            optionalText(event.actor_name) &&
            validTimestamp(event.created_at)
        ) ||
        !Array.isArray(value.adjustments) ||
        !Array.isArray(value.refunds)
      )
        throw new Error('request');
      if (
        (value.request.fee !== null &&
          (typeof value.request.fee !== 'string' || !/^[0-9]+$/.test(value.request.fee))) ||
        !value.adjustments.every(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.state === 'string' &&
            (item.adjustment_kind === 'charge' || item.adjustment_kind === 'credit') &&
            typeof item.amount === 'string' &&
            /^[0-9]+$/.test(item.amount)
        ) ||
        !value.refunds.every(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.state === 'string' &&
            typeof item.amount === 'string' &&
            /^[0-9]+$/.test(item.amount)
        )
      )
        throw new Error('request');
      return value;
    },
  });
  useEffect(() => {
    const controller = new AbortController();
    const capturedGeneration = generation.current;
    const recoveryAtRead = actionPending.current ? null : pendingInformation.current;
    const offerAtRead = actionPending.current ? null : offerRecovery;
    setLoading(true);
    setError(null);
    setDetail(null);
    void detailQuery
      .refetch()
      .then((reply) => {
        if (controller.signal.aborted || capturedGeneration !== generation.current)
          throw new Error('Abandoned consultation read');
        if (!reply.isSuccess || !reply.data) throw reply.error ?? new Error('request');
        return reply.data;
      })
      .then((result) => {
        if (controller.signal.aborted || capturedGeneration !== generation.current) return;
        if (profileId.current && profileId.current !== result.request.profile_id) {
          actionTransport.current?.abort();
          clearPrivateDetail();
        }
        if (offerAtRead && !actionPending.current) {
          const reviewed = offerAtRead.review;
          const request = result.request;
          const currentInvoice = request.invoice_id;
          const offerMoved =
            ['offer_accepted', 'offer_declined', 'completed', 'cancelled', 'rejected'].includes(
              request.status
            ) ||
            (typeof currentInvoice === 'string' &&
              consultationUuid(currentInvoice) &&
              currentInvoice !== reviewed.data.invoice.id);
          const newlyAccepted =
            reviewed.data.decision === 'accept' &&
            currentInvoice === reviewed.data.invoice.id &&
            reviewed.data.acceptedAt === null &&
            typeof request.accepted_at === 'string' &&
            Number.isFinite(Date.parse(request.accepted_at));
          setOfferRecovery((current) =>
            current === offerAtRead
              ? offerMoved || newlyAccepted
                ? null
                : { ...offerAtRead, checked: true }
              : current
          );
        }
        profileId.current = result.request.profile_id;
        if (
          recoveryAtRead &&
          pendingInformation.current === recoveryAtRead &&
          !actionPending.current &&
          confirmedConsultationInformation(result, recoveryAtRead)
        ) {
          pendingInformation.current = null;
          informationForm.reset({ reason: '' });
          setInformationUnconfirmed(false);
          setActionError(false);
          setInfoSent(true);
        }
        setAcceptedScope(scope);
        setDetail(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && capturedGeneration === generation.current) {
          if (reason instanceof ServerQueryError && [401, 403, 404].includes(reason.status)) {
            actionTransport.current?.abort();
            clearPrivateDetail();
            setError('notFound');
            return;
          }
          setDetail(null);
          setDecisionReview(null);
          setError('detailLoadError');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      void client.cancelQueries({ queryKey: detailQueryKey, exact: true });
    };
  }, [scope, revision]);

  function provideInfo(event: FormEvent<HTMLFormElement>) {
    if (
      actionPending.current ||
      pendingInformation.current ||
      informationUnconfirmed ||
      informationForm.isSubmissionPending() ||
      !detail ||
      detail.request.status !== 'awaiting_customer_info'
    ) {
      event.preventDefault();
      return;
    }
    const capturedGeneration = generation.current;
    const capturedDetail = detail;
    void informationForm.handleSubmit(async (draft) => {
      if (capturedGeneration !== generation.current) return;
      const command: ConsultationInformationCommand = {
        requestId,
        profileId: capturedDetail.request.profile_id,
        reason: draft.reason.trim(),
        history: capturedDetail.history.map((event) => ({ ...event })),
      };
      pendingInformation.current = command;
      const transport = new AbortController();
      actionTransport.current = transport;
      actionPending.current = true;
      setSending(true);
      setActionError(false);
      try {
        const { response, result } = await postConsultationAction(
          requestId,
          'provide-info',
          { reason: command.reason },
          transport.signal
        );
        if (capturedGeneration !== generation.current) return;
        if (!response.ok) {
          if (
            response.status === 400 &&
            result?.error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(result.error.fields) &&
            informationFields(result.error.fields)
          ) {
            pendingInformation.current = null;
            return;
          }
          if ([401, 403, 404].includes(response.status)) {
            setDetail(null);
            setDecisionReview(null);
            setError(response.status === 404 ? 'notFound' : 'detailLoadError');
          }
          if (definitiveConsultationRejection(response.status, result)) {
            pendingInformation.current = null;
            setInformationUnconfirmed(false);
            setActionError(true);
            return;
          }
          throw new Error('provide-info');
        }
        if (!consultationReceipt(result, command.requestId, 'under_review'))
          throw new Error('receipt');
        pendingInformation.current = null;
        informationForm.reset({ reason: '' });
        setInfoSent(true);
        setRevision((value) => value + 1);
      } catch {
        if (capturedGeneration === generation.current) {
          setActionError(true);
          setInformationUnconfirmed(true);
        }
      } finally {
        if (actionTransport.current === transport) actionTransport.current = null;
        if (capturedGeneration === generation.current) {
          actionPending.current = false;
          setSending(false);
        }
      }
    })(event);
  }

  function canReviewOffer(decision: 'accept' | 'decline') {
    return (
      !offerRecovery || (offerRecovery.checked && offerRecovery.review.data.decision === decision)
    );
  }

  async function beginDecision(decision: 'accept' | 'decline') {
    if (
      actionPending.current ||
      informationForm.isSubmissionPending() ||
      detail?.request.status !== 'offer_pending' ||
      !canReviewOffer(decision)
    )
      return;
    const capturedGeneration = generation.current;
    const transport = new AbortController();
    actionTransport.current = transport;
    actionPending.current = true;
    setSending(true);
    setActionError(false);
    try {
      const { response, result } = await postConsultationAction(
        requestId,
        'offer-review',
        { decision },
        transport.signal
      );
      if (capturedGeneration !== generation.current) return;
      if (!response.ok) throw new Error('offer-review');
      const review = parseConsultationOfferReview(result);
      const current = detail.request;
      if (
        !review ||
        review.scope.action !== `consultation.offer-${decision}` ||
        review.scope.resourceId !== requestId ||
        review.scope.profileId !== current.profile_id ||
        review.data.invoice.id !== current.invoice_id ||
        review.data.invoice.state !== current.invoice_state ||
        review.data.acceptedAt !== current.accepted_at ||
        review.data.validUntil !== current.offer_valid_until ||
        review.data.fee !== current.fee ||
        review.data.scope !== current.scope ||
        review.data.deliverables !== current.deliverables ||
        review.data.serviceTitle[locale] !== current.product_snapshot.title[locale]
      )
        throw new Error('Offer review differs from displayed offer');
      setDecisionReview(review);
    } catch {
      if (capturedGeneration === generation.current) {
        setActionError(true);
        setRevision((value) => value + 1);
      }
    } finally {
      if (actionTransport.current === transport) actionTransport.current = null;
      if (capturedGeneration === generation.current) {
        actionPending.current = false;
        setSending(false);
      }
    }
  }

  const financialGate = useRiskConfirmation(
    decisionReview,
    locale,
    decisionReview?.data.decision === 'decline' ? 'both' : 'financial'
  );
  async function decide() {
    if (
      !financialGate.allowed ||
      actionPending.current ||
      informationForm.isSubmissionPending() ||
      !decisionReview ||
      !canReviewOffer(decisionReview.data.decision)
    )
      return;
    const capturedGeneration = generation.current;
    const transport = new AbortController();
    actionTransport.current = transport;
    actionPending.current = true;
    const { decision, hash } = {
      decision: decisionReview.data.decision,
      hash: decisionReview.hash,
    };
    setSending(true);
    setActionError(false);
    try {
      const { response, result } = await postConsultationAction(
        requestId,
        decision,
        { expectedReviewHash: hash },
        transport.signal
      );
      if (capturedGeneration !== generation.current) return;
      setDecisionReview(null);
      if (!response.ok && definitiveConsultationRejection(response.status, result)) {
        setActionError(true);
        setRevision((value) => value + 1);
        return;
      }
      const receipt = parseConsultationOfferReview(result?.financialReview);
      const paymentRequired = decisionReview.data.outcome === 'payment_required';
      const expectedStatus =
        decision === 'decline'
          ? 'offer_declined'
          : paymentRequired
            ? 'offer_pending'
            : 'offer_accepted';
      if (
        !response.ok ||
        !consultationReceipt(result, requestId, expectedStatus) ||
        !receipt ||
        receipt.hash !== hash ||
        JSON.stringify(receipt) !== JSON.stringify(decisionReview) ||
        (decision === 'accept' &&
          (result.invoiceId !== receipt.data.invoice.id ||
            result.paymentRequired !== paymentRequired))
      )
        throw new Error('Unverified offer decision');
      setOfferRecovery(null);
      if (paymentRequired) {
        void navigate({
          to: '/invoices/$invoiceId',
          params: { invoiceId: receipt.data.invoice.id },
        });
        return;
      }
      setRevision((value) => value + 1);
    } catch {
      if (capturedGeneration === generation.current) {
        setDecisionReview(null);
        setOfferRecovery({ review: decisionReview, checked: false });
        setRevision((value) => value + 1);
      }
    } finally {
      if (actionTransport.current === transport) actionTransport.current = null;
      if (capturedGeneration === generation.current) {
        actionPending.current = false;
        setSending(false);
      }
    }
  }

  const request = detail?.request;
  const offerExpired =
    !!request?.offer_valid_until &&
    new Date(request.offer_valid_until) <= new Date() &&
    request.invoice_state !== 'Paid' &&
    !request.accepted_at;
  const refundPending =
    detail?.refunds.some(
      (refund) => !['Completed', 'Rejected', 'Cancelled'].includes(refund.state)
    ) ?? false;
  const action = request ? consultationNextAction(request, refundPending, locale) : null;
  const latestEvent = detail?.history.at(-1);
  return (
    <section
      className="mx-auto max-w-3xl space-y-6 px-4 py-8"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <Link to="/consultations" className="touch-action text-sm text-primary underline">
        {copy('back')}
      </Link>
      <h1 className="text-3xl font-semibold">{copy('details')}</h1>
      {error !== 'notFound' && (
        <Button
          type="button"
          variant="outline"
          disabled={sending || informationForm.formState.isSubmitting || loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          {copy('informationReload')}
        </Button>
      )}
      {time.notice}
      {loading && <LoadingStatus>{copy('loading')}</LoadingStatus>}
      {error && (
        <p role="alert">
          {error === 'notFound' ? loadingText('recordUnavailable', locale) : copy(error)}
        </p>
      )}
      <CommandFeedback
        kind="error"
        message={offerRecovery ? copy('decisionUnconfirmed') : null}
        className="text-destructive"
      />
      {request && (
        <>
          <WorkflowStatusBanner
            locale={locale}
            submittedAt={`${workflowFeedback('submitted', locale)}: ${time.format(request.submitted_at)}`}
            status={copy(`status_${request.status}`)}
            happened={
              latestEvent?.reason ??
              `${copy(`status_${latestEvent?.status ?? request.status}`)} · ${time.format(latestEvent?.created_at ?? request.submitted_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}`
            }
            nextAction={action!.text}
            owner={action!.owner}
            actionHref={action?.href}
          />
          <section className="space-y-3 rounded-xl border bg-card p-5 wrap-anywhere">
            <h2 className="text-xl font-semibold" dir="auto">
              {request.product_snapshot.title[locale]}
            </h2>
            <p>
              {copy('submittedAt')}:{' '}
              <time dateTime={request.submitted_at}>
                {time.format(request.submitted_at, {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })}
              </time>
            </p>
            <p>
              {copy('owner')}:{' '}
              <span dir="auto">
                {request.staff_owner_username ??
                  (request.staff_owner_id
                    ? copy('assignedStaff')
                    : request.staff_team
                      ? copy('awaitingOwner')
                      : copy('unassigned'))}
              </span>
            </p>
            {request.staff_team && (
              <p>
                {copy('team')}: <span dir="auto">{request.staff_team}</span>
              </p>
            )}
            {request.fee ? (
              <p>
                {copy('fee')}: {new Intl.NumberFormat(locale).format(BigInt(request.fee))} IRR
              </p>
            ) : (
              <p className="text-muted-foreground">{copy('noFee')}</p>
            )}
            {request.scope && (
              <p>
                {copy('scope')}: <span dir="auto">{request.scope}</span>
              </p>
            )}
            {request.deliverables && (
              <p>
                {copy('deliverables')}: <span dir="auto">{request.deliverables}</span>
              </p>
            )}
            {request.offer_valid_until && (
              <p>
                {copy('offerValidUntil')}:{' '}
                <time dateTime={request.offer_valid_until}>
                  {time.format(request.offer_valid_until)}
                </time>
              </p>
            )}
            {request.invoice_id && request.accepted_at && (
              <p>
                <Link
                  className="text-primary underline"
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: request.invoice_id }}
                >
                  {copy('viewInvoice')}
                </Link>
              </p>
            )}
          </section>
          {(detail.adjustments.length > 0 || detail.refunds.length > 0) && (
            <section className="space-y-3 rounded-xl border bg-card p-5">
              <h2 className="text-xl font-semibold">{copy('financialActivity')}</h2>
              {['cancelled', 'rejected'].includes(request.status) &&
                detail.refunds.some(
                  (refund) => !['Completed', 'Rejected', 'Cancelled'].includes(refund.state)
                ) && <p role="status">{copy('paidClosurePending')}</p>}
              {detail.adjustments.map((item) => (
                <p key={item.id}>
                  {copy(
                    item.adjustment_kind === 'credit' ? 'creditAdjustment' : 'chargeAdjustment'
                  )}
                  : {new Intl.NumberFormat(locale).format(BigInt(item.amount))} IRR
                  {item.adjustment_kind === 'charge' && ` · ${copy(`invoice_state_${item.state}`)}`}
                </p>
              ))}
              {detail.refunds.map((item) => (
                <p key={item.id}>
                  {copy('refundRequest')}:{' '}
                  {new Intl.NumberFormat(locale).format(BigInt(item.amount))} IRR ·{' '}
                  {copy(`refund_state_${item.state}`)}
                </p>
              ))}
            </section>
          )}
          {request.status === 'offer_pending' && (
            <section id="consultation-offer" className="space-y-3 rounded-xl border bg-card p-5">
              <OrderWalletBalance
                profileId={request.profile_id}
                scopeKey={JSON.stringify([
                  scope,
                  requestId,
                  request.fee,
                  request.invoice_id,
                  request.invoice_state,
                ])}
              />
              {offerExpired && <p role="status">{copy('offerExpired')}</p>}
              {request.invoice_state === 'PaymentUnderReview' ? (
                <p>{copy('paymentUnderReview')}</p>
              ) : request.accepted_at && request.invoice_state !== 'Paid' ? (
                <p>{copy('acceptedAwaitingPayment')}</p>
              ) : (
                <p>{copy('reviewOffer')}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {(!request.accepted_at || request.invoice_state === 'Paid') && (
                  <Button
                    type="button"
                    disabled={sending || offerExpired || !canReviewOffer('accept')}
                    onClick={() => void beginDecision('accept')}
                  >
                    {copy(request.invoice_state === 'Paid' ? 'confirmAcceptance' : 'acceptOffer')}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    sending ||
                    request.invoice_state === 'Paid' ||
                    request.has_paid_invoice ||
                    !canReviewOffer('decline')
                  }
                  onClick={() => void beginDecision('decline')}
                >
                  {copy('declineOffer')}
                </Button>
              </div>
              {request.has_paid_invoice && <p>{copy('paidDeclineHelp')}</p>}
              {actionError && (
                <p role="alert" className="text-destructive">
                  {copy('actionError')}
                </p>
              )}
            </section>
          )}
          {(request.status === 'awaiting_customer_info' ||
            (informationUnconfirmed && pendingInformation.current)) && (
            <Form {...informationForm}>
              <div role="group" aria-label={copy('information')}>
                <form
                  id="consultation-information-form"
                  onSubmit={provideInfo}
                  noValidate
                  className="space-y-3 rounded-xl border bg-card p-5"
                >
                  {informationForm.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('validationUnavailable')}</AlertDescription>
                    </Alert>
                  )}
                  <FormField
                    control={informationForm.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem id="consultation-information">
                        <FormLabel>{copy('information')}</FormLabel>
                        <FormControl>
                          <textarea
                            {...field}
                            aria-required="true"
                            disabled={
                              sending ||
                              informationForm.formState.isSubmitting ||
                              informationUnconfirmed
                            }
                            className="min-h-28 w-full rounded-md border bg-background p-3"
                          />
                        </FormControl>
                        <FormDescription>{copy('informationHelp')}</FormDescription>
                        <div className="grid">
                          <p
                            aria-hidden="true"
                            className="invisible col-start-1 row-start-1 text-sm"
                          >
                            {copy('informationInvalid')}
                          </p>
                          <FormMessage className="col-start-1 row-start-1" />
                        </div>
                      </FormItem>
                    )}
                  />
                  {actionError && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {copy(informationUnconfirmed ? 'informationUnconfirmed' : 'actionError')}
                      </AlertDescription>
                    </Alert>
                  )}
                  <Button
                    type="submit"
                    loading={informationForm.formState.isSubmitting || sending}
                    disabled={
                      sending || informationForm.formState.isSubmitting || informationUnconfirmed
                    }
                  >
                    {copy('provideInfo')}
                  </Button>
                </form>
              </div>
            </Form>
          )}
          <CommandFeedback message={infoSent ? copy('infoSent') : null} />
          <section className="space-y-3">
            <h2 className="text-xl font-semibold">{copy('history')}</h2>
            <StatusTimeline
              label={copy('history')}
              items={detail.history.map((event, index) => ({
                id: `${event.created_at}-${index}`,
                title:
                  copy(`status_${event.status}`) === `status_${event.status}`
                    ? copy('status_unknown')
                    : copy(`status_${event.status}`),
                state: event.status,
                dateTime: event.created_at,
                dateLabel: time.format(event.created_at),
                actorLabel: `${copy('actor')}: ${[['staff', 'customer', 'unknown'].includes(event.actor_type) ? event.actor_name : null, historyContextText(event.actor_type, locale)].filter(Boolean).join(' · ')}`,
                description: event.reason ? `${copy('reason')}: ${event.reason}` : undefined,
              }))}
            />
          </section>
        </>
      )}
      <Dialog
        open={Boolean(decisionReview)}
        onOpenChange={(open) => {
          if (!open && !sending) setDecisionReview(null);
        }}
      >
        <DialogContent
          dir={locale === 'fa' ? 'rtl' : 'ltr'}
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{copy('decisionReviewTitle')}</DialogTitle>
            <DialogDescription>
              {copy(
                decisionReview?.data.decision === 'decline'
                  ? 'decisionReviewDecline'
                  : 'decisionReviewAccept'
              )}
            </DialogDescription>
          </DialogHeader>
          {decisionReview && (
            <>
              <FinancialReviewSummary
                title={copy('decisionReviewTitle')}
                rows={[
                  {
                    id: 'service',
                    label: copy('details'),
                    value: decisionReview.data.serviceTitle[locale],
                  },
                  { id: 'scope', label: copy('scope'), value: decisionReview.data.scope },
                  {
                    id: 'deliverables',
                    label: copy('deliverables'),
                    value: decisionReview.data.deliverables,
                  },
                  {
                    id: 'validity',
                    label: copy('offerValidUntil'),
                    value: time.format(decisionReview.data.validUntil),
                  },
                  {
                    id: 'invoice',
                    label: copy('decisionReviewInvoice'),
                    value: decisionReview.data.invoice.id,
                  },
                  ...(decisionReview.data.invoice.adjustmentKind === 'charge'
                    ? [
                        {
                          id: 'previous-fee',
                          label: copy('decisionReviewPreviousFee'),
                          value: numbers.money(decisionReview.data.previousFee),
                        },
                      ]
                    : []),
                  {
                    id: 'invoice-amount',
                    label: copy('decisionReviewInvoiceAmount'),
                    value: numbers.money(decisionReview.data.invoice.totalAmount),
                  },
                  {
                    id: 'paid',
                    label: copy('decisionReviewAlreadyPaid'),
                    value: numbers.money(decisionReview.data.invoice.paidAmount),
                  },
                ]}
                total={{ label: copy('fee'), value: numbers.money(decisionReview.data.fee) }}
                notice={copy(
                  decisionReview.data.outcome === 'cancel_unpaid_invoice'
                    ? 'decisionReviewCancelOutcome'
                    : decisionReview.data.outcome === 'accepted_paid'
                      ? 'decisionReviewPaidOutcome'
                      : 'decisionReviewPaymentOutcome'
                )}
              />
              <OrderWalletBalance
                profileId={decisionReview.scope.profileId}
                total={
                  decisionReview.data.decision === 'accept'
                    ? decisionReview.data.invoice.totalAmount
                    : '0'
                }
                paid={decisionReview.data.invoice.paidAmount}
                invoiceId={decisionReview.data.invoice.id}
                scopeKey={decisionReview.hash}
              />
            </>
          )}
          <ConfirmationFields gate={financialGate} disabled={sending} />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={sending}
              onClick={() => setDecisionReview(null)}
            >
              {copy('decisionReviewClose')}
            </Button>
            <Button
              type="button"
              variant={decisionReview?.data.decision === 'decline' ? 'destructive' : 'warning'}
              disabled={sending || !financialGate.allowed}
              onClick={() => void decide()}
            >
              {copy(decisionReview?.data.decision === 'decline' ? 'declineOffer' : 'acceptOffer')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
