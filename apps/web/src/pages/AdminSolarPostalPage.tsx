import { guidanceErrorPaths } from '../lib/solar-document-form.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { tSolarStaffRecord } from '@barghsa/i18n/solar-staff-record';
import { tSolar } from '@barghsa/i18n/solar';
import {
  LoadingStatus,
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  FinancialReviewSummary,
  ListPage,
  ListRefreshButton,
  Textarea,
  NativeSelect,
} from '@barghsa/ui';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  useFieldArray,
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
import { QueueEmptyState } from '../components/QueueEmptyState.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { DocumentDetail } from '../components/DocumentDetail.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorGrid,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { SolarPostalTrackingEditor } from '../components/SolarPostalTrackingEditor.js';
import { postalCalendarDate } from '../lib/solar-postal-tracking.js';
import { SolarContractForm } from '../components/SolarContractForm.js';
import { SolarGuidanceField, SolarGuidanceItems } from '../components/SolarGuidanceFields.js';
import { SolarStaffRecordHeader } from '../components/SolarStaffRecordHeader.js';
import { withCsrf } from '../lib/csrf.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import {
  availablePostalDecision,
  solarPostalDecisions,
  type SolarPostalOperation,
} from '../lib/solar-postal-decisions.js';

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

export function AdminSolarPostalPage(props: Parameters<typeof AdminSolarPostalWorkspace>[0] = {}) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <AdminSolarPostalWorkspace key={JSON.stringify([actor, revision])} {...props} />;
}
function AdminSolarPostalWorkspace({
  queries,
  recordId,
  queueSearch,
  guidanceEditor = false,
  decisionEditor,
  recordEditor,
}: {
  queries?: ListQueryBinding;
  recordId?: string;
  queueSearch?: Record<string, unknown>;
  guidanceEditor?: boolean;
  decisionEditor?: SolarPostalOperation | undefined;
  recordEditor?: 'create-contract' | 'tracking' | undefined;
} = {}) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(actor, profileRevision);
  const locale = useLocale();
  const time = useAccountTime(locale);
  const copy = (key: string) => tSolar(key, locale);
  const [rows, setRows] = useState<Row[]>([]);
  const [localLane, setLane] = useState<PostalLane>('needs_staff');
  const lane = (queries?.query.filters.lane || localLane) as PostalLane;
  const otherLane = lane === 'needs_staff' ? 'waiting_customer' : 'needs_staff';
  function changeLane(next: string) {
    if (contractOwner.current || preparingRef.current || commandPendingRef.current) return;
    if (queries) {
      queries.setQuery({ filters: { lane: next } });
      return;
    }
    invalidateReview();
    setRows([]);
    setBefore(null);
    setNextBefore(null);
    setSelected(null);
    setLane(next as PostalLane);
  }
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
    items: tSolarStaffRecord('guidancePairInvalid', locale),
  };
  const guidanceForm = useZodForm<PostalGuidanceDraft>(
    async () =>
      (await import('../lib/solar-postal-form-schemas.js')).postalGuidanceSchema(guidanceMessages),
    {
      defaultValues: emptyPostalGuidance,
      validationUnavailableMessage: copy('documentValidationUnavailable'),
    }
  );
  const guidanceItems = useFieldArray({ control: guidanceForm.control, name: 'items' });
  const guidanceFields = useActionFieldErrors(
    guidanceForm,
    {
      ...guidanceMessages,
      'items.0.fa': guidanceMessages.items,
      'items.0.en': guidanceMessages.items,
    },
    copy('postalError')
  );
  const guidanceDirty = useRef(false);
  guidanceDirty.current = guidanceForm.formState.isDirty;
  const [guidanceUnconfirmed, setGuidanceUnconfirmed] = useState(false);
  const [guidanceDenied, setGuidanceDenied] = useState(false);
  const [decisionUnconfirmed, setDecisionUnconfirmed] = useState(false);
  const [decisionRecorded, setDecisionRecorded] = useState(false);
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
  const [selection, setSelected] = useState<string | null>(null);
  const selected = recordId ?? selection;
  const showQueue = !recordId && !guidanceEditor;
  const loadGuidance = guidanceEditor || (showQueue && queueSearch === undefined);
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
  const previewAbort = useRef<AbortController | null>(null);
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
    previewAbort.current?.abort();
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
      previewAbort.current?.abort();
    },
    []
  );
  const [queueLoading, setQueueLoading] = useState(true);
  const [createdContractId, setCreatedContractId] = useState<string | null>(null);
  const refresh = () => {
    if (contractOwner.current) return;
    invalidateReview();
    if (recordId) setQueueRevision((value) => value + 1);
    else if (queries) {
      queries.setQuery({ cursor: '' });
      if (!before) setQueueRevision((value) => value + 1);
    } else {
      setBefore(null);
      setRevision((value) => value + 1);
    }
  };
  useEffect(() => {
    if (guidanceEditor) return;
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
    const path = recordId
      ? `/api/admin/solar/requests/${encodeURIComponent(recordId)}/postal`
      : `/api/admin/solar/postal-queue?${query}`;
    void readStaff('solar', recordId ? 'detail' : 'list', path, controller.signal)
      .then(async (response) => {
        if (!fresh()) return null;
        if (!response.ok) throw new Error(String(response.status));
        if (!recordId)
          return response.json() as Promise<{ requests: Row[]; nextBefore: string | null }>;
        const record = (await response.json()) as Row | null;
        if (record?.id !== recordId || typeof record.profile_id !== 'string')
          throw new Error('Invalid postal record');
        return { requests: [record], nextBefore: null };
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
        if (
          cause instanceof Error &&
          ['401', '403', ...(recordId ? ['404'] : [])].includes(cause.message)
        ) {
          invalidateReview();
          setRows([]);
          setNextBefore(null);
          setSelected(null);
          setPreview(null);
          setDecisionUnconfirmed(false);
          setQueueDenied(true);
        } else setQueueError(true);
      })
      .finally(() => {
        if (fresh()) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [before, lane, revision, queueRevision, readStaff, recordId, guidanceEditor]);
  useEffect(() => {
    if (!loadGuidance) return;
    const controller = new AbortController();
    const read = ++guidanceRead.current;
    setGuidanceError(false);
    void readStaff('catalogue', 'detail', '/api/admin/solar/postal-guidance', controller.signal)
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
  }, [guidanceRevision, readStaff, loadGuidance]);
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
        description: tSolarStaffRecord('postalGuidanceAudience', locale),
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
      const previewController = new AbortController();
      previewAbort.current = previewController;
      try {
        const { response, value } = await readWithDeadline(
          previewController.signal,
          async (signal) => {
            const response = await fetch(options.previewPath, {
              signal,
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({ decision: options.decision, ...body }),
            });
            const value = await response.json().catch(() => null);
            return { response, value };
          }
        );
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
        if (decisionEditor) {
          const reviewed = value.data;
          const outcome =
            options.kind === 'postal'
              ? { status: reviewed.postalOutcome, requestStatus: reviewed.requestOutcome }
              : { status: reviewed.outcome };
          if (
            reviewed.reason !== (body.reason ?? null) ||
            !confirmedPostalDecision(outcome, options.path)
          )
            throw new Error('review');
        }
        propose({
          ...(['reject', 'close-no-contract'].includes(options.decision)
            ? { risk: 'destructive' as const }
            : {}),
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
        if (previewAbort.current === previewController) previewAbort.current = null;
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
  const decision = decisionEditor && solarPostalDecisions[decisionEditor];
  const reason = decision && 'reason' in decision ? decision : undefined;
  const editorTitle =
    recordEditor === 'create-contract'
      ? copy('solarCreateContract')
      : recordEditor === 'tracking'
        ? tSolarStaffRecord('editTracking', locale)
        : undefined;
  const canDecide = !!(decisionEditor && row && availablePostalDecision(decisionEditor, row));
  const requestStatusLabel = row && copy(`status_${row.request_status}`);
  const shipmentStatusLabel = row && copy(`postal_${row.postal_status}`);
  const backToQueue =
    !!createdContractId ||
    (decisionRecorded &&
      (decisionEditor === 'final-reject' || decisionEditor === 'close-no-contract'));
  const guidanceAction = action?.path === '/api/admin/solar/postal-guidance';
  const editorLocked =
    contractLocked ||
    !!action ||
    commandPending ||
    preparingDecision ||
    reasonForm.formState.isSubmitting ||
    guidanceForm.formState.isSubmitting;
  const navigationBlocked = () =>
    commandPendingRef.current ||
    !!actionRef.current ||
    decisionUnconfirmed ||
    !!contractOwner.current;

  const reasonError = reasonForm.formState.errors.reason;
  const focusReason = reasonForm.setFocus;
  useEffect(() => {
    if (!decisionEditor || editorLocked || !reasonError) return;
    const frame = requestAnimationFrame(() => focusReason('reason'));
    return () => cancelAnimationFrame(frame);
  }, [decisionEditor, editorLocked, reasonError, focusReason]);

  function startFinalReview() {
    if (!row || busy() || decisionUnconfirmed) return;
    propose({
      title: copy('solarStartFinalReview'),
      description: row.id,
      path: `/api/admin/solar/requests/${row.id}/start-final-review`,
      method: 'POST',
    });
  }

  function submitPostalDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!row || !canDecide || decisionRecorded || queueLoading || queueError) return;
    switch (decisionEditor) {
      case 'start-final-review':
        startFinalReview();
        break;
      case 'final-approve':
        prepareFinalDecision('approve', row.id);
        break;
      case 'final-reject':
        prepareFinalDecision('reject', row.id);
        break;
      case 'close-no-contract':
        prepareFinalDecision('close-no-contract', row.id);
        break;
      case 'confirm-received':
      case 'mark-incomplete':
      case 'mark-not-received':
        decide(decisionEditor);
        break;
    }
  }

  function rowLabel(item: Row) {
    return (
      <>
        <span className="block font-medium" dir="auto">
          {item.profile_name}
        </span>
        <span className="block text-sm text-muted-foreground">
          {copy(`postal_${item.postal_status}`)} ·{' '}
          {time.format(item.created_at, { dateStyle: 'medium' })}
        </span>
        <span className="block text-xs text-muted-foreground">
          {copy('staffRequest')}: <bdi>{item.id}</bdi>
        </span>
      </>
    );
  }

  const trackingEditor = row?.tracking_revision !== undefined && (
    <SolarPostalTrackingEditor
      key={recordEditor ? row.id : `${row.id}:${row.tracking_revision}`}
      requestId={row.id}
      standalone={!!recordEditor}
      editorPage={!!recordEditor}
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
  );
  const contractEditor = row?.request_status === 'approved' && !createdContractId && (
    <SolarContractForm
      key={row.id}
      requestId={row.id}
      profileId={row.profile_id}
      editorPage={!!recordEditor}
      scopeKey={JSON.stringify([queryScope, row])}
      coordination={{
        blocked: () => busy() || decisionUnconfirmed || guidanceUnconfirmed || guidanceDenied,
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
  );
  return (
    <div
      data-slot={
        guidanceEditor ? 'solar-staff-guidance' : recordId ? 'solar-staff-postal' : undefined
      }
      className={recordId || guidanceEditor ? 'mx-auto max-w-3xl space-y-3' : 'space-y-6 px-4 py-8'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {recordId || guidanceEditor ? (
        <SolarStaffRecordHeader
          stage="postal"
          {...(guidanceEditor && { headingText: tSolarStaffRecord('editPostalGuidance', locale) })}
          {...(decision && { headingText: copy(decision.title) })}
          {...(editorTitle && { headingText: editorTitle })}
          backLink={
            !backToQueue && (decision || recordEditor) && recordId ? (
              <Link
                to="/admin/solar-requests/$requestId/postal/{-$operation}"
                params={{ requestId: recordId, operation: undefined }}
                search={queueSearch ?? {}}
                className="touch-action text-sm text-primary underline underline-offset-4"
                aria-disabled={navigationBlocked() || undefined}
                onClick={(event) => {
                  if (navigationBlocked()) event.preventDefault();
                }}
              >
                {tSolarStaffRecord('backToShipmentReview', locale)}
              </Link>
            ) : undefined
          }
          search={queueSearch ?? {}}
          blocked={navigationBlocked}
          reference={
            guidanceEditor
              ? tSolarStaffRecord('postalGuidanceAudience', locale)
              : !decision &&
                row && (
                  <>
                    <bdi>{row.profile_name}</bdi>
                    <bdi dir="ltr">{row.id}</bdi>
                  </>
                )
          }
          action={
            !decision &&
            !recordEditor &&
            row && (
              <ListRefreshButton
                label={tSolarStaffRecord('refresh', locale)}
                disabled={editorLocked || decisionUnconfirmed}
                onClick={refresh}
              />
            )
          }
        />
      ) : (
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-semibold">{copy('postalStaffTitle')}</h1>
          {queueSearch !== undefined && (
            <Link
              to="/admin/solar-requests/$requestId/postal/{-$operation}"
              params={{ requestId: 'guidance', operation: undefined }}
              search={queueSearch}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              {tSolarStaffRecord('editPostalGuidance', locale)}
            </Link>
          )}
        </header>
      )}
      {time.notice}
      {recordId && row && !decision && !recordEditor && (
        <Link
          to="/admin/solar-requests/$requestId/{-$operation}/{-$documentId}"
          params={{ requestId: recordId, operation: undefined, documentId: undefined }}
          className="touch-action text-sm text-primary underline underline-offset-4"
          aria-disabled={navigationBlocked() || undefined}
          onClick={(event) => {
            if (navigationBlocked()) event.preventDefault();
          }}
        >
          {tSolarStaffRecord('openDocuments', locale)}
        </Link>
      )}
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
            href={`/admin/contracts/${encodeURIComponent(createdContractId)}`}
          >
            {copy('solarViewContract')}
          </a>
          {recordId && (
            <Link
              to="/admin/solar-requests/$requestId/construction/{-$operation}"
              params={{ requestId: recordId }}
              className="touch-action ms-3 text-primary underline underline-offset-4"
            >
              {tSolarStaffRecord('openConstruction', locale)}
            </Link>
          )}
        </p>
      )}
      {showQueue && (
        <section className="space-y-3 rounded-xl border p-5">
          <h2 className="text-xl font-semibold">{copy('postalStaffQueue')}</h2>
          <ListPage>
            <ListPage.Toolbar
              filters={
                <div className="max-w-xs space-y-1">
                  <label htmlFor="solar-postal-lane">{copy('postalLane')}</label>
                  <NativeSelect
                    id="solar-postal-lane"
                    className="w-full"
                    value={lane}
                    disabled={commandPending || contractLocked}
                    onChange={(event) => changeLane(event.target.value)}
                  >
                    <option value="needs_staff">{copy('postalLaneAction')}</option>
                    <option value="waiting_customer">{copy('postalLaneWaiting')}</option>
                    <option value="all">{copy('postalLaneAll')}</option>
                  </NativeSelect>
                </div>
              }
            />
            <ListPage.Content
              loading={queueLoading || contractLocked}
              error={queueError || queueDenied}
              empty={!visibleRows.length}
              retainContent={!!visibleRows.length && !queueDenied}
              loadingView={<LoadingStatus>{copy('loading')}</LoadingStatus>}
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
                lane === 'all' || before ? (
                  <p>{copy('postalStaffEmptyAll')}</p>
                ) : (
                  <QueueEmptyState
                    locale={locale}
                    message={copy(
                      lane === 'waiting_customer' ? 'postalStaffEmptyWaiting' : 'postalStaffEmpty'
                    )}
                    alternatives={[
                      {
                        value: otherLane,
                        label: copy(
                          otherLane === 'waiting_customer'
                            ? 'postalLaneWaiting'
                            : 'postalLaneAction'
                        ),
                        path: `/api/admin/solar/postal-queue?lane=${otherLane}`,
                      },
                    ]}
                    hasResults={(body) => {
                      const requests = (body as { requests?: unknown } | null)?.requests;
                      return (
                        Array.isArray(requests) &&
                        requests.some(
                          (row) => typeof row?.id === 'string' && typeof row.profile_id === 'string'
                        )
                      );
                    }}
                    select={changeLane}
                    all={() => changeLane('all')}
                    disabled={commandPending || contractLocked}
                  />
                )
              }
            >
              <ul className="space-y-2">
                {visibleRows.map((item) => (
                  <li key={item.id}>
                    {queueSearch ? (
                      <Link
                        to="/admin/solar-requests/$requestId/postal/{-$operation}"
                        params={{ requestId: item.id, operation: undefined }}
                        search={queueSearch}
                        className="block w-full rounded-md border p-3 text-start hover:border-primary"
                      >
                        {rowLabel(item)}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled={commandPending || contractLocked}
                        className={`w-full rounded-md border p-3 text-start ${selected === item.id ? 'border-primary' : ''}`}
                        onClick={() => {
                          if (
                            contractOwner.current ||
                            (preparingRef.current && !reasonForm.isSubmissionPending()) ||
                            commandPendingRef.current
                          )
                            return;
                          invalidateReview();
                          setSelected(item.id);
                          setPreview(null);
                          reasonForm.reset({ reason: '' });
                        }}
                      >
                        {rowLabel(item)}
                      </button>
                    )}
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
      )}
      {recordId &&
        !decisionRecorded &&
        !createdContractId &&
        (!row && queueLoading ? (
          <LoadingStatus>{copy('loading')}</LoadingStatus>
        ) : queueDenied ? (
          <p role="alert">{copy('staffQueueForbidden')}</p>
        ) : queueError ? (
          <div role="alert" className="space-y-2">
            <p>{tSolarStaffRecord('postalLoadError', locale)}</p>
            <Button variant="outline" onClick={() => setQueueRevision((v) => v + 1)}>
              {copy('retry')}
            </Button>
          </div>
        ) : null)}
      {decisionRecorded && (
        <p role="status" className="rounded-xl border bg-card px-4 py-3 text-sm font-medium">
          {confirmationText('recorded', locale)}
        </p>
      )}
      {row && decision && !decisionRecorded && (
        <Form {...reasonForm}>
          <form
            aria-label={copy(decision.title)}
            onSubmit={submitPostalDecision}
            noValidate
            className={recordEditorSurface}
          >
            <RecordEditorSection title={tSolarStaffRecord('shipmentContext', locale)}>
              <div className="space-y-1 rounded-lg bg-muted/50 p-3">
                <p className="wrap-anywhere font-medium" dir="auto">
                  {row.profile_name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {requestStatusLabel}
                  {shipmentStatusLabel !== requestStatusLabel && <> · {shipmentStatusLabel}</>}
                </p>
                {row.tracking_number && (
                  <p className="wrap-anywhere text-sm text-muted-foreground">
                    {copy('postalTracking')} <bdi>{row.tracking_number}</bdi>
                  </p>
                )}
              </div>
              {canDecide ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {tSolarStaffRecord(decision.help, locale)}
                  </p>
                  {reasonForm.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                    </Alert>
                  )}
                  {reason && (
                    <FormField
                      control={reasonForm.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem id="solar-postal-reason" className={recordEditorField}>
                          <FormLabel>{tSolarStaffRecord(reason.reason, locale)}</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              dir="auto"
                              rows={2}
                              required
                              aria-required="true"
                              disabled={commandPending || decisionUnconfirmed}
                              className="max-h-36 overflow-y-auto"
                            />
                          </FormControl>
                          <FormDescription>
                            {tSolarStaffRecord(reason.example, locale)}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                </>
              ) : (
                <p role="alert" className="text-sm">
                  {tSolarStaffRecord('decisionUnavailable', locale)}
                </p>
              )}
            </RecordEditorSection>
            {canDecide && (
              <RecordEditorActions>
                <Button
                  type="submit"
                  disabled={editorLocked || decisionUnconfirmed || queueLoading || queueError}
                  loading={preparingDecision || reasonForm.formState.isSubmitting}
                >
                  {tSolarStaffRecord('reviewDecision', locale)}
                </Button>
              </RecordEditorActions>
            )}
          </form>
        </Form>
      )}
      {recordEditor === 'tracking' && trackingEditor}
      {recordEditor === 'create-contract' && contractEditor}
      {row &&
        !queueError &&
        !queueDenied &&
        recordEditor &&
        !createdContractId &&
        !(recordEditor === 'tracking' ? trackingEditor : contractEditor) && (
          <p role="alert" className="rounded-lg border bg-card px-4 py-3 text-sm">
            {tSolarStaffRecord(
              recordEditor === 'tracking' ? 'trackingUnavailable' : 'contractUnavailable',
              locale
            )}
          </p>
        )}
      {row && !decision && !recordEditor && (
        <section role="group" aria-label={copy('postalShipment')} className="space-y-3">
          <div className={recordEditorSurface}>
            <RecordEditorSection title={copy('postalShipment')}>
              <dl className={recordEditorGrid}>
                <div>
                  <dt className="text-sm text-muted-foreground">{copy('postalStatus')}</dt>
                  <dd>{copy(`postal_${row.postal_status}`)}</dd>
                </div>
                {recordId && (
                  <div>
                    <dt className="text-sm text-muted-foreground">
                      {copy('solarFinalCurrentStatus')}
                    </dt>
                    <dd>{copy(`status_${row.request_status}`)}</dd>
                  </div>
                )}
                {row.courier && (
                  <div>
                    <dt className="text-sm text-muted-foreground">{copy('postalCourier')}</dt>
                    <dd>{row.courier}</dd>
                  </div>
                )}
                {row.tracking_number && (
                  <div>
                    <dt className="text-sm text-muted-foreground">{copy('postalTracking')}</dt>
                    <dd className="wrap-anywhere">
                      <bdi dir="ltr">{row.tracking_number}</bdi>
                    </dd>
                  </div>
                )}
                {row.send_date && (
                  <div>
                    <dt className="text-sm text-muted-foreground">{copy('postalSendDate')}</dt>
                    <dd>{postalCalendarDate(row.send_date, locale)}</dd>
                  </div>
                )}
                {row.staff_notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm text-muted-foreground">{copy('postalStaffNotes')}</dt>
                    <dd className="wrap-anywhere">{row.staff_notes}</dd>
                  </div>
                )}
              </dl>
              {row.receipt_image_id && (
                <button
                  type="button"
                  className="underline"
                  onClick={() => setPreview(row.receipt_image_id)}
                >
                  {copy('preview')}
                </button>
              )}
              {preview && (!recordId || row.receipt_image_id === preview) && (
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
            </RecordEditorSection>
          </div>
          {!recordId && trackingEditor}
          {recordId &&
            (row.tracking_revision !== undefined || row.request_status === 'approved') && (
              <div className="flex flex-wrap gap-2">
                {row.tracking_revision !== undefined && (
                  <Link
                    to="/admin/solar-requests/$requestId/postal/{-$operation}"
                    params={{ requestId: recordId, operation: 'tracking' }}
                    search={queueSearch ?? {}}
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                    aria-disabled={navigationBlocked() || undefined}
                    onClick={(event) => {
                      if (navigationBlocked()) event.preventDefault();
                    }}
                  >
                    {tSolarStaffRecord('editTracking', locale)}
                  </Link>
                )}
                {row.request_status === 'approved' && (
                  <Link
                    to="/admin/solar-requests/$requestId/postal/{-$operation}"
                    params={{ requestId: recordId, operation: 'create-contract' }}
                    search={queueSearch ?? {}}
                    className={buttonVariants({
                      size: 'sm',
                      className: 'h-auto min-h-9 whitespace-normal',
                    })}
                    aria-disabled={navigationBlocked() || undefined}
                    onClick={(event) => {
                      if (navigationBlocked()) event.preventDefault();
                    }}
                  >
                    {copy('solarCreateContract')}
                  </Link>
                )}
              </div>
            )}
          {recordId
            ? Object.keys(solarPostalDecisions).some((key) =>
                availablePostalDecision(key as SolarPostalOperation, row)
              ) && (
                <div className={recordEditorSurface}>
                  <RecordEditorSection
                    title={tSolarStaffRecord(
                      row.postal_status === 'shipped' ? 'shipmentDecision' : 'finalDecision',
                      locale
                    )}
                  >
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(solarPostalDecisions) as SolarPostalOperation[])
                        .filter((operation) => availablePostalDecision(operation, row))
                        .map((operation) => (
                          <Link
                            key={operation}
                            to="/admin/solar-requests/$requestId/postal/{-$operation}"
                            params={{ requestId: recordId, operation }}
                            search={queueSearch ?? {}}
                            className={buttonVariants({
                              variant:
                                operation === 'confirm-received' ||
                                operation === 'start-final-review' ||
                                operation === 'final-approve'
                                  ? 'default'
                                  : 'outline',
                              size: 'sm',
                              className: 'h-auto min-h-9 max-w-full whitespace-normal',
                            })}
                            aria-disabled={navigationBlocked() || undefined}
                            onClick={(event) => {
                              if (navigationBlocked()) event.preventDefault();
                            }}
                          >
                            {copy(solarPostalDecisions[operation].title)}
                          </Link>
                        ))}
                    </div>
                  </RecordEditorSection>
                </div>
              )
            : (row.postal_status === 'shipped' ||
                ['postal_documents_received', 'final_review', 'approved'].includes(
                  row.request_status
                )) && (
                <div className={recordEditorSurface}>
                  <RecordEditorSection
                    title={tSolarStaffRecord(
                      row.postal_status === 'shipped' ? 'shipmentDecision' : 'finalDecision',
                      locale
                    )}
                  >
                    {(row.postal_status === 'shipped' ||
                      row.request_status !== 'postal_documents_received') && (
                      <Form {...reasonForm}>
                        {reasonForm.formState.errors.root && (
                          <Alert variant="destructive">
                            <AlertDescription>
                              {copy('documentValidationUnavailable')}
                            </AlertDescription>
                          </Alert>
                        )}
                        <FormField
                          control={reasonForm.control}
                          name="reason"
                          render={({ field }) => (
                            <FormItem id="solar-postal-reason" className={recordEditorField}>
                              <FormLabel>{copy('reason')}</FormLabel>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  aria-required={row.request_status === 'approved' || undefined}
                                  disabled={editorLocked || decisionUnconfirmed}
                                  rows={2}
                                  className="min-h-14 resize-y"
                                  placeholder={tSolarStaffRecord(
                                    row.postal_status === 'shipped'
                                      ? 'shipmentNoteExample'
                                      : 'finalNoteExample',
                                    locale
                                  )}
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
                  </RecordEditorSection>
                  <RecordEditorActions>
                    {row.postal_status === 'shipped' && (
                      <>
                        <Button
                          loading={preparingDecision || reasonForm.formState.isSubmitting}
                          disabled={editorLocked || decisionUnconfirmed}
                          onClick={() => void decide('confirm-received')}
                        >
                          {copy('postal_confirm-received')}
                        </Button>
                        <Button
                          variant="outline"
                          loading={preparingDecision || reasonForm.formState.isSubmitting}
                          disabled={editorLocked || decisionUnconfirmed}
                          onClick={() => void decide('mark-incomplete')}
                        >
                          {copy('postal_mark-incomplete')}
                        </Button>
                        <Button
                          variant="outline"
                          loading={preparingDecision || reasonForm.formState.isSubmitting}
                          disabled={editorLocked || decisionUnconfirmed}
                          onClick={() => void decide('mark-not-received')}
                        >
                          {copy('postal_mark-not-received')}
                        </Button>
                      </>
                    )}
                    {row.request_status === 'postal_documents_received' && (
                      <Button
                        type="button"
                        disabled={editorLocked || decisionUnconfirmed}
                        onClick={startFinalReview}
                      >
                        {copy('solarStartFinalReview')}
                      </Button>
                    )}
                    {row.request_status === 'final_review' && (
                      <>
                        <Button
                          type="button"
                          loading={preparingDecision || reasonForm.formState.isSubmitting}
                          disabled={editorLocked || decisionUnconfirmed}
                          onClick={() => void prepareFinalDecision('approve', row.id)}
                        >
                          {copy('solarFinalApprove')}
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          loading={preparingDecision || reasonForm.formState.isSubmitting}
                          disabled={editorLocked || decisionUnconfirmed}
                          onClick={() => void prepareFinalDecision('reject', row.id)}
                        >
                          {copy('solarFinalReject')}
                        </Button>
                      </>
                    )}
                    {['final_review', 'approved'].includes(row.request_status) && (
                      <Button
                        type="button"
                        variant="outline"
                        loading={preparingDecision || reasonForm.formState.isSubmitting}
                        disabled={editorLocked || decisionUnconfirmed}
                        onClick={() => void prepareFinalDecision('close-no-contract', row.id)}
                      >
                        {copy('solarCloseNoContract')}
                      </Button>
                    )}
                  </RecordEditorActions>
                </div>
              )}
          {!recordId && contractEditor}
        </section>
      )}
      {guidanceEditor && !guidance && !guidanceError && (
        <LoadingStatus>{copy('loading')}</LoadingStatus>
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
          <div
            role="group"
            aria-label={copy('postalGuidance')}
            className="mx-auto w-full max-w-3xl"
          >
            <form className={recordEditorSurface} onSubmit={saveGuidance} noValidate>
              {(!guidanceEditor ||
                guidanceForm.formState.errors.root ||
                guidanceUnconfirmed ||
                guidanceDenied) && (
                <div className="space-y-2 border-b px-4 py-3 sm:px-6">
                  {!guidanceEditor && (
                    <h2 className="text-base font-semibold">{copy('postalGuidance')}</h2>
                  )}
                  {guidanceForm.formState.errors.root && (
                    <Alert variant="destructive">
                      <AlertDescription>{copy('documentValidationUnavailable')}</AlertDescription>
                    </Alert>
                  )}
                  {(guidanceUnconfirmed || guidanceDenied) && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {copy(
                          guidanceDenied ? 'postalGuidanceForbidden' : 'postalGuidanceUnconfirmed'
                        )}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <RecordEditorSection title={tSolarStaffRecord('customerInstructions', locale)}>
                <div className={recordEditorGrid}>
                  <SolarGuidanceField
                    form={guidanceForm}
                    name="fa"
                    id="solar-postal-guidance-fa"
                    label={copy('postalGuidance_fa')}
                    direction="rtl"
                    help={copy('documentGuidanceHelp')}
                    disabled={editorLocked || guidanceDenied}
                    required
                  />
                  <SolarGuidanceField
                    form={guidanceForm}
                    name="en"
                    id="solar-postal-guidance-en"
                    label={copy('postalGuidance_en')}
                    direction="ltr"
                    help={copy('documentGuidanceHelp')}
                    disabled={editorLocked || guidanceDenied}
                    required
                  />
                </div>
              </RecordEditorSection>
              <RecordEditorSection title={tSolarStaffRecord('postalDestination', locale)}>
                <div className={recordEditorGrid}>
                  <SolarGuidanceField
                    form={guidanceForm}
                    name="destinationAddress"
                    id="solar-postal-guidance-destination-address"
                    label={copy('postalGuidance_destinationAddress')}
                    direction="auto"
                    help={copy('postalAddressHelp')}
                    disabled={editorLocked || guidanceDenied}
                  />
                  <SolarGuidanceField
                    form={guidanceForm}
                    name="contactDetails"
                    id="solar-postal-guidance-contact-details"
                    label={copy('postalGuidance_contactDetails')}
                    direction="auto"
                    help={copy('postalContactHelp')}
                    disabled={editorLocked || guidanceDenied}
                  />
                </div>
              </RecordEditorSection>
              <SolarGuidanceItems
                title={tSolarStaffRecord('requiredOriginals', locale)}
                rows={guidanceItems.fields}
                disabled={editorLocked || guidanceDenied}
                error={
                  guidanceForm.formState.errors.items?.root?.message ??
                  guidanceForm.formState.errors.items?.message
                }
                onAdd={() =>
                  guidanceItems.append(
                    { fa: '', en: '' },
                    { focusName: `items.${guidanceItems.fields.length}.${locale}` }
                  )
                }
                onRemove={guidanceItems.remove}
                renderField={(index, language, label) => (
                  <SolarGuidanceField
                    form={guidanceForm}
                    name={`items.${index}.${language}`}
                    id={`solar-postal-guidance-item-${index}-${language}`}
                    label={label}
                    direction={language === 'fa' ? 'rtl' : 'ltr'}
                    disabled={editorLocked || guidanceDenied}
                    required
                  />
                )}
              />
              <RecordEditorActions>
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
              </RecordEditorActions>
            </form>
          </div>
        </Form>
      )}
      {action && (
        <TeamActionDialog
          action={action}
          finalFocus={
            decisionEditor || (guidanceEditor && guidanceAction)
              ? () =>
                  document.querySelector<HTMLElement>(
                    decisionEditor
                      ? '#solar-postal-reason[aria-invalid="true"]'
                      : '[data-slot="solar-staff-guidance"] [aria-invalid="true"]'
                  ) ?? true
              : undefined
          }
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
              ? guidanceFields(
                  guidanceErrorPaths(fields, 'originals', !!guidanceItems.fields.length)
                )
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
              if (decisionEditor) setDecisionRecorded(true);
              setError(false);
              refresh();
              reasonForm.reset({ reason: '' });
            }
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </div>
  );
}
