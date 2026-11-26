import { RecordEditorActions, recordEditorSurface } from '../components/RecordEditorLayout.js';
import { CompactFieldFeedback } from '../components/CompactFieldFeedback.js';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { CommandFeedback } from '../components/CommandFeedback.js';
import { ConfirmationFields } from '@barghsa/ui';
import { useRiskConfirmation } from '../hooks/useRiskConfirmation.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { formatToman } from '@barghsa/i18n/numbers';
import { ArrowLeft, ArrowRight, ChevronDownIcon } from 'lucide-react';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { historyContextText } from '../lib/history-context.js';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  LoadingStatus,
  StatusBadge,
  Button,
  Alert,
  AlertDescription,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ListRefreshButton,
  StatusTimeline,
  Textarea,
} from '@barghsa/ui';
import { Form, FormControl, FormField, FormItem, FormLabel, useZodForm } from '@barghsa/ui/form';
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
import { t } from '@barghsa/i18n/app';
import { tConsultationBrief } from '@barghsa/i18n/consultation-intake';
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
import { RecordDetailSkeleton } from '../components/RecordSkeleton.js';
import { statusFilterTone } from '../lib/status-filter-tone.js';
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

export function ConsultationDetailPage({
  requestId,
  view = 'detail',
}: {
  requestId: string;
  view?: 'detail' | 'reply' | 'offer';
}) {
  const reply = view === 'reply';
  const offer = view === 'offer';
  const editor = view !== 'detail';
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
  const decisionTitle = useRef<HTMLHeadingElement>(null);
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

  const reviewedOffer = decisionReview?.data;
  const reviewedFee = reviewedOffer ? numbers.money(reviewedOffer.fee) : '—';
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
        actionPending.current = false;
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
  const invoiceStateKey = `invoice_state_${request?.invoice_state}`;
  const invoiceState = copy(invoiceStateKey);
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
  const submittedBrief = detail?.history.find(
    (event) =>
      event.status === 'submitted' && event.actor_type === 'customer' && event.reason?.trim()
  );
  const informationPrompt =
    request?.status === 'awaiting_customer_info' && detail
      ? [...detail.history]
          .reverse()
          .find(
            (event) =>
              event.status === 'awaiting_customer_info' &&
              event.actor_type === 'staff' &&
              event.reason?.trim()
          )
      : undefined;
  const showReply =
    request &&
    !infoSent &&
    (request.status === 'awaiting_customer_info' ||
      (informationUnconfirmed && pendingInformation.current));
  const busy = sending || informationForm.formState.isSubmitting;
  const reload = () => {
    if (!actionPending.current && !informationForm.isSubmissionPending())
      setRevision((value) => value + 1);
  };
  return (
    <section
      className={
        editor
          ? 'mx-auto max-w-2xl space-y-4 px-4 py-4 sm:py-5'
          : 'mx-auto w-full max-w-5xl min-w-0 space-y-4'
      }
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {editor && (
        <RecordCommandGuard
          blocked={() => actionPending.current || informationForm.isSubmissionPending()}
        />
      )}
      <header className="space-y-1" data-toast-anchor>
        {editor ? (
          <Link
            to="/consultations/$requestId"
            params={{ requestId }}
            disabled={busy}
            className="touch-action w-fit text-sm text-primary underline underline-offset-4 aria-disabled:opacity-60"
          >
            {copy(reply ? 'replyBack' : 'backToRequest')}
          </Link>
        ) : (
          <Link
            to="/consultations"
            className="touch-action inline-flex w-fit items-center gap-2 text-sm font-medium text-primary hover:underline underline-offset-4"
          >
            <ArrowLeft aria-hidden="true" className="size-4 rtl:hidden" />
            <ArrowRight aria-hidden="true" className="hidden size-4 rtl:block" />
            {copy('back')}
          </Link>
        )}
        <div
          className={
            editor
              ? 'flex flex-wrap items-center justify-between gap-2'
              : loading
                ? 'sr-only'
                : 'flex flex-wrap items-start justify-between gap-3 rounded-xl border bg-card p-4 sm:p-6'
          }
        >
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl leading-tight font-semibold sm:text-3xl">
              {copy(reply ? 'replyTitle' : offer ? 'offerPageTitle' : 'details')}
            </h1>
            {!editor && request && (
              <div className="space-y-1.5">
                <h2 className="text-base font-medium wrap-anywhere">
                  <bdi>{request.product_snapshot.title[locale]}</bdi>
                </h2>
                <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">
                      {t('historySearch.reference', locale)}
                    </dt>
                    <dd className="mt-1 wrap-anywhere">
                      <bdi>{request.id}</bdi>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{copy('submittedAt')}</dt>
                    <dd className="mt-1">
                      <time dateTime={request.submitted_at}>
                        {time.format(request.submitted_at, {
                          year: 'numeric',
                          month: '2-digit',
                          day: '2-digit',
                        })}
                      </time>
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>
          {error !== 'notFound' &&
            (reply && informationUnconfirmed ? (
              <Button
                variant="outline"
                size="sm"
                loading={loading}
                disabled={busy}
                onClick={reload}
              >
                {copy('informationReload')}
              </Button>
            ) : (
              <ListRefreshButton
                label={copy('informationReload')}
                refreshing={loading}
                disabled={busy}
                onClick={reload}
              />
            ))}
        </div>
        {editor && request && (
          <p dir="auto" className="text-sm text-muted-foreground wrap-anywhere">
            {request.product_snapshot.title[locale]}
          </p>
        )}
      </header>
      {time.notice}
      {loading &&
        (editor ? (
          <LoadingStatus>{copy('loading')}</LoadingStatus>
        ) : (
          <RecordDetailSkeleton label={copy('loading')} layout="order" />
        ))}
      {error && (
        <p role="alert">
          {error === 'notFound' ? loadingText('recordUnavailable', locale) : copy(error)}
        </p>
      )}
      {offerRecovery && (
        <p role="alert" className="text-destructive">
          {copy('decisionUnconfirmed')}
        </p>
      )}
      {reply && <CommandFeedback message={infoSent ? copy('infoSent') : null} />}
      {reply && request && !showReply && !infoSent && (
        <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
          {copy('replyUnavailable')}
        </p>
      )}
      {reply && showReply && (
        <Form {...informationForm}>
          <div role="group" aria-label={copy('information')}>
            <form
              id="consultation-information-form"
              onSubmit={provideInfo}
              noValidate
              className={recordEditorSurface}
            >
              {informationPrompt?.reason && (
                <div className="space-y-1 border-b bg-muted/30 px-4 py-3 sm:px-6">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 className="text-sm font-semibold">{copy('informationRequested')}</h2>
                    <time
                      dateTime={informationPrompt.created_at}
                      className="text-xs text-muted-foreground"
                    >
                      {time.format(informationPrompt.created_at, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                  </div>
                  <p dir="auto" className="text-sm whitespace-pre-wrap wrap-anywhere">
                    {informationPrompt.reason}
                  </p>
                </div>
              )}
              <div className="space-y-3 px-4 py-4 sm:px-6">
                {informationForm.formState.errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>{copy('validationUnavailable')}</AlertDescription>
                  </Alert>
                )}
                <FormField
                  control={informationForm.control}
                  name="reason"
                  render={({ field, fieldState }) => (
                    <FormItem id="consultation-information">
                      <FormLabel>{copy('information')}</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          aria-required="true"
                          rows={2}
                          dir="auto"
                          disabled={busy || informationUnconfirmed}
                          className="max-h-56 min-h-14"
                        />
                      </FormControl>
                      <CompactFieldFeedback
                        help={copy('informationHelp')}
                        validationMessage={copy('informationInvalid')}
                        invalid={!!fieldState.error?.message}
                      />
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
              </div>
              <RecordEditorActions className="max-sm:justify-start">
                <Button type="submit" loading={busy} disabled={busy || informationUnconfirmed}>
                  {copy('provideInfo')}
                </Button>
              </RecordEditorActions>
            </form>
          </div>
        </Form>
      )}
      {offer &&
        request &&
        (request.status === 'offer_pending' ? (
          <section
            id="consultation-offer"
            aria-labelledby="consultation-offer-heading"
            className={recordEditorSurface}
          >
            <div className="space-y-2.5 border-b bg-muted/25 px-4 py-3 sm:px-6">
              <h2 id="consultation-offer-heading" className="text-base font-semibold">
                {copy('savedOffer')}
              </h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:grid-cols-3">
                <div className="col-span-2 min-w-0 sm:col-span-1">
                  <dt className="text-muted-foreground">{copy('fee')}</dt>
                  <dd className="text-lg font-semibold wrap-anywhere">
                    {request.fee ? numbers.money(request.fee) : copy('noFee')}
                  </dd>
                </div>
                {request.offer_valid_until && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{copy('offerValidUntil')}</dt>
                    <dd>
                      <time dateTime={request.offer_valid_until}>
                        {time.format(request.offer_valid_until)}
                      </time>
                    </dd>
                  </div>
                )}
                {request.invoice_state && (
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">{copy('invoiceStatus')}</dt>
                    <dd>
                      {invoiceState === invoiceStateKey
                        ? copy('unknownInvoiceStatus')
                        : invoiceState}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
            <div className="space-y-3 px-4 py-4 text-sm sm:px-6">
              {(request.scope || request.deliverables) && (
                <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {request.scope && (
                    <div className="min-w-0">
                      <dt className="font-semibold">{copy('scope')}</dt>
                      <dd dir="auto" className="mt-1 whitespace-pre-line wrap-anywhere">
                        {request.scope}
                      </dd>
                    </div>
                  )}
                  {request.deliverables && (
                    <div className="min-w-0">
                      <dt className="font-semibold">{copy('deliverables')}</dt>
                      <dd dir="auto" className="mt-1 whitespace-pre-line wrap-anywhere">
                        {request.deliverables}
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {offerExpired && <p role="status">{copy('offerExpired')}</p>}
              {request.invoice_state === 'PaymentUnderReview' ? (
                <p>{copy('paymentUnderReview')}</p>
              ) : request.accepted_at && request.invoice_state !== 'Paid' ? (
                <p>{copy('acceptedAwaitingPayment')}</p>
              ) : (
                <p>{copy('reviewOffer')}</p>
              )}
              {request.has_paid_invoice && <p>{copy('paidDeclineHelp')}</p>}
              {actionError && (
                <p role="alert" className="text-destructive">
                  {copy('actionError')}
                </p>
              )}
            </div>
            <RecordEditorActions className="max-sm:justify-start">
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
              {request.invoice_id && request.accepted_at && request.invoice_state !== 'Paid' && (
                <Link
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: request.invoice_id }}
                  className="touch-action text-sm text-primary underline underline-offset-4"
                  disabled={busy}
                >
                  {copy('viewInvoice')}
                </Link>
              )}
            </RecordEditorActions>
          </section>
        ) : (
          <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm">
            {['offer_accepted', 'offer_declined'].includes(request.status)
              ? copy(`status_${request.status}`)
              : copy('offerPageUnavailable')}
          </p>
        ))}
      {!editor && request && (
        <>
          <WorkflowStatusBanner
            locale={locale}
            status={copy(`status_${request.status}`)}
            statusSummary={
              <dl className="text-sm">
                <div className="flex items-center gap-2">
                  <dt className="text-muted-foreground">{copy('status')}</dt>
                  <dd>
                    <StatusBadge
                      label={copy(`status_${request.status}`)}
                      tone={statusFilterTone(request.status)}
                    />
                  </dd>
                </div>
              </dl>
            }
            happened={
              latestEvent &&
              latestEvent !== submittedBrief &&
              latestEvent !== informationPrompt &&
              latestEvent.reason
                ? latestEvent.reason
                : latestEvent && latestEvent.status !== request.status
                  ? copy(`status_${latestEvent.status}`)
                  : copy(`status_${request.status}`)
            }
            nextAction={action!.text}
            owner={action!.owner}
            actionHref={action?.href}
          />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{copy('owner')}</h2>
              <p dir="auto" className="text-sm font-medium wrap-anywhere">
                {request.staff_owner_username ??
                  (request.staff_owner_id
                    ? copy('assignedStaff')
                    : request.staff_team
                      ? copy('awaitingOwner')
                      : copy('unassigned'))}
              </p>
              {request.staff_team && (
                <dl className="text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">{copy('team')}</dt>
                    <dd className="mt-1 wrap-anywhere">
                      <bdi>{request.staff_team}</bdi>
                    </dd>
                  </div>
                </dl>
              )}
            </section>
            <section className="min-w-0 space-y-3 rounded-xl border bg-card p-4 sm:p-6">
              <h2 className="font-semibold">{copy('fee')}</h2>
              {request.fee ? (
                <p className="text-xl font-semibold tabular-nums wrap-anywhere">
                  <bdi>{new Intl.NumberFormat(locale).format(BigInt(request.fee))} IRR</bdi>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{copy('noFee')}</p>
              )}
              {(request.scope || request.deliverables || request.offer_valid_until) && (
                <dl className="space-y-3 border-t pt-3 text-sm [&_dt]:text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:wrap-anywhere">
                  {request.scope && (
                    <div>
                      <dt>{copy('scope')}</dt>
                      <dd dir="auto" className="whitespace-pre-wrap">
                        {request.scope}
                      </dd>
                    </div>
                  )}
                  {request.deliverables && (
                    <div>
                      <dt>{copy('deliverables')}</dt>
                      <dd dir="auto" className="whitespace-pre-wrap">
                        {request.deliverables}
                      </dd>
                    </div>
                  )}
                  {request.offer_valid_until && (
                    <div>
                      <dt>{copy('offerValidUntil')}</dt>
                      <dd>
                        <time dateTime={request.offer_valid_until}>
                          {time.format(request.offer_valid_until)}
                        </time>
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {request.invoice_id && request.accepted_at && (
                <Link
                  className="touch-action text-sm font-medium text-primary hover:underline underline-offset-4"
                  to="/invoices/$invoiceId"
                  params={{ invoiceId: request.invoice_id }}
                >
                  {copy('viewInvoice')}
                </Link>
              )}
            </section>
          </div>
          {submittedBrief?.reason && (
            <section
              className="space-y-2 rounded-xl border bg-card p-5"
              aria-labelledby="consultation-submitted-brief"
            >
              <h2 id="consultation-submitted-brief" className="font-semibold">
                {tConsultationBrief('submittedBrief', locale)}
              </h2>
              <p dir="auto" className="whitespace-pre-wrap wrap-anywhere">
                {submittedBrief.reason}
              </p>
            </section>
          )}
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
          {request.status === 'offer_pending' &&
            action?.href !== `/consultations/${encodeURIComponent(requestId)}/offer` && (
              <Link
                to="/consultations/$requestId/offer"
                params={{ requestId }}
                className="touch-action w-fit text-sm text-primary underline underline-offset-4"
              >
                {copy('openOffer')}
              </Link>
            )}
          {detail.history.length > 0 && (
            <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-6">
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
                  description:
                    event !== submittedBrief && event.reason
                      ? `${copy('reason')}: ${event.reason}`
                      : undefined,
                }))}
              />
            </section>
          )}
        </>
      )}
      {offer && (
        <Dialog
          open={Boolean(decisionReview)}
          onOpenChange={(open) => {
            if (!open && !sending) setDecisionReview(null);
          }}
        >
          <DialogContent
            dir={locale === 'fa' ? 'rtl' : 'ltr'}
            className="max-h-[calc(100dvh-2rem)] gap-3 overflow-y-auto p-4 sm:max-w-lg sm:p-6"
            initialFocus={decisionTitle}
          >
            <DialogHeader>
              <DialogTitle ref={decisionTitle} tabIndex={-1}>
                {copy('decisionReviewTitle')}
              </DialogTitle>
              <DialogDescription className="rounded-lg bg-muted px-3 py-2 text-start text-foreground">
                {copy(
                  reviewedOffer?.outcome === 'cancel_unpaid_invoice'
                    ? 'decisionReviewCancelOutcome'
                    : reviewedOffer?.outcome === 'accepted_paid'
                      ? 'decisionReviewPaidOutcome'
                      : 'decisionReviewPaymentOutcome'
                )}
              </DialogDescription>
            </DialogHeader>
            {decisionReview && reviewedOffer && (
              <>
                <section
                  aria-label={copy('savedOffer')}
                  className="min-w-0 space-y-3 rounded-lg border p-3"
                >
                  <div className="space-y-2 rounded-md bg-primary/5 p-3">
                    <p dir="auto" className="text-sm font-semibold wrap-anywhere">
                      {reviewedOffer.serviceTitle[locale]}
                    </p>
                    <dl>
                      <dt className="text-muted-foreground">{copy('fee')}</dt>
                      <dd className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 wrap-anywhere tabular-nums">
                        <bdi className="min-w-0 text-xl font-semibold">{reviewedFee}</bdi>
                        {reviewedFee !== '—' && (
                          <bdi className="min-w-0 text-sm text-muted-foreground">
                            {formatToman(reviewedOffer.fee, locale, {
                              numberStyle: numbers.numberStyle,
                            })}{' '}
                            {confirmationText('toman', locale)}
                          </bdi>
                        )}
                      </dd>
                    </dl>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-1 text-sm">
                    {[
                      ...(reviewedOffer.invoice.adjustmentKind === 'charge'
                        ? [
                            {
                              label: 'decisionReviewPreviousFee',
                              amount: reviewedOffer.previousFee,
                            },
                          ]
                        : []),
                      {
                        label: 'decisionReviewInvoiceAmount',
                        amount: reviewedOffer.invoice.totalAmount,
                      },
                      {
                        label: 'decisionReviewAlreadyPaid',
                        amount: reviewedOffer.invoice.paidAmount,
                      },
                    ].map(({ label, amount }) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-muted-foreground">{copy(label)}</dt>
                        <dd className="mt-1 font-medium wrap-anywhere tabular-nums">
                          <bdi>{numbers.money(amount)}</bdi>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <details className="group border-t">
                    <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-1 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                      {copy('details')}
                      <ChevronDownIcon
                        aria-hidden="true"
                        className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                      />
                    </summary>
                    <dl className="grid min-w-0 grid-cols-1 gap-3 px-1 pb-2 text-sm">
                      <div className="min-w-0">
                        <dt className="font-medium">{copy('scope')}</dt>
                        <dd className="mt-1 min-w-0 px-1">
                          <bdi
                            dir="auto"
                            className="block text-start whitespace-pre-line wrap-anywhere"
                          >
                            {reviewedOffer.scope}
                          </bdi>
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="font-medium">{copy('deliverables')}</dt>
                        <dd className="mt-1 min-w-0 px-1">
                          <bdi
                            dir="auto"
                            className="block text-start whitespace-pre-line wrap-anywhere"
                          >
                            {reviewedOffer.deliverables}
                          </bdi>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy('offerValidUntil')}</dt>
                        <dd>
                          <time dateTime={reviewedOffer.validUntil}>
                            {time.format(reviewedOffer.validUntil)}
                          </time>
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">{copy('decisionReviewInvoice')}</dt>
                        <dd className="wrap-anywhere">
                          <bdi dir="ltr">{reviewedOffer.invoice.id}</bdi>
                        </dd>
                      </div>
                    </dl>
                  </details>
                </section>
                <div className="rounded-md border px-3 py-2 [&_button]:self-start">
                  <OrderWalletBalance
                    profileId={decisionReview.scope.profileId}
                    total={
                      reviewedOffer.decision === 'accept' ? reviewedOffer.invoice.totalAmount : '0'
                    }
                    paid={reviewedOffer.invoice.paidAmount}
                    invoiceId={reviewedOffer.invoice.id}
                    scopeKey={decisionReview.hash}
                  />
                </div>
              </>
            )}
            <ConfirmationFields gate={financialGate} disabled={sending} />
            <DialogFooter className="grid grid-cols-2 gap-2 [&>button]:h-auto [&>button]:min-h-11 [&>button]:whitespace-normal sm:flex">
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
                {copy(
                  reviewedOffer?.decision === 'decline'
                    ? 'declineOffer'
                    : reviewedOffer?.outcome === 'accepted_paid'
                      ? 'confirmAcceptance'
                      : 'acceptOffer'
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
