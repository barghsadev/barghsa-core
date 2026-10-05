import { useEffect, useRef, useState, type FormEvent } from 'react';
import { tSolar } from '@barghsa/i18n/solar';
import { Alert, AlertDescription, Button, FinancialReviewSummary, ListPage } from '@barghsa/ui';
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
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import {
  confirmedPostalDecision,
  confirmedPostalGuidance,
  emptyPostalGuidance,
  postalGuidanceBody,
  postalGuidanceDraft,
  validPostalGuidance,
  type PostalGuidanceDraft,
} from '../lib/solar-postal-form.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { SolarPostalTrackingEditor } from '../components/SolarPostalTrackingEditor.js';
import { postalCalendarDate } from '../lib/solar-postal-tracking.js';
import { SolarContractForm } from '../components/SolarContractForm.js';
import { withCsrf } from '../lib/csrf.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';

interface Guidance {
  fa: string;
  en: string;
  destinationAddress: string;
  contactDetails: string;
  originals: Array<{ fa: string; en: string }>;
}
interface Row {
  id: string;
  profile_id: string;
  profile_name: string;
  request_status: string;
  postal_status: string;
  courier: string | null;
  tracking_number: string | null;
  send_date: string | null;
  receipt_image_id: string | null;
  staff_notes: string | null;
  created_at: string;
  tracking_revision?: number;
}

type PostalLane = 'needs_staff' | 'waiting_customer' | 'all';
type FinalDecision = 'approve' | 'reject' | 'close-no-contract';
interface FinalReview {
  hash: string;
  data: {
    requestId: string;
    currentStatus: string;
    postalStatus: string | null;
    trackingNumber: string | null;
    reason: string | null;
    outcome: string;
  };
}
interface PostalReview {
  hash: string;
  data: {
    requestId: string;
    currentRequestStatus: string;
    currentPostalStatus: string;
    courier: string | null;
    trackingNumber: string | null;
    sendDate: string | null;
    receiptImageId: string | null;
    reason: string | null;
    postalOutcome: string;
    requestOutcome: string;
  };
}

export function AdminSolarPostalPage({ queries }: { queries?: ListQueryBinding } = {}) {
  const actor = useAccountUser();
  return <AdminSolarPostalWorkspace key={actor ?? ''} {...(queries ? { queries } : {})} />;
}
function AdminSolarPostalWorkspace({ queries }: { queries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [rows, setRows] = useState<Row[]>([]);
  const [localLane, setLane] = useState<PostalLane>('needs_staff');
  const lane = (queries?.query.filters.lane || localLane) as PostalLane;
  const [acceptedLane, setAcceptedLane] = useState(lane);
  const visibleRows = acceptedLane === lane ? rows : [];
  const [guidance, setGuidance] = useState<Guidance | null>(null);
  const reasonForm = useZodForm<{ reason: string }>(
    async () =>
      (await import('../lib/solar-postal-form-schemas.js')).postalReasonSchema(
        copy('postalReasonInvalid')
      ),
    {
      defaultValues: { reason: '' },
      validationUnavailableMessage: copy('documentValidationUnavailable'),
    }
  );
  const reasonFields = useActionFieldErrors(
    reasonForm,
    { reason: copy('postalReasonInvalid') },
    copy('postalError')
  );
  const guidanceMessages = {
    fa: copy('documentGuidanceInvalid'),
    en: copy('documentGuidanceInvalid'),
    destinationAddress: copy('postalAddressInvalid'),
    contactDetails: copy('postalContactInvalid'),
    originalsFa: copy('postalOriginalsInvalid'),
    originalsEn: copy('postalOriginalsInvalid'),
  };
  const guidanceForm = useZodForm<PostalGuidanceDraft>(
    async () =>
      (await import('../lib/solar-postal-form-schemas.js')).postalGuidanceSchema(guidanceMessages),
    {
      defaultValues: emptyPostalGuidance,
      validationUnavailableMessage: copy('documentValidationUnavailable'),
    }
  );
  const guidanceFields = useActionFieldErrors(guidanceForm, guidanceMessages, copy('postalError'));
  const guidanceDirty = useRef(false);
  guidanceDirty.current = guidanceForm.formState.isDirty;
  const [guidanceUnconfirmed, setGuidanceUnconfirmed] = useState(false);
  const [guidanceDenied, setGuidanceDenied] = useState(false);
  const [decisionUnconfirmed, setDecisionUnconfirmed] = useState(false);
  const [commandPending, setCommandPending] = useState(false);
  const commandPendingRef = useRef(false),
    preparingRef = useRef(false);
  const queueRead = useRef(0),
    guidanceRead = useRef(0),
    decisionRecoverAfter = useRef(0),
    guidanceRecoverAfter = useRef(0);
  const contractOwner = useRef<object | null>(null);
  const [contractLocked, setContractLocked] = useState(false);
  const queueAbort = useRef<AbortController | null>(null);
  const currentQueryScope = useRef('');
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [action, setAction] = useState<
    (TeamAction & { review?: FinalReview; postalReview?: PostalReview }) | null
  >(null);
  const actionRef = useRef<typeof action>(null);
  const [preparingDecision, setPreparingDecision] = useState(false);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [queueRevision, setQueueRevision] = useState(0);
  const [guidanceRevision, setGuidanceRevision] = useState(0);
  const [queueError, setQueueError] = useState(false);
  const [queueDenied, setQueueDenied] = useState(false);
  const trackingAccessDenied = useRef(false);
  const [guidanceError, setGuidanceError] = useState(false);
  const reviewRequest = useRef(0);
  const commandGeneration = useRef(0);
  function busy() {
    return (
      !!contractOwner.current ||
      !!actionRef.current ||
      commandPendingRef.current ||
      preparingRef.current ||
      reasonForm.isSubmissionPending() ||
      guidanceForm.isSubmissionPending()
    );
  }
  function propose(next: NonNullable<typeof action>) {
    if (contractOwner.current || actionRef.current || commandPendingRef.current) return;
    commandGeneration.current = ++reviewRequest.current;
    preparingRef.current = false;
    setPreparingDecision(false);
    actionRef.current = next;
    setAction(next);
  }
  function invalidateReview() {
    reviewRequest.current += 1;
    commandPendingRef.current = false;
    setCommandPending(false);
    actionRef.current = null;
    setAction(null);
    preparingRef.current = false;
    setPreparingDecision(false);
  }
  const [localBefore, setBefore] = useState<string | null>(null);
  const before = queries ? queries.query.cursor || null : localBefore;
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const acceptedCursor = useRef<string | null>(null);
  const extendingCursor = useRef<string | null>(null);
  const queryScope = JSON.stringify([lane, before]);
  currentQueryScope.current = queryScope;
  const previousScope = useRef(queryScope);
  if (previousScope.current !== queryScope) {
    previousScope.current = queryScope;
    ++reviewRequest.current;
  }
  useEffect(() => {
    invalidateReview();
    if (!before || extendingCursor.current !== before) {
      setSelected(null);
      setPreview(null);
      reasonForm.reset({ reason: '' });
      setError(false);
    }
    extendingCursor.current = null;
  }, [queryScope]);
  useEffect(
    () => () => {
      ++reviewRequest.current;
    },
    []
  );
  const [queueLoading, setQueueLoading] = useState(true);
  const [createdContractId, setCreatedContractId] = useState<string | null>(null);
  const refresh = () => {
    if (contractOwner.current) return;
    invalidateReview();
    if (queries) {
      queries.setQuery({ cursor: '' });
      if (!before) setQueueRevision((value) => value + 1);
    } else {
      setBefore(null);
      setRevision((value) => value + 1);
    }
  };
  useEffect(() => {
    const controller = new AbortController();
    const read = ++queueRead.current;
    queueAbort.current = controller;
    const fresh = () =>
      !controller.signal.aborted &&
      read === queueRead.current &&
      currentQueryScope.current === queryScope &&
      !contractOwner.current;
    trackingAccessDenied.current = false;
    setQueueLoading(true);
    setQueueError(false);
    setQueueDenied(false);
    const query = new URLSearchParams({ lane });
    if (before) query.set('before', before);
    void fetch(`/api/admin/solar/postal-queue?${query}`, {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!fresh()) return null;
        if (!response.ok) throw new Error(String(response.status));
        return response.json() as Promise<{ requests: Row[]; nextBefore: string | null }>;
      })
      .then((value) => {
        if (!fresh() || trackingAccessDenied.current || !value) return;
        const extending =
          !!before &&
          nextBefore === before &&
          acceptedCursor.current !== before &&
          acceptedLane === lane;
        setRows((current) => {
          if (!extending) return value.requests;
          const shown = new Set(current.map((request) => request.id));
          return [...current, ...value.requests.filter((request) => !shown.has(request.id))];
        });
        if (read >= decisionRecoverAfter.current) setDecisionUnconfirmed(false);
        acceptedCursor.current = before;
        setAcceptedLane(lane);
        setNextBefore(value.nextBefore);
      })
      .catch((cause: unknown) => {
        if (!fresh()) return;
        if (cause instanceof Error && ['401', '403'].includes(cause.message)) {
          invalidateReview();
          setRows([]);
          setNextBefore(null);
          setSelected(null);
          setPreview(null);
          setQueueDenied(true);
        } else setQueueError(true);
      })
      .finally(() => {
        if (fresh()) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [before, lane, revision, queueRevision]);
  useEffect(() => {
    const controller = new AbortController();
    const read = ++guidanceRead.current;
    setGuidanceError(false);
    void fetch('/api/admin/solar/postal-guidance', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('guidance');
        return response.json() as Promise<Guidance>;
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (!validPostalGuidance(value)) throw new Error('guidance');
        setGuidance(value);
        if (!guidanceDirty.current) guidanceForm.reset(postalGuidanceDraft(value));
        if (read >= guidanceRecoverAfter.current) setGuidanceUnconfirmed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGuidanceError(true);
      });
    return () => controller.abort();
  }, [guidanceRevision]);
  const row = visibleRows.find((item) => item.id === selected);
  function saveGuidance(event: FormEvent<HTMLFormElement>) {
    if (!guidance || busy() || guidanceUnconfirmed || guidanceDenied) {
      event.preventDefault();
      return;
    }
    const generation = reviewRequest.current;
    void guidanceForm.handleSubmit((draft) => {
      if (generation !== reviewRequest.current) return;
      propose({
        title: copy('postalSaveGuidance'),
        description: copy('postalSaveGuidance'),
        path: '/api/admin/solar/postal-guidance',
        method: 'PUT',
        body: postalGuidanceBody(draft),
      });
    })(event);
  }
  function prepareDecision(options: {
    requestId: string;
    required: boolean;
    decision: string;
    previewPath: string;
    path: string;
    title: string;
    conflict: string;
    kind: 'postal' | 'final';
  }) {
    if (busy() || decisionUnconfirmed) return;
    const generation = reviewRequest.current;
    const prepare = async (reason: string) => {
      if (generation !== reviewRequest.current) return;
      const request = ++reviewRequest.current;
      preparingRef.current = true;
      setPreparingDecision(true);
      setError(false);
      const body = options.required ? { reason: reason.trim() } : {};
      try {
        const response = await fetch(options.previewPath, {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ decision: options.decision, ...body }),
        });
        const value = await response.json().catch(() => null);
        if (request !== reviewRequest.current) return;
        if (!response.ok) {
          if (
            options.required &&
            response.status === 400 &&
            value?.error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
            Array.isArray(value.error.fields) &&
            value.error.fields.length &&
            value.error.fields.every((field: unknown) => field === 'reason') &&
            reasonFields(['reason'])
          )
            return;
          throw new Error('review');
        }
        if (
          !value ||
          typeof value.hash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.hash) ||
          value.data?.requestId !== options.requestId
        )
          throw new Error('review');
        propose({
          title: options.title,
          description: options.requestId,
          path: options.path,
          method: 'POST',
          body: { ...body, expectedReviewHash: value.hash },
          conflictMessage: options.conflict,
          ...(options.kind === 'postal'
            ? { postalReview: value as PostalReview }
            : { review: value as FinalReview }),
        });
      } catch {
        if (request === reviewRequest.current) setError(true);
      } finally {
        if (request === reviewRequest.current) {
          preparingRef.current = false;
          setPreparingDecision(false);
        }
      }
    };
    if (options.required) void reasonForm.handleSubmit((draft) => prepare(draft.reason))();
    else void prepare('');
  }
  function decide(decision: 'confirm-received' | 'mark-incomplete' | 'mark-not-received') {
    if (!row) return;
    const path = `/api/admin/solar/requests/${encodeURIComponent(row.id)}/postal`;
    prepareDecision({
      requestId: row.id,
      required: decision !== 'confirm-received',
      decision: {
        'confirm-received': 'received',
        'mark-incomplete': 'incomplete',
        'mark-not-received': 'not_received',
      }[decision],
      previewPath: `${path}/review`,
      path: `${path}/${decision}`,
      title: copy(`postal_${decision}`),
      conflict: copy('postalReviewChanged'),
      kind: 'postal',
    });
  }
  function prepareFinalDecision(decision: FinalDecision, requestId: string) {
    const path = `/api/admin/solar/requests/${encodeURIComponent(requestId)}`;
    prepareDecision({
      requestId,
      required: decision !== 'approve',
      decision,
      previewPath: `${path}/final-decision/review`,
      path: `${path}/${decision === 'approve' ? 'final-approve' : decision === 'reject' ? 'final-reject' : 'close-no-contract'}`,
      title: copy(
        decision === 'approve'
          ? 'solarFinalApprove'
          : decision === 'reject'
            ? 'solarFinalReject'
            : 'solarCloseNoContract'
      ),
      conflict: copy('solarFinalReviewChanged'),
      kind: 'final',
    });
  }
  const actionGeneration = commandGeneration.current;
  const viewGeneration = reviewRequest.current;
  const guidanceAction = action?.path === '/api/admin/solar/postal-guidance';
  const editorLocked =
    contractLocked ||
    !!action ||
    commandPending ||
    preparingDecision ||
    reasonForm.formState.isSubmitting ||
    guidanceForm.formState.isSubmitting;
  return (
    <div className="space-y-6 px-4 py-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="text-3xl font-semibold">{copy('postalStaffTitle')}</h1>
      {time.notice}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>
            {copy(decisionUnconfirmed ? 'postalDecisionUnconfirmed' : 'postalError')}
          </AlertDescription>
        </Alert>
      )}
      {decisionUnconfirmed && (
        <Button
          type="button"
          variant="outline"
          disabled={editorLocked}
          onClick={() => {
            if (!contractOwner.current) setQueueRevision((value) => value + 1);
          }}
        >
          {copy('postalDecisionReload')}
        </Button>
      )}
      {createdContractId && (
        <p role="status">
          {copy('solarContractCreated')}{' '}
          <a
            className="underline"
            href={`/admin/contracts?contractId=${encodeURIComponent(createdContractId)}`}
          >
            {copy('solarViewContract')}
          </a>
        </p>
      )}
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="text-xl font-semibold">{copy('postalStaffQueue')}</h2>
        <ListPage>
          <ListPage.Toolbar
            filters={
              <label className="block max-w-xs space-y-1" htmlFor="solar-postal-lane">
                <span>{copy('postalLane')}</span>
                <select
                  id="solar-postal-lane"
                  className="w-full rounded-md border bg-background p-2"
                  value={lane}
                  disabled={commandPending || contractLocked}
                  onChange={(event) => {
                    if (contractOwner.current || preparingRef.current || commandPendingRef.current)
                      return;
                    if (queries) {
                      queries.setQuery({ filters: { lane: event.target.value } });
                      return;
                    }
                    invalidateReview();
                    setRows([]);
                    setBefore(null);
                    setNextBefore(null);
                    setSelected(null);
                    setLane(event.target.value as PostalLane);
                  }}
                >
                  <option value="needs_staff">{copy('postalLaneAction')}</option>
                  <option value="waiting_customer">{copy('postalLaneWaiting')}</option>
                  <option value="all">{copy('postalLaneAll')}</option>
                </select>
              </label>
            }
          />
          <ListPage.Content
            loading={queueLoading || contractLocked}
            error={queueError || queueDenied}
            empty={!visibleRows.length}
            retainContent={!!visibleRows.length && !queueDenied}
            loadingView={<p role="status">{copy('loading')}</p>}
            errorView={
              queueDenied ? (
                <p role="alert">{copy('staffQueueForbidden')}</p>
              ) : (
                <div className="space-y-2">
                  <p role="alert">{copy('staffQueueLoadError')}</p>
                  <Button
                    variant="outline"
                    disabled={contractLocked}
                    onClick={() => {
                      if (!contractOwner.current) setQueueRevision((v) => v + 1);
                    }}
                  >
                    {copy('retry')}
                  </Button>
                </div>
              )
            }
            emptyView={
              <p>
                {copy(
                  lane === 'waiting_customer'
                    ? 'postalStaffEmptyWaiting'
                    : lane === 'all'
                      ? 'postalStaffEmptyAll'
                      : 'postalStaffEmpty'
                )}
              </p>
            }
          >
            <ul className="space-y-2">
              {visibleRows.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={commandPending || contractLocked}
                    className={`w-full rounded-md border p-3 text-start ${selected === item.id ? 'border-primary' : ''}`}
                    onClick={() => {
                      if (
                        contractOwner.current ||
                        commandPendingRef.current ||
                        preparingRef.current
                      )
                        return;
                      invalidateReview();
                      setSelected(item.id);
                      setPreview(null);
                      reasonForm.reset({ reason: '' });
                    }}
                  >
                    <span className="block font-medium">{item.profile_name}</span>
                    <span className="block text-sm text-muted-foreground">
                      {copy(`postal_${item.postal_status}`)} ·{' '}
                      {time.format(item.created_at, { dateStyle: 'medium' })}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {copy('staffRequest')}: <bdi>{item.id}</bdi>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ListPage.Content>
          <ListPage.Pagination
            kind="cursor"
            hasMore={
              !!nextBefore &&
              !queueError &&
              !queueDenied &&
              (acceptedCursor.current !== before ||
                (nextBefore !== before && (!queries || queries.canAdvance(nextBefore))))
            }
            loading={queueLoading || contractLocked}
            label={copy('postalStaffQueue')}
            nextLabel={copy('moreRequests')}
            onNext={() => {
              if (contractOwner.current || commandPendingRef.current || preparingRef.current)
                return;
              if (nextBefore === before && acceptedCursor.current !== before) {
                setQueueRevision((value) => value + 1);
                return;
              }
              extendingCursor.current = nextBefore;
              if (queries && nextBefore) queries.next(nextBefore);
              else setBefore(nextBefore);
            }}
          />
        </ListPage>
      </section>
      {row && (
        <section
          role="group"
          aria-label={copy('postalShipment')}
          className="space-y-3 rounded-xl border p-5"
        >
          <h2 className="text-xl font-semibold">{copy('postalShipment')}</h2>
          <p>
            {copy('postalStatus')}: {copy(`postal_${row.postal_status}`)}
          </p>
          {row.courier && (
            <p>
              {copy('postalCourier')}: {row.courier}
            </p>
          )}
          {row.tracking_number && (
            <p>
              {copy('postalTracking')}: <span dir="ltr">{row.tracking_number}</span>
            </p>
          )}
          {row.send_date && (
            <p>
              {copy('postalSendDate')}: {postalCalendarDate(row.send_date, locale)}
            </p>
          )}
          {row.staff_notes && (
            <p>
              {copy('postalStaffNotes')}: {row.staff_notes}
            </p>
          )}
          {row.receipt_image_id && (
            <button
              type="button"
              className="underline"
              onClick={() => setPreview(row.receipt_image_id)}
            >
              {copy('preview')}
            </button>
          )}
          {preview && (
            <DocumentDetail
              id={preview}
              staff
              onClose={() => setPreview(null)}
              onChanged={refresh}
              onPrevious={setPreview}
              onReplace={() => {}}
              allowReplacement={false}
            />
          )}
          {row.tracking_revision !== undefined && (
            <SolarPostalTrackingEditor
              key={`${row.id}:${row.tracking_revision}`}
              requestId={row.id}
              onSaved={refresh}
              onDenied={() => {
                trackingAccessDenied.current = true;
                invalidateReview();
                setRows([]);
                setNextBefore(null);
                setSelected(null);
                setPreview(null);
                setQueueDenied(true);
              }}
            />
          )}
          {row.postal_status === 'shipped' && (
            <>
              <Form {...reasonForm}>
                {reasonForm.formState.errors.root && (
                  <Alert variant="destructive">
                    <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                  </Alert>
                )}
                <FormField
                  control={reasonForm.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem id="solar-postal-reason">
                      <FormLabel>{copy('reason')}</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          disabled={editorLocked || decisionUnconfirmed}
                          className="w-full rounded-md border bg-background p-2"
                        />
                      </FormControl>
                      <FormDescription>{copy('postalReasonHelp')}</FormDescription>
                      <div className="grid">
                        <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                          {copy('postalReasonInvalid')}
                        </p>
                        <FormMessage className="col-start-1 row-start-1" />
                      </div>
                    </FormItem>
                  )}
                />
              </Form>
              <div className="flex flex-wrap gap-2">
                <Button
                  className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                  loading={preparingDecision || reasonForm.formState.isSubmitting}
                  disabled={editorLocked || decisionUnconfirmed}
                  onClick={() => void decide('confirm-received')}
                >
                  {copy('postal_confirm-received')}
                </Button>
                <Button
                  className="rounded-md border px-4 py-2"
                  loading={preparingDecision || reasonForm.formState.isSubmitting}
                  disabled={editorLocked || decisionUnconfirmed}
                  onClick={() => void decide('mark-incomplete')}
                >
                  {copy('postal_mark-incomplete')}
                </Button>
                <Button
                  className="rounded-md border px-4 py-2"
                  loading={preparingDecision || reasonForm.formState.isSubmitting}
                  disabled={editorLocked || decisionUnconfirmed}
                  onClick={() => void decide('mark-not-received')}
                >
                  {copy('postal_mark-not-received')}
                </Button>
              </div>
            </>
          )}
          {['postal_documents_received', 'final_review', 'approved'].includes(
            row.request_status
          ) && (
            <div className="space-y-3">
              {row.request_status !== 'postal_documents_received' && (
                <Form {...reasonForm}>
                  {reasonForm.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                    </Alert>
                  )}
                  <FormField
                    control={reasonForm.control}
                    name="reason"
                    render={({ field }) => (
                      <FormItem id="solar-postal-reason">
                        <FormLabel>{copy('reason')}</FormLabel>
                        <FormControl>
                          <textarea
                            {...field}
                            disabled={editorLocked || decisionUnconfirmed}
                            className="w-full rounded-md border bg-background p-2"
                          />
                        </FormControl>
                        <FormDescription>{copy('postalReasonHelp')}</FormDescription>
                        <div className="grid">
                          <p
                            aria-hidden="true"
                            className="invisible col-start-1 row-start-1 text-sm"
                          >
                            {copy('postalReasonInvalid')}
                          </p>
                          <FormMessage className="col-start-1 row-start-1" />
                        </div>
                      </FormItem>
                    )}
                  />
                </Form>
              )}
              <div className="flex flex-wrap gap-2">
                {row.request_status === 'postal_documents_received' && (
                  <button
                    type="button"
                    className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                    disabled={editorLocked || decisionUnconfirmed}
                    onClick={() => {
                      if (busy() || decisionUnconfirmed) return;
                      propose({
                        title: copy('solarStartFinalReview'),
                        description: row.id,
                        path: `/api/admin/solar/requests/${row.id}/start-final-review`,
                        method: 'POST',
                      });
                    }}
                  >
                    {copy('solarStartFinalReview')}
                  </button>
                )}
                {row.request_status === 'final_review' && (
                  <>
                    <Button
                      type="button"
                      className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                      loading={preparingDecision || reasonForm.formState.isSubmitting}
                      disabled={editorLocked || decisionUnconfirmed}
                      onClick={() => void prepareFinalDecision('approve', row.id)}
                    >
                      {copy('solarFinalApprove')}
                    </Button>
                    <Button
                      type="button"
                      className="rounded-md border border-destructive px-4 py-2 text-destructive"
                      loading={preparingDecision || reasonForm.formState.isSubmitting}
                      disabled={editorLocked || decisionUnconfirmed}
                      onClick={() => void prepareFinalDecision('reject', row.id)}
                    >
                      {copy('solarFinalReject')}
                    </Button>
                  </>
                )}
                {row.request_status !== 'postal_documents_received' && (
                  <Button
                    type="button"
                    className="rounded-md border px-4 py-2"
                    loading={preparingDecision || reasonForm.formState.isSubmitting}
                    disabled={editorLocked || decisionUnconfirmed}
                    onClick={() => void prepareFinalDecision('close-no-contract', row.id)}
                  >
                    {copy('solarCloseNoContract')}
                  </Button>
                )}
              </div>
            </div>
          )}
          {row.request_status === 'approved' && (
            <SolarContractForm
              key={row.id}
              requestId={row.id}
              profileId={row.profile_id}
              scopeKey={JSON.stringify([queryScope, row])}
              coordination={{
                blocked: () =>
                  busy() || decisionUnconfirmed || guidanceUnconfirmed || guidanceDenied,
                acquire: (owner) => {
                  if (
                    viewGeneration !== reviewRequest.current ||
                    busy() ||
                    decisionUnconfirmed ||
                    guidanceUnconfirmed ||
                    guidanceDenied
                  )
                    return false;
                  contractOwner.current = owner;
                  setContractLocked(true);
                  ++queueRead.current;
                  queueAbort.current?.abort();
                  setQueueLoading(false);
                  return true;
                },
                release: (owner) => {
                  if (contractOwner.current !== owner) return;
                  contractOwner.current = null;
                  setContractLocked(false);
                },
              }}
              onDenied={() => {
                if (viewGeneration !== reviewRequest.current) return;
                ++queueRead.current;
                queueAbort.current?.abort();
                invalidateReview();
                setRows((current) => current.filter((item) => item.id !== row.id));
                setSelected(null);
                setPreview(null);
                reasonForm.reset({ reason: '' });
                setQueueError(true);
                setQueueLoading(false);
              }}
              onCreated={(contractId) => {
                if (viewGeneration !== reviewRequest.current) return;
                setCreatedContractId(contractId);
                setSelected(null);
                refresh();
              }}
            />
          )}
        </section>
      )}
      {guidanceError && (
        <div role="alert" className="space-y-2">
          <p>{copy('staffGuidanceLoadError')}</p>
          <Button
            variant="outline"
            disabled={contractLocked}
            onClick={() => {
              if (!contractOwner.current) setGuidanceRevision((v) => v + 1);
            }}
          >
            {copy('retry')}
          </Button>
        </div>
      )}
      {guidance && (
        <Form {...guidanceForm}>
          <div role="group" aria-label={copy('postalGuidance')}>
            <form className="space-y-3 rounded-xl border p-5" onSubmit={saveGuidance} noValidate>
              <h2 className="text-xl font-semibold">{copy('postalGuidance')}</h2>
              {guidanceForm.formState.errors.root && (
                <Alert variant="destructive">
                  <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                </Alert>
              )}
              {(guidanceUnconfirmed || guidanceDenied) && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {copy(guidanceDenied ? 'postalGuidanceForbidden' : 'postalGuidanceUnconfirmed')}
                  </AlertDescription>
                </Alert>
              )}
              {(
                [
                  ['fa', 'solar-postal-guidance-fa', 'postalGuidance_fa', 'documentGuidanceHelp'],
                  ['en', 'solar-postal-guidance-en', 'postalGuidance_en', 'documentGuidanceHelp'],
                  [
                    'destinationAddress',
                    'solar-postal-guidance-destination-address',
                    'postalGuidance_destinationAddress',
                    'postalAddressHelp',
                  ],
                  [
                    'contactDetails',
                    'solar-postal-guidance-contact-details',
                    'postalGuidance_contactDetails',
                    'postalContactHelp',
                  ],
                  [
                    'originalsFa',
                    'solar-postal-guidance-originals-fa',
                    'postalOriginalsFa',
                    'documentSuggestionsHelp',
                  ],
                  [
                    'originalsEn',
                    'solar-postal-guidance-originals-en',
                    'postalOriginalsEn',
                    'documentSuggestionsHelp',
                  ],
                ] as const
              ).map(([name, id, label, help]) => (
                <FormField
                  key={name}
                  control={guidanceForm.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem id={id}>
                      <FormLabel>{copy(label)}</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          disabled={editorLocked || guidanceDenied}
                          dir={
                            name.endsWith('Fa') || name === 'fa'
                              ? 'rtl'
                              : name.endsWith('En') || name === 'en'
                                ? 'ltr'
                                : undefined
                          }
                          className="w-full rounded-md border bg-background p-2"
                        />
                      </FormControl>
                      <FormDescription>{copy(help)}</FormDescription>
                      <div className="grid">
                        <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                          {guidanceMessages[name]}
                        </p>
                        <FormMessage className="col-start-1 row-start-1" />
                      </div>
                    </FormItem>
                  )}
                />
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  loading={guidanceForm.formState.isSubmitting}
                  disabled={editorLocked || guidanceUnconfirmed || guidanceDenied}
                >
                  {copy('postalSaveGuidance')}
                </Button>
                {(guidanceUnconfirmed || guidanceDenied) && (
                  <Button
                    id="solar-postal-guidance-reload"
                    type="button"
                    variant="outline"
                    disabled={editorLocked}
                    onClick={() => {
                      if (!contractOwner.current) setGuidanceRevision((value) => value + 1);
                    }}
                  >
                    {copy('postalGuidanceReload')}
                  </Button>
                )}
              </div>
            </form>
          </div>
        </Form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={
            guidanceAction ? guidanceUnconfirmed || guidanceDenied : decisionUnconfirmed
          }
          onPendingChange={(pending) => {
            if (actionGeneration === reviewRequest.current) {
              commandPendingRef.current = pending;
              setCommandPending(pending);
            }
          }}
          onValidationError={(fields) => {
            if (actionGeneration !== reviewRequest.current) return false;
            return guidanceAction
              ? guidanceFields(fields)
              : !!(action.body as { reason?: string } | undefined)?.reason &&
                  !!fields.length &&
                  fields.every((field) => field === 'reason') &&
                  reasonFields(['reason']);
          }}
          onUnconfirmed={() => {
            if (actionGeneration !== reviewRequest.current) return;
            if (guidanceAction) {
              guidanceRecoverAfter.current = guidanceRead.current + 1;
              setGuidanceUnconfirmed(true);
            } else {
              decisionRecoverAfter.current = queueRead.current + 1;
              setDecisionUnconfirmed(true);
              setError(true);
            }
          }}
          onDenied={() => {
            if (actionGeneration !== reviewRequest.current) return;
            if (guidanceAction) setGuidanceDenied(true);
            else {
              trackingAccessDenied.current = true;
              invalidateReview();
              setRows([]);
              setSelected(null);
              setPreview(null);
              setQueueDenied(true);
            }
          }}
          onClose={() => {
            if (actionGeneration === reviewRequest.current) invalidateReview();
          }}
          summary={
            action.review ? (
              <FinancialReviewSummary
                title={copy('solarFinalReviewTitle')}
                rows={[
                  {
                    id: 'request',
                    label: copy('staffRequest'),
                    value: action.review.data.requestId,
                  },
                  {
                    id: 'status',
                    label: copy('solarFinalCurrentStatus'),
                    value: copy(`status_${action.review.data.currentStatus}`),
                  },
                  {
                    id: 'postal',
                    label: copy('postalStatus'),
                    value: action.review.data.postalStatus
                      ? copy(`postal_${action.review.data.postalStatus}`)
                      : copy('solarFinalNotAvailable'),
                  },
                  ...(action.review.data.trackingNumber
                    ? [
                        {
                          id: 'tracking',
                          label: copy('postalTracking'),
                          value: action.review.data.trackingNumber,
                        },
                      ]
                    : []),
                  ...(action.review.data.reason
                    ? [
                        {
                          id: 'reason',
                          label: copy('reason'),
                          value: action.review.data.reason,
                        },
                      ]
                    : []),
                ]}
                total={{
                  label: copy('solarFinalOutcome'),
                  value: copy(`status_${action.review.data.outcome}`),
                }}
                notice={copy('solarFinalNoFinancialChange')}
              />
            ) : action.postalReview ? (
              <FinancialReviewSummary
                title={copy('postalReviewTitle')}
                rows={[
                  {
                    id: 'request',
                    label: copy('staffRequest'),
                    value: action.postalReview.data.requestId,
                  },
                  {
                    id: 'request-status',
                    label: copy('solarFinalCurrentStatus'),
                    value: copy(`status_${action.postalReview.data.currentRequestStatus}`),
                  },
                  {
                    id: 'postal-status',
                    label: copy('postalStatus'),
                    value: copy(`postal_${action.postalReview.data.currentPostalStatus}`),
                  },
                  {
                    id: 'courier',
                    label: copy('postalCourier'),
                    value: action.postalReview.data.courier ?? copy('solarFinalNotAvailable'),
                  },
                  {
                    id: 'tracking',
                    label: copy('postalTracking'),
                    value:
                      action.postalReview.data.trackingNumber ?? copy('solarFinalNotAvailable'),
                  },
                  {
                    id: 'send-date',
                    label: copy('postalSendDate'),
                    value: action.postalReview.data.sendDate ?? copy('solarFinalNotAvailable'),
                  },
                  {
                    id: 'receipt',
                    label: copy('postalReceipt'),
                    value: action.postalReview.data.receiptImageId ?? copy('postalNoReceipt'),
                  },
                  ...(action.postalReview.data.reason
                    ? [
                        {
                          id: 'reason',
                          label: copy('reason'),
                          value: action.postalReview.data.reason,
                        },
                      ]
                    : []),
                  {
                    id: 'postal-outcome',
                    label: copy('postalReviewOutcome'),
                    value: copy(`postal_${action.postalReview.data.postalOutcome}`),
                  },
                ]}
                total={{
                  label: copy('solarFinalOutcome'),
                  value: copy(`status_${action.postalReview.data.requestOutcome}`),
                }}
                notice={copy('solarFinalNoFinancialChange')}
              />
            ) : undefined
          }
          onSuccess={async (receipt) => {
            if (actionGeneration !== reviewRequest.current) return;
            if (guidanceAction) {
              const expected = action.body as Guidance;
              if (!confirmedPostalGuidance(receipt, expected)) throw new Error('guidance receipt');
              setGuidance(expected);
              guidanceForm.reset(postalGuidanceDraft(expected));
              setGuidanceUnconfirmed(false);
              invalidateReview();
            } else {
              if (!confirmedPostalDecision(receipt, action.path)) throw new Error('postal receipt');
              setError(false);
              refresh();
              reasonForm.reset({ reason: '' });
            }
          }}
        />
      )}
    </div>
  );
}
