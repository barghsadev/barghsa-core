import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { historyContextText } from '../lib/history-context.js';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { t as appText } from '@barghsa/i18n/app';
import { useEffect, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import {
  Button,
  Alert,
  FinancialReviewSummary,
  Label,
  ListPage,
  StatusBadge,
  DateCell,
  TextCell,
  StatusTimeline,
  type StatusTone,
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
import { tConsultationFee } from '@barghsa/i18n/consultation-fee';
import { tConsultationResolution } from '@barghsa/i18n/consultation-resolution';
import {
  matchedConsultationResolutionReview,
  matchedConsultationResolutionReceipt,
  type ConsultationResolutionIntent,
  type ConsultationResolutionSource,
} from '../lib/consultation-resolution-form.js';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useAccountUser } from '../hooks/useAccountUser.js';
import {
  emptyConsultationFee,
  consultationFeeTerms,
  consultationFeeFields,
  matchedConsultationFeeReview,
  matchedConsultationFeeReceipt,
  publicConsultationFeeError,
  definitiveConsultationFeeRejection,
  type ConsultationFeeDraft,
  type ConsultationFeeSource,
  type ConsultationFeeReviewValue,
} from '../lib/consultation-fee-form.js';
import { tConsultation } from '@barghsa/i18n/consultation';
import {
  type ConsultationFeeReview,
  type ConsultationPaidFeeReview,
  type ConsultationPaidResolutionReview,
} from '@barghsa/shared/finance';
import { useLocale } from '../hooks/useLocale.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { offerInputFromInstant } from '../lib/consultation-offer-time.js';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { staffOrderId } from '../lib/staff-order-list-query.js';
import type { ConsultationListQuery } from '../lib/support-list-query.js';
import { consultationReceipt, type ConsultationReasonDraft } from '../lib/consultation-form.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';

interface RequestRow {
  id: string;
  profile_id: string;
  profile_name: string;
  status: string;
  product_snapshot: { title: { fa: string; en: string } };
  staff_owner_id: string | null;
  staff_owner_name?: string | null;
  staff_team: string | null;
  submitted_at: string;
  priority: 'high' | 'normal';
}
interface Detail {
  request: RequestRow & {
    scope: string | null;
    deliverables: string | null;
    fee: string | null;
    invoice_id: string | null;
    invoice_state: string | null;
    has_paid_invoice: boolean;
    uncovered_credit: string;
    offer_valid_until: string | null;
    expected_next_step: string | null;
  };
  history: Array<{
    status: string;
    actor_type: 'staff' | 'customer' | 'unknown';
    actor_name?: string | null;
    reason: string | null;
    created_at: string;
  }>;
}

const statuses = [
  'submitted',
  'under_review',
  'awaiting_customer_info',
  'offer_pending',
  'offer_accepted',
  'offer_declined',
  'completed',
  'rejected',
  'cancelled',
] as const;

type ReasonIntent = 'request-info' | 'complete' | 'reject' | 'cancel' | 'recover_refund';
interface FeeCommand {
  action: TeamAction;
  source: ConsultationFeeSource;
  review: ConsultationFeeReviewValue;
  scope: string;
  generation: number;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
}
interface ResolutionCommand {
  action: TeamAction;
  source: ConsultationResolutionSource;
  review: ConsultationPaidResolutionReview;
  scope: string;
  generation: number;
  attempted: boolean;
  uncertain: boolean;
  rejected: boolean;
}
interface ReasonCommand {
  requestId: string;
  profileId: string;
  reason: string;
  expectedStatus: string;
  history: Detail['history'];
  paid: boolean;
}
function validHistory(value: unknown): value is Detail['history'] {
  return (
    Array.isArray(value) &&
    value.every(
      (event) =>
        event &&
        typeof event === 'object' &&
        !Array.isArray(event) &&
        typeof event.status === 'string' &&
        typeof event.actor_type === 'string' &&
        (event.reason === null || typeof event.reason === 'string') &&
        typeof event.created_at === 'string' &&
        Number.isFinite(Date.parse(event.created_at)) &&
        (event.actor_name === undefined ||
          event.actor_name === null ||
          typeof event.actor_name === 'string')
    )
  );
}
function savedReason(detail: Detail, command: ReasonCommand) {
  const stable = (event: Detail['history'][number]) =>
    JSON.stringify([event.status, event.actor_type, event.reason, event.created_at]);
  return (
    detail.request.id === command.requestId &&
    detail.request.profile_id === command.profileId &&
    Array.isArray(detail.history) &&
    detail.history.length > command.history.length &&
    command.history.every((event, index) => {
      const saved = detail.history[index];
      return saved !== undefined && stable(event) === stable(saved);
    }) &&
    detail.history
      .slice(command.history.length)
      .some(
        (event) =>
          event.actor_type === 'staff' &&
          event.status === command.expectedStatus &&
          event.reason === command.reason &&
          typeof event.created_at === 'string' &&
          Number.isFinite(Date.parse(event.created_at))
      )
  );
}

const statusTones: Record<(typeof statuses)[number], StatusTone> = {
  submitted: 'info',
  under_review: 'warning',
  awaiting_customer_info: 'warning',
  offer_pending: 'warning',
  offer_accepted: 'success',
  offer_declined: 'destructive',
  completed: 'default',
  rejected: 'destructive',
  cancelled: 'destructive',
};
function consultationStatus(status: string, copy: (key: string) => string) {
  return Object.hasOwn(statusTones, status)
    ? { label: copy(`status_${status}`), tone: statusTones[status as keyof typeof statusTones] }
    : { label: copy('status_unknown'), tone: 'default' as const };
}
function ConsultationAssignment({
  request,
  copy,
}: {
  request: RequestRow;
  copy: (key: string) => string;
}) {
  const team = request.staff_team?.trim();
  const owner = request.staff_owner_id
    ? request.staff_owner_name?.trim() || copy('assignedStaff')
    : team
      ? copy('awaitingOwner')
      : copy('unassigned');
  return (
    <span
      data-slot="consultation-assignment"
      className="flex min-w-0 flex-col gap-1 text-sm text-muted-foreground"
    >
      <span>
        {copy('owner')}: <bdi className="break-words">{owner}</bdi>
      </span>
      {team && (
        <span>
          {copy('team')}: <bdi className="break-words">{team}</bdi>
        </span>
      )}
    </span>
  );
}

export function AdminConsultationsPage(
  props: Parameters<typeof OwnedAdminConsultationsPage>[0] = {}
) {
  const profileRevision = useProfileContextRevision();
  return <OwnedAdminConsultationsPage key={profileRevision} {...props} />;
}
function OwnedAdminConsultationsPage({ queries }: { queries?: ConsultationListQuery } = {}) {
  const { assignment: initialAssignment } = useSearch({ from: '/admin/consultations' });
  const readActor = useAccountUser();
  const readProfileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(readActor, readProfileRevision);
  const locale = useLocale();
  const actor = useAccountUser();
  const time = useAccountTime(locale);
  const copy = (key: string) => tConsultation(key, locale);
  const feeCopy = (key: string) => tConsultationFee(key, locale);
  const resolutionCopy = (key: string) => tConsultationResolution(key, locale);
  const [accepted, setAccepted] = useState<{
    criteria: string;
    cursor: string | null;
    rows: RequestRow[];
    nextAfter: string | null;
  } | null>(null);
  const [localAfter, setLocalAfter] = useState<string | null>(null);
  const after = queries ? queries.queue.query.cursor || null : localAfter;
  const setAfter = (value: string | null) =>
    queries ? queries.queue.setQuery({ cursor: value ?? '' }) : setLocalAfter(value);
  const [queueLoading, setQueueLoading] = useState(true);
  const [localSelected, setLocalSelected] = useState<string | null>(null);
  const selectedId = queries ? queries.selected : localSelected;
  const setSelectedId = (id: string | null, replace = false) =>
    queries ? queries.select(id, replace) : setLocalSelected(id);
  const [loadedDetail, setDetail] = useState<Detail | null>(null);
  const detailScope = useRef('');
  const [status, setStatus] = useState('');
  const [assignment, setAssignment] = useState(initialAssignment ?? 'all');
  const [priority, setPriority] = useState('all');
  const [minAgeDays, setMinAgeDays] = useState('0');
  const appliedStatus = queries ? queries.queue.query.filters.status || '' : status;
  const appliedAssignment = queries ? queries.queue.query.filters.assignment || 'all' : assignment;
  const appliedPriority = queries ? queries.queue.query.filters.priority || 'all' : priority;
  const appliedMinAgeDays = queries ? queries.queue.query.filters.minAgeDays || '0' : minAgeDays;
  const criteria = JSON.stringify([
    appliedStatus,
    appliedAssignment,
    appliedPriority,
    appliedMinAgeDays,
    actor,
  ]);
  const rows = accepted?.criteria === criteria ? accepted.rows : [];
  const nextAfter = accepted?.criteria === criteria ? accepted.nextAfter : null;
  const queueScope = JSON.stringify([criteria, after]);
  const currentQueueScope = useRef(queueScope);
  currentQueueScope.current = queueScope;
  const workScope = JSON.stringify([criteria, selectedId]);
  const detail =
    loadedDetail?.request.id === selectedId && detailScope.current === workScope
      ? loadedDetail
      : null;
  const work = useRef({ scope: workScope, generation: 0 });
  if (work.current.scope !== workScope)
    work.current = { scope: workScope, generation: work.current.generation + 1 };
  const [team, setTeam] = useState('');
  const [teamNames, setTeams] = useState<string[]>([]);
  const [teamsActor, setTeamsActor] = useState<string | null>(null);
  const teams = teamsActor === actor ? teamNames : [];
  const reasonPaidRef = useRef(false);
  const [reasonPaid, setReasonPaid] = useState(false);
  const reasonForm = useZodForm<ConsultationReasonDraft>(
    async () => {
      const generation = work.current.generation;
      const schemas = await import('../lib/consultation-form-schemas.js');
      // Touched validation uses the intent selected while the schema was loading.
      const paid = reasonPaidRef.current;
      return generation === work.current.generation
        ? schemas.reasonSchema(
            copy(paid ? 'paidReasonInvalid1000' : 'reasonInvalid2000'),
            paid ? 1000 : 2000
          )
        : schemas.inactiveReasonSchema;
    },
    { defaultValues: { reason: '' }, validationUnavailableMessage: copy('validationUnavailable') }
  );
  const reasonFields = useActionFieldErrors(
    reasonForm,
    { reason: copy(reasonPaid ? 'paidReasonInvalid1000' : 'reasonInvalid2000') },
    copy('actionError')
  );
  const feeSource = useRef<Detail['request'] | null>(null);
  feeSource.current = detail?.request ?? null;
  const feeZone = useRef<string | null>(null);
  feeZone.current = time.status === 'ready' ? time.timezone : null;
  const feeMessages = {
    fee: feeCopy(detail?.request.status === 'offer_accepted' ? 'paidFeeInvalid' : 'feeInvalid'),
    scope: feeCopy('scopeInvalid'),
    deliverables: feeCopy('deliverablesInvalid'),
    validUntil: feeCopy('deadlineInvalid'),
    reason: feeCopy(
      detail?.request.status === 'offer_accepted' ? 'paidReasonInvalid' : 'replacementReasonInvalid'
    ),
  };
  const feeForm: ReturnType<typeof useZodForm<ConsultationFeeDraft>> =
    useZodForm<ConsultationFeeDraft>(
      async () => {
        // RHF owns touched-field values; command preparation separately fences edited drafts.
        const generation = work.current.generation;
        const source = feeSource.current;
        const zone = feeZone.current;
        const schemas = await import('../lib/consultation-fee-form-schemas.js');
        return source &&
          work.current.scope === workScope &&
          generation === work.current.generation &&
          source === feeSource.current &&
          zone === feeZone.current
          ? schemas.consultationFeeSchema(source, zone, feeMessages)
          : schemas.inactiveConsultationFeeSchema;
      },
      {
        defaultValues: emptyConsultationFee,
        validationUnavailableMessage: feeCopy('validationUnavailable'),
      }
    );
  const feeFields = useActionFieldErrors(feeForm, feeMessages, copy('actionError'));
  const setFee = (value: string) => feeForm.setValue('fee', value);
  const setScope = (value: string) => feeForm.setValue('scope', value);
  const setDeliverables = (value: string) => feeForm.setValue('deliverables', value);
  const setValidUntil = (value: string) => feeForm.setValue('validUntil', value);
  const setOfferReason = (value: string) => feeForm.setValue('reason', value);
  const feeCommand = useRef<FeeCommand | null>(null);
  const [feeUncertain, setFeeUncertain] = useState(false);
  const resolutionCommand = useRef<ResolutionCommand | null>(null);
  const [resolutionUncertain, setResolutionUncertain] = useState(false);
  const readGeneration = useRef(0);
  const detailAbort = useRef<AbortController | null>(null);
  const queueAbort = useRef<AbortController | null>(null);
  function invalidateFeeReads() {
    ++readGeneration.current;
    detailAbort.current?.abort();
    queueAbort.current?.abort();
    setQueueLoading(false);
  }
  function feeActive(command: FeeCommand) {
    return (
      work.current.scope === workScope &&
      feeCommand.current === command &&
      command.scope === work.current.scope &&
      command.generation === work.current.generation
    );
  }
  function feeUnknown(command: FeeCommand) {
    if (!feeActive(command)) return;
    command.uncertain = true;
    setFeeUncertain(true);
    commandPendingRef.current = false;
    setCommandPending(false);
    actionRef.current = null;
    setAction(null);
  }
  function feeRelease(command: FeeCommand) {
    if (!feeActive(command)) return;
    feeCommand.current = null;
    setFeeUncertain(false);
    clearAction();
  }
  function showFeeFields(value: unknown, source: ConsultationFeeSource) {
    const error = definitiveConsultationFeeRejection(value);
    if (error?.code !== ErrorCodes.VALIDATION_INPUT_INVALID.code || !Array.isArray(error.fields))
      return false;
    const fields = consultationFeeFields(error.fields, source);
    return !!fields && feeFields(fields);
  }
  function decorateFeeAction(command: FeeCommand, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        'VALIDATION:INPUT_INVALID',
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (result: unknown) => {
          if (
            !feeActive(command) ||
            command.action !== ownedAction ||
            actionRef.current !== ownedAction
          )
            return copy('actionError');
          if (publicConsultationFeeError(result)?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
            denyAction();
            return copy('actionError');
          }
          if (definitiveConsultationFeeRejection(result)) {
            command.rejected = true;
            if (!command.uncertain && showFeeFields(result, command.source)) feeRelease(command);
          }
          return copy('actionError');
        },
      ])
    );
  }
  function retryFee() {
    const command = feeCommand.current;
    if (!command || !feeActive(command) || commandPendingRef.current) return;
    const next = { ...command.action };
    command.action = next;
    decorateFeeAction(command, next);
    actionRef.current = next;
    setAction(next);
    actionScope.current = workScope;
    actionGeneration.current = work.current.generation;
  }
  const offerDirty = useRef(false);
  const [offerKey, setOfferKey] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  const [listRevision, setListRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [teamsRevision, setTeamsRevision] = useState(0);
  const [queueError, setQueueError] = useState(false);
  const [queueDenied, setQueueDenied] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [teamsError, setTeamsError] = useState(false);
  const reviewRequest = useRef(0);
  const [error, setError] = useState(false);
  const [action, setAction] = useState<TeamAction | null>(null);
  const actionRef = useRef<TeamAction | null>(null);
  const actionScope = useRef(workScope);
  const actionGeneration = useRef(0);
  const reasonCommand = useRef<ReasonCommand | null>(null);
  const recoveringReason = useRef<ReasonCommand | null>(null);
  const unconfirmedRef = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const preparingRef = useRef(false);
  const commandPendingRef = useRef(false);
  const [commandPending, setCommandPending] = useState(false);
  const [feeReview, setFeeReview] = useState<ConsultationFeeReview | null>(null);
  const [paidFeeReview, setPaidFeeReview] = useState<ConsultationPaidFeeReview | null>(null);
  const [resolutionReview, setResolutionReview] = useState<ConsultationPaidResolutionReview | null>(
    null
  );
  const [reviewLoading, setReviewLoading] = useState(false);
  const accessGeneration = useRef(0);
  function busy() {
    return (
      !!feeCommand.current ||
      !!resolutionCommand.current ||
      feeForm.isSubmissionPending() ||
      !!actionRef.current ||
      preparingRef.current ||
      commandPendingRef.current ||
      reasonForm.isSubmissionPending() ||
      unconfirmedRef.current
    );
  }
  function navigationBlocked() {
    return (
      commandPendingRef.current ||
      !!feeCommand.current ||
      !!resolutionCommand.current ||
      (reasonPaidRef.current && preparingRef.current)
    );
  }
  function clearAction() {
    actionRef.current = null;
    setAction(null);
    reasonCommand.current = null;
    setFeeReview(null);
    setPaidFeeReview(null);
    setResolutionReview(null);
    commandPendingRef.current = false;
    setCommandPending(false);
  }
  function denyAction() {
    accessGeneration.current += 1;
    reviewRequest.current += 1;
    work.current.generation += 1;
    clearAction();
    feeCommand.current = null;
    setFeeUncertain(false);
    resolutionCommand.current = null;
    setResolutionUncertain(false);
    feeForm.reset(emptyConsultationFee);
    invalidateFeeReads();
    recoveringReason.current = null;
    unconfirmedRef.current = false;
    setUnconfirmed(false);
    setAccepted(null);
    setSelectedId(null, true);
    setDetail(null);
    setQueueDenied(true);
    reasonForm.reset({ reason: '' });
  }
  useEffect(
    () => () => {
      work.current.generation += 1;
    },
    []
  );
  function resetQueue(clearSelection = false) {
    setAccepted(null);
    setAfter(null);
    if (clearSelection) setSelectedId(null);
  }
  function refresh() {
    if (navigationBlocked()) return;
    resetQueue();
    setRevision((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    const capturedAccess = accessGeneration.current;
    const capturedRead = readGeneration.current;
    setTeamsError(false);
    void readStaff('catalogue', 'detail', '/api/admin/consultations/teams', controller.signal)
      .then(async (response) => {
        if (!response.ok) throw new Error('teams');
        return (await response.json()) as { teams: Array<{ name: string }> };
      })
      .then((result) => {
        if (
          !controller.signal.aborted &&
          capturedAccess === accessGeneration.current &&
          capturedRead === readGeneration.current
        ) {
          setTeams(result.teams.map((item) => item.name));
          setTeamsActor(actor);
        }
      })
      .catch(() => {
        if (
          !controller.signal.aborted &&
          capturedRead === readGeneration.current &&
          capturedAccess === accessGeneration.current
        )
          setTeamsError(true);
      });
    return () => controller.abort();
  }, [revision, teamsRevision, readStaff]);

  useEffect(() => {
    const controller = new AbortController();
    const capturedAccess = accessGeneration.current;
    const capturedRead = readGeneration.current;
    queueAbort.current = controller;
    setQueueError(false);
    setQueueDenied(false);
    setQueueLoading(true);
    const query = new URLSearchParams({
      assignment: appliedAssignment,
      priority: appliedPriority,
      minAgeDays: appliedMinAgeDays,
    });
    if (appliedStatus) query.set('status', appliedStatus);
    if (after) query.set('after', after);
    void readStaff(
      'consultations',
      'list',
      `/api/admin/consultations/requests?${query}`,
      controller.signal
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { requests: RequestRow[]; nextAfter: string | null };
      })
      .then((result) => {
        if (
          !controller.signal.aborted &&
          capturedAccess === accessGeneration.current &&
          capturedRead === readGeneration.current &&
          currentQueueScope.current === queueScope
        ) {
          setAccepted((current) => {
            const extending =
              !!after &&
              current?.criteria === criteria &&
              current.nextAfter === after &&
              current.cursor !== after;
            const previous = extending ? current.rows : [];
            const shown = new Set(previous.map((request) => request.id));
            return {
              criteria,
              cursor: after,
              rows: [...previous, ...result.requests.filter((request) => !shown.has(request.id))],
              nextAfter: staffOrderId(result.nextAfter) || null,
            };
          });
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          capturedAccess !== accessGeneration.current ||
          capturedRead !== readGeneration.current ||
          currentQueueScope.current !== queueScope
        )
          return;
        if (error instanceof Error && ['401', '403'].includes(error.message)) {
          denyAction();
          setReviewLoading(false);
        } else setQueueError(true);
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          capturedRead === readGeneration.current &&
          currentQueueScope.current === queueScope
        )
          setQueueLoading(false);
      });
    return () => controller.abort();
  }, [
    appliedStatus,
    appliedAssignment,
    appliedPriority,
    appliedMinAgeDays,
    criteria,
    after,
    queueScope,
    revision,
    listRevision,
    readStaff,
  ]);

  useEffect(() => {
    feeCommand.current = null;
    setFeeUncertain(false);
    resolutionCommand.current = null;
    setResolutionUncertain(false);
    feeForm.reset(emptyConsultationFee);
    clearAction();
    preparingRef.current = false;
    reasonCommand.current = null;
    reasonForm.reset({ reason: '' });
    reasonPaidRef.current = false;
    setReasonPaid(false);
    recoveringReason.current = null;
    unconfirmedRef.current = false;
    setUnconfirmed(false);
    setTeam('');
    setFee('');
    setScope('');
    setDeliverables('');
    setValidUntil('');
    setOfferReason('');
    offerDirty.current = false;
    setOfferKey(crypto.randomUUID());
    setError(false);
  }, [workScope]);

  useEffect(() => {
    if (feeCommand.current || resolutionCommand.current) return;
    reviewRequest.current += 1;
    setFeeReview(null);
    setPaidFeeReview(null);
    setResolutionReview(null);
    clearAction();
    preparingRef.current = false;
    setReviewLoading(false);
    setDetailError(false);
    if (!selectedId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    detailAbort.current = controller;
    const capturedRead = readGeneration.current;
    const capturedGeneration = work.current.generation;
    const recoveryAtRead = recoveringReason.current;
    setDetail(null);
    void readStaff(
      'consultations',
      'detail',
      `/api/admin/consultations/requests/${encodeURIComponent(selectedId)}`,
      controller.signal
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const result = (await response.json()) as Detail;
        if (
          result?.request?.id !== selectedId ||
          typeof result.request.profile_id !== 'string' ||
          !validHistory(result.history)
        )
          throw new Error('detail');
        return result;
      })
      .then((result) => {
        if (
          !controller.signal.aborted &&
          capturedGeneration === work.current.generation &&
          capturedRead === readGeneration.current
        ) {
          detailScope.current = workScope;
          setDetail(result);
          const command = recoveringReason.current;
          if (
            command &&
            command === recoveryAtRead &&
            !commandPendingRef.current &&
            savedReason(result, command)
          ) {
            recoveringReason.current = null;
            unconfirmedRef.current = false;
            setUnconfirmed(false);
            reasonForm.reset({ reason: '' });
          }
          if (!offerDirty.current) {
            setFee(result.request.fee ?? '');
            // Paid revisions consume amount/deadline/reason, preserving hidden ordinary-offer drafts.
            if (!result.request.has_paid_invoice) {
              setScope(result.request.scope ?? '');
              setDeliverables(result.request.deliverables ?? '');
            }
            setOfferReason('');
          }
        }
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          capturedGeneration !== work.current.generation ||
          capturedRead !== readGeneration.current
        )
          return;
        if (error instanceof Error && ['401', '403', '404'].includes(error.message)) denyAction();
        else setDetailError(true);
      });
    return () => controller.abort();
  }, [selectedId, criteria, revision, detailRevision, workScope, readStaff]);

  useEffect(() => {
    if (
      detail &&
      time.status === 'ready' &&
      !offerDirty.current &&
      !feeCommand.current &&
      !resolutionCommand.current
    ) {
      setValidUntil(offerInputFromInstant(detail.request.offer_valid_until, time.timezone));
    }
  }, [detail, time.status, time.timezone]);

  function prepare(path: string, title: string, body: Record<string, unknown> = {}) {
    if (busy()) return;
    propose(path, title, body);
  }
  function propose(path: string, title: string, body: Record<string, unknown> = {}) {
    if (
      !selectedId ||
      work.current.scope !== workScope ||
      actionRef.current ||
      commandPendingRef.current ||
      unconfirmedRef.current
    )
      return;
    const next: TeamAction = {
      title,
      description: `${detail?.request.profile_name ?? ''} · ${title}`,
      path: `/api/admin/consultations/requests/${selectedId}/${path}`,
      method: 'POST',
      body,
      forbiddenMessage: copy('actionError'),
    };
    actionScope.current = workScope;
    actionGeneration.current = work.current.generation;
    actionRef.current = next;
    setAction(next);
  }
  function prepareReason(intent: ReasonIntent, title: string, paid = false) {
    if (work.current.scope !== workScope || !selectedId || !detail || busy()) return;
    reasonPaidRef.current = paid;
    setReasonPaid(paid);
    reasonForm.clearErrors();
    const generation = work.current.generation;
    const captured = detail;
    const raw = reasonForm.getValues().reason;
    if (paid) {
      preparingRef.current = true;
      invalidateFeeReads();
    }
    void reasonForm
      .handleSubmit(async (draft) => {
        if (
          generation !== work.current.generation ||
          work.current.scope !== workScope ||
          captured.request !== feeSource.current ||
          raw !== reasonForm.getValues().reason
        )
          return;
        const reason = draft.reason.trim();
        reasonCommand.current = {
          requestId: captured.request.id,
          profileId: captured.request.profile_id,
          reason,
          expectedStatus:
            intent === 'request-info'
              ? 'awaiting_customer_info'
              : intent === 'complete'
                ? 'completed'
                : intent === 'reject'
                  ? 'rejected'
                  : intent === 'cancel'
                    ? 'cancelled'
                    : captured.request.status,
          history: captured.history.map((event) => ({ ...event })),
          paid,
        };
        if (paid)
          await preparePaidResolution(
            intent as ConsultationResolutionIntent,
            title,
            reason,
            raw,
            captured.request,
            generation
          );
        else propose(intent, title, { reason });
      })()
      .finally(() => {
        if (paid && generation === work.current.generation && work.current.scope === workScope) {
          preparingRef.current = false;
          setReviewLoading(false);
        }
      });
  }

  function prepareFeeOffer() {
    prepareFee(false);
  }
  function preparePaidFee() {
    prepareFee(true);
  }
  function prepareFee(paid: boolean) {
    if (work.current.scope !== workScope || !selectedId || !detail || !feeZone.current || busy())
      return;
    const capturedSource = detail.request;
    const capturedZone = feeZone.current;
    const generation = work.current.generation;
    const request = ++reviewRequest.current;
    const raw = JSON.stringify(feeForm.getValues());
    preparingRef.current = true;
    setReviewLoading(true);
    setError(false);
    feeForm.clearErrors();
    void feeForm
      .handleSubmit(async (draft) => {
        if (
          work.current.scope !== workScope ||
          generation !== work.current.generation ||
          request !== reviewRequest.current ||
          capturedSource !== feeSource.current ||
          capturedZone !== feeZone.current ||
          raw !== JSON.stringify(feeForm.getValues()) ||
          !capturedZone
        )
          return;
        const terms = consultationFeeTerms(draft, capturedSource, capturedZone);
        if (!terms) return;
        try {
          const response = await fetch(
            `/api/admin/consultations/requests/${encodeURIComponent(selectedId)}/${paid ? 'paid-fee-review' : 'fee-review'}`,
            {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(terms),
            }
          );
          const value = await response.json().catch(() => null);
          if (
            work.current.scope !== workScope ||
            generation !== work.current.generation ||
            request !== reviewRequest.current ||
            capturedSource !== feeSource.current ||
            capturedZone !== feeZone.current
          )
            return;
          if ([401, 403, 404].includes(response.status)) {
            denyAction();
            return;
          }
          if (raw !== JSON.stringify(feeForm.getValues())) return;
          if (!response.ok) {
            if (response.status === 400 && showFeeFields(value, capturedSource)) return;
            throw new Error('fee-review');
          }
          const review =
            response.status === 200
              ? matchedConsultationFeeReview(value, capturedSource, terms)
              : null;
          if (!review) throw new Error('fee-review');
          const path = paid ? 'paid-fee' : 'fee';
          const next: TeamAction = {
            title: copy(
              paid ? 'adjustPaidFee' : capturedSource.invoice_id ? 'replaceFee' : 'issueFee'
            ),
            description: `${capturedSource.profile_name} · ${copy(paid ? 'adjustPaidFee' : 'feeOffer')}`,
            path: `/api/admin/consultations/requests/${selectedId}/${path}`,
            method: 'POST',
            successStatus: 200,
            body: { ...terms, idempotencyKey: offerKey, expectedReviewHash: review.hash },
            forbiddenMessage: copy('actionError'),
          };
          const command: FeeCommand = {
            action: next,
            source: capturedSource,
            review,
            scope: workScope,
            generation,
            attempted: false,
            uncertain: false,
            rejected: false,
          };
          decorateFeeAction(command, next);
          invalidateFeeReads();
          feeCommand.current = command;
          if ('revisedFee' in review.data) setPaidFeeReview(review as ConsultationPaidFeeReview);
          else setFeeReview(review as ConsultationFeeReview);
          actionScope.current = workScope;
          actionGeneration.current = generation;
          actionRef.current = next;
          setAction(next);
        } catch {
          if (
            work.current.scope === workScope &&
            generation === work.current.generation &&
            request === reviewRequest.current &&
            raw === JSON.stringify(feeForm.getValues())
          )
            setError(true);
        }
      })()
      .finally(() => {
        if (
          work.current.scope === workScope &&
          generation === work.current.generation &&
          request === reviewRequest.current
        ) {
          preparingRef.current = false;
          setReviewLoading(false);
        }
      });
  }

  function resolutionActive(command: ResolutionCommand) {
    return (
      work.current.scope === workScope &&
      resolutionCommand.current === command &&
      command.scope === work.current.scope &&
      command.generation === work.current.generation
    );
  }
  function resolutionUnknown(command: ResolutionCommand) {
    if (!resolutionActive(command)) return;
    command.uncertain = true;
    setResolutionUncertain(true);
    commandPendingRef.current = false;
    setCommandPending(false);
    actionRef.current = null;
    setAction(null);
  }
  function resolutionRelease(command: ResolutionCommand) {
    if (!resolutionActive(command)) return;
    resolutionCommand.current = null;
    setResolutionUncertain(false);
    clearAction();
  }
  function showResolutionFields(value: unknown) {
    const error = definitiveConsultationFeeRejection(value);
    return (
      error?.code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
      Array.isArray(error.fields) &&
      error.fields.length > 0 &&
      error.fields.every((field) => field === 'reason') &&
      reasonFields(error.fields)
    );
  }
  function decorateResolutionAction(command: ResolutionCommand, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        'VALIDATION:INPUT_INVALID',
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (result: unknown) => {
          if (
            !resolutionActive(command) ||
            command.action !== ownedAction ||
            actionRef.current !== ownedAction
          )
            return copy('actionError');
          if (publicConsultationFeeError(result)?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
            denyAction();
            return copy('actionError');
          }
          if (definitiveConsultationFeeRejection(result)) {
            command.rejected = true;
            if (!command.uncertain && showResolutionFields(result)) resolutionRelease(command);
          }
          return copy('actionError');
        },
      ])
    );
  }
  function retryResolution() {
    const command = resolutionCommand.current;
    if (!command || !resolutionActive(command) || commandPendingRef.current) return;
    const next = { ...command.action };
    command.action = next;
    decorateResolutionAction(command, next);
    setResolutionReview(command.review);
    actionScope.current = workScope;
    actionGeneration.current = work.current.generation;
    actionRef.current = next;
    setAction(next);
  }
  async function preparePaidResolution(
    intent: ConsultationResolutionIntent,
    title: string,
    reason: string,
    raw: string,
    source: ConsultationResolutionSource,
    generation: number
  ) {
    if (
      work.current.scope !== workScope ||
      generation !== work.current.generation ||
      source !== feeSource.current ||
      raw !== reasonForm.getValues().reason
    )
      return;
    const request = ++reviewRequest.current;
    setReviewLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/admin/consultations/requests/${encodeURIComponent(source.id)}/paid-resolution-review`,
        {
          method: 'POST',
          credentials: 'include',
          headers: withCsrf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ action: intent, reason }),
        }
      );
      const value = await response.json().catch(() => null);
      if (
        work.current.scope !== workScope ||
        generation !== work.current.generation ||
        request !== reviewRequest.current ||
        source !== feeSource.current
      )
        return;
      if ([401, 403, 404].includes(response.status)) {
        denyAction();
        return;
      }
      if (raw !== reasonForm.getValues().reason) return;
      if (!response.ok) {
        if (response.status === 400 && showResolutionFields(value)) return;
        throw new Error('paid-resolution-review');
      }
      const review =
        response.status === 200
          ? matchedConsultationResolutionReview(value, source, intent, reason)
          : null;
      if (!review) throw new Error('paid-resolution-review');
      const next: TeamAction = {
        title,
        description: `${source.profile_name} · ${title}`,
        path: `/api/admin/consultations/requests/${source.id}/${intent === 'recover_refund' ? 'refund-recovery' : `paid-${intent}`}`,
        method: 'POST',
        successStatus: 200,
        body: { idempotencyKey: crypto.randomUUID(), reason, expectedReviewHash: review.hash },
        forbiddenMessage: copy('actionError'),
      };
      const command: ResolutionCommand = {
        action: next,
        source,
        review,
        scope: workScope,
        generation,
        attempted: false,
        uncertain: false,
        rejected: false,
      };
      decorateResolutionAction(command, next);
      resolutionCommand.current = command;
      invalidateFeeReads();
      setResolutionReview(review);
      actionScope.current = workScope;
      actionGeneration.current = generation;
      actionRef.current = next;
      setAction(next);
    } catch {
      if (
        work.current.scope === workScope &&
        request === reviewRequest.current &&
        generation === work.current.generation &&
        raw === reasonForm.getValues().reason
      )
        setError(true);
    }
  }

  const current = detail?.request;
  const editorLocked =
    !!action ||
    !!feeCommand.current ||
    !!resolutionCommand.current ||
    reviewLoading ||
    commandPending ||
    reasonForm.formState.isSubmitting;
  const currentAction = () =>
    work.current.scope === workScope &&
    actionRef.current === action &&
    actionScope.current === work.current.scope &&
    actionGeneration.current === work.current.generation;
  function feeField(
    name: keyof ConsultationFeeDraft,
    id: string,
    label: string,
    help: string,
    kind: 'input' | 'date' | 'textarea'
  ) {
    return (
      <FormField
        control={feeForm.control}
        name={name}
        render={({ field }) => (
          <FormItem id={id} className="space-y-1 text-sm">
            <FormLabel>{label}</FormLabel>
            <FormControl>
              {kind === 'textarea' ? (
                <textarea
                  {...field}
                  aria-required="true"
                  disabled={
                    !!action ||
                    !!feeCommand.current ||
                    !!resolutionCommand.current ||
                    commandPending ||
                    reasonForm.formState.isSubmitting ||
                    unconfirmed ||
                    feeUncertain
                  }
                  onChange={(event) => {
                    offerDirty.current = true;
                    field.onChange(event);
                  }}
                  className="min-h-20 w-full rounded-md border bg-background p-2"
                />
              ) : (
                <input
                  {...field}
                  aria-required="true"
                  type={kind === 'date' ? 'datetime-local' : 'text'}
                  inputMode={kind === 'input' ? 'numeric' : undefined}
                  disabled={
                    !!action ||
                    !!feeCommand.current ||
                    !!resolutionCommand.current ||
                    commandPending ||
                    reasonForm.formState.isSubmitting ||
                    unconfirmed ||
                    feeUncertain ||
                    (kind === 'date' && time.status !== 'ready')
                  }
                  onChange={(event) => {
                    offerDirty.current = true;
                    field.onChange(event);
                  }}
                  className="w-full rounded-md border bg-background p-2"
                />
              )}
            </FormControl>
            <FormDescription>{feeCopy(help)}</FormDescription>
            <div className="grid">
              <p aria-hidden="true" className="invisible col-start-1 row-start-1 text-sm">
                {feeMessages[name]}
              </p>
              <FormMessage className="col-start-1 row-start-1" />
            </div>
          </FormItem>
        )}
      />
    );
  }
  return (
    <main className="space-y-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('staffTitle')}</h1>
          <p className="text-muted-foreground">{copy('staffIntro')}</p>
        </div>
      </header>
      {time.notice}
      <ListPage>
        <ListPage.Toolbar
          filters={
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span>{copy('filterStatus')}</span>
                <select
                  className="w-full rounded-md border bg-background p-2"
                  value={appliedStatus}
                  disabled={navigationBlocked()}
                  onChange={(event) => {
                    if (navigationBlocked() || work.current.scope !== workScope) return;
                    if (queries) queries.setFilters({ status: event.target.value });
                    else {
                      resetQueue(true);
                      setStatus(event.target.value);
                    }
                  }}
                >
                  <option value="">{copy('openRequests')}</option>
                  {statuses.map((item) => (
                    <option key={item} value={item}>
                      {copy(`status_${item}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>{copy('filterAssignment')}</span>
                <select
                  className="w-full rounded-md border bg-background p-2"
                  value={appliedAssignment}
                  disabled={navigationBlocked()}
                  onChange={(event) => {
                    if (navigationBlocked() || work.current.scope !== workScope) return;
                    if (queries) queries.setFilters({ assignment: event.target.value });
                    else {
                      resetQueue(true);
                      setAssignment(event.target.value);
                    }
                  }}
                >
                  <option value="all">{copy('all')}</option>
                  <option value="mine">{copy('mine')}</option>
                  <option value="unassigned">{copy('unassigned')}</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>{copy('priority')}</span>
                <select
                  className="w-full rounded-md border bg-background p-2"
                  value={appliedPriority}
                  disabled={navigationBlocked()}
                  onChange={(event) => {
                    if (navigationBlocked() || work.current.scope !== workScope) return;
                    if (queries) queries.setFilters({ priority: event.target.value });
                    else {
                      resetQueue(true);
                      setPriority(event.target.value);
                    }
                  }}
                >
                  <option value="all">{copy('all')}</option>
                  <option value="high">{copy('high')}</option>
                  <option value="normal">{copy('normal')}</option>
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span>{copy('age')}</span>
                <select
                  className="w-full rounded-md border bg-background p-2"
                  value={appliedMinAgeDays}
                  disabled={navigationBlocked()}
                  onChange={(event) => {
                    if (navigationBlocked() || work.current.scope !== workScope) return;
                    if (queries) queries.setFilters({ minAgeDays: event.target.value });
                    else {
                      resetQueue(true);
                      setMinAgeDays(event.target.value);
                    }
                  }}
                >
                  <option value="0">{copy('all')}</option>
                  <option value="1">{copy('oneDay')}</option>
                  <option value="7">{copy('sevenDays')}</option>
                </select>
              </label>
            </div>
          }
          actions={
            <Button
              variant="outline"
              onClick={() => {
                if (!navigationBlocked()) refresh();
              }}
              disabled={queueLoading || navigationBlocked()}
            >
              {copy('refresh')}
            </Button>
          }
        />
        {teamsError && (
          <div className="space-y-2" role="alert">
            <p>{copy('teamsLoadError')}</p>
            <Button variant="outline" onClick={() => setTeamsRevision((value) => value + 1)}>
              {copy('retry')}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {copy('loadError')}
          </p>
        )}
        {feeUncertain && (
          <div role="alert" className="space-y-2">
            <p>{feeCopy('uncertain')}</p>
            <Button
              data-testid="consultation-fee-retry"
              variant="outline"
              disabled={commandPending}
              onClick={retryFee}
            >
              {feeCopy('retryCaptured')}
            </Button>
          </div>
        )}
        {resolutionUncertain && (
          <div role="alert" className="space-y-2">
            <p>{resolutionCopy('uncertain')}</p>
            <Button
              data-testid="consultation-resolution-retry"
              variant="outline"
              disabled={commandPending}
              onClick={retryResolution}
            >
              {resolutionCopy('retryCaptured')}
            </Button>
          </div>
        )}
        {unconfirmed && (
          <div role="alert" className="space-y-2">
            <p>{copy('actionUnconfirmed')}</p>
            <Button
              variant="outline"
              disabled={commandPending || reviewLoading || reasonForm.formState.isSubmitting}
              onClick={() => {
                if (!commandPendingRef.current) setDetailRevision((value) => value + 1);
              }}
            >
              {copy('retry')}
            </Button>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <section aria-label={copy('staffTitle')} className="min-w-0 space-y-2">
            <ListPage.Content
              loading={queueLoading}
              error={queueError || queueDenied}
              empty={rows.length === 0}
              retainContent={rows.length > 0 && !queueDenied}
              loadingView={<p role="status">{copy('loading')}</p>}
              errorView={
                queueDenied ? (
                  <p role="alert">{copy('queueForbidden')}</p>
                ) : (
                  <div className="space-y-2">
                    <p role="alert">{copy('loadError')}</p>
                    <Button variant="outline" onClick={() => setListRevision((value) => value + 1)}>
                      {copy('retry')}
                    </Button>
                  </div>
                )
              }
              emptyView={<p className="text-muted-foreground">{copy('noWork')}</p>}
            >
              <OperationalQueueTable
                locale={locale}
                rows={rows}
                caption={copy('queueCatalogue')}
                scrollLabel={copy('queueCatalogue')}
                nameHeader={copy('queueRequest')}
                renderName={(row) => (
                  <>
                    <TextCell value={row.product_snapshot.title[locale]} />
                    <span className="block font-mono text-xs font-normal">
                      <TextCell value={row.id} />
                    </span>
                  </>
                )}
                fields={[
                  {
                    id: 'profile',
                    label: copy('profile'),
                    render: (row) => <TextCell value={row.profile_name} />,
                  },
                  {
                    id: 'status',
                    label: copy('status'),
                    render: (row) => (
                      <StatusBadge state={row.status} {...consultationStatus(row.status, copy)} />
                    ),
                  },
                  {
                    id: 'priority',
                    label: copy('priority'),
                    render: (row) => <TextCell value={copy(row.priority)} />,
                  },
                  {
                    id: 'submittedAt',
                    label: copy('submittedAt'),
                    render: (row) => (
                      <DateCell
                        value={row.submitted_at}
                        format={(value) =>
                          time.format(value, { year: 'numeric', month: '2-digit', day: '2-digit' })
                        }
                      />
                    ),
                  },
                  {
                    id: 'assignment',
                    label: copy('queueAssignment'),
                    render: (row) => <ConsultationAssignment request={row} copy={copy} />,
                  },
                ]}
                actionHeader={copy('queueActions')}
                renderActions={(row) => (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={navigationBlocked()}
                    onClick={() => {
                      if (
                        work.current.scope !== workScope ||
                        navigationBlocked() ||
                        row.id === selectedId
                      )
                        return;
                      setSelectedId(row.id);
                      setDetail(null);
                      reasonForm.reset({ reason: '' });
                      setOfferKey(crypto.randomUUID());
                    }}
                    aria-pressed={selectedId === row.id}
                    className={
                      selectedId === row.id
                        ? 'min-h-11 border-primary ring-1 ring-primary'
                        : 'min-h-11'
                    }
                  >
                    {copy('openRequest')}
                    <span className="sr-only">
                      : {row.product_snapshot.title[locale]} · {row.profile_name} · {row.id}
                    </span>
                  </Button>
                )}
                cardHeading="h2"
                loading={queueLoading}
                emptyMessage={copy('noWork')}
                tableClassName="min-w-[60rem]"
              />
            </ListPage.Content>
            <ListPage.Pagination
              kind="cursor"
              hasMore={
                !!nextAfter &&
                !navigationBlocked() &&
                !queueError &&
                !queueDenied &&
                ((accepted?.cursor !== after && accepted?.nextAfter === after) ||
                  queueLoading ||
                  (queries ? queries.queue.canAdvance(nextAfter) : nextAfter !== after))
              }
              loading={queueLoading}
              onNext={() => {
                if (!nextAfter || navigationBlocked() || work.current.scope !== workScope) return;
                if (nextAfter === after && accepted?.cursor !== after)
                  setListRevision((value) => value + 1);
                else if (queries) queries.queue.next(nextAfter);
                else setAfter(nextAfter);
              }}
              previous={{
                enabled:
                  !queueDenied && !navigationBlocked() && (queries?.queue.hasPrevious ?? false),
                onClick: () => {
                  if (!navigationBlocked() && work.current.scope === workScope)
                    queries?.queue.previous();
                },
                label: appText('historyPagination.previous', locale),
              }}
              label={appText('historyPagination.label', locale)}
              nextLabel={copy('moreWork')}
            />
          </section>
          <section className="space-y-4 rounded-xl border bg-card p-5" aria-label={copy('details')}>
            {!selectedId && <p className="text-muted-foreground">{copy('selectRequest')}</p>}
            {selectedId && !current && !detailError && <p role="status">{copy('loading')}</p>}
            {selectedId && detailError && (
              <div role="alert" className="space-y-2">
                <p>{copy('detailLoadError')}</p>
                <Button variant="outline" onClick={() => setDetailRevision((value) => value + 1)}>
                  {copy('retry')}
                </Button>
              </div>
            )}
            {current && (
              <>
                <div>
                  <h2 className="text-xl font-semibold" dir="auto">
                    {current.product_snapshot.title[locale]}
                  </h2>
                  <p>
                    {copy('customer')}: <span dir="auto">{current.profile_name}</span>
                  </p>
                  <p className="my-2 flex flex-wrap items-center gap-2">
                    {copy('status')}:{' '}
                    <StatusBadge
                      state={current.status}
                      {...consultationStatus(current.status, copy)}
                    />
                  </p>
                  <ConsultationAssignment request={current} copy={copy} />
                </div>
                {current.expected_next_step && (
                  <p>
                    {copy('nextStep')}: <span dir="auto">{current.expected_next_step}</span>
                  </p>
                )}
                {current.fee && (
                  <section
                    className="space-y-2 rounded-lg border p-4"
                    aria-label={copy('savedOffer')}
                  >
                    <h3 className="font-semibold">{copy('savedOffer')}</h3>
                    <p>
                      {copy('fee')}: {new Intl.NumberFormat(locale).format(BigInt(current.fee))} IRR
                    </p>
                    {current.scope && (
                      <p>
                        {copy('scope')}: <span dir="auto">{current.scope}</span>
                      </p>
                    )}
                    {current.deliverables && (
                      <p>
                        {copy('deliverables')}: <span dir="auto">{current.deliverables}</span>
                      </p>
                    )}
                    {current.offer_valid_until && (
                      <p>
                        {copy('offerValidUntil')}:{' '}
                        <time dateTime={current.offer_valid_until}>
                          {time.format(current.offer_valid_until)}
                        </time>
                      </p>
                    )}
                    {current.invoice_id && (
                      <p>
                        {copy('invoiceStatus')}:{' '}
                        {current.invoice_state
                          ? copy(`invoice_state_${current.invoice_state}`)
                          : copy('unknownInvoiceStatus')}{' '}
                        <a
                          className="text-primary underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-primary"
                          href={`/admin/invoices?invoiceId=${encodeURIComponent(current.invoice_id)}`}
                        >
                          {copy('viewInvoice')}
                        </a>
                      </p>
                    )}
                  </section>
                )}
                {(current.status === 'under_review' ||
                  (current.status === 'offer_pending' && !current.has_paid_invoice) ||
                  current.status === 'offer_accepted') && (
                  <Form {...feeForm}>
                    <form
                      data-testid="consultation-fee-form"
                      noValidate
                      className="space-y-3 rounded-lg border p-4"
                      aria-label={copy(
                        current.status === 'offer_accepted' ? 'adjustPaidFee' : 'feeOffer'
                      )}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (current.status === 'offer_accepted') preparePaidFee();
                        else prepareFeeOffer();
                      }}
                    >
                      <h3 className="font-semibold">
                        {copy(current.status === 'offer_accepted' ? 'adjustPaidFee' : 'feeOffer')}
                      </h3>
                      {current.status === 'offer_accepted' && (
                        <p className="text-sm text-muted-foreground">{copy('adjustPaidFeeHelp')}</p>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2">
                        {feeField('fee', 'consultation-fee', copy('feeIrr'), 'feeHelp', 'input')}
                        {feeField(
                          'validUntil',
                          'consultation-valid-until',
                          copy('offerValidUntil'),
                          'deadlineHelp',
                          'date'
                        )}
                      </div>
                      {current.status !== 'offer_accepted' && (
                        <>
                          {feeField(
                            'scope',
                            'consultation-scope',
                            copy('scope'),
                            'termsHelp',
                            'textarea'
                          )}
                          {feeField(
                            'deliverables',
                            'consultation-deliverables',
                            copy('deliverables'),
                            'termsHelp',
                            'textarea'
                          )}
                        </>
                      )}
                      {(current.status === 'offer_accepted' || current.invoice_id) &&
                        feeField(
                          'reason',
                          'consultation-offer-reason',
                          copy(
                            current.status === 'offer_accepted'
                              ? 'adjustmentReason'
                              : 'replaceReason'
                          ),
                          'reasonHelp',
                          'textarea'
                        )}
                      {feeForm.formState.errors.root && (
                        <Alert variant="destructive">{feeCopy('validationUnavailable')}</Alert>
                      )}
                      {reviewLoading && <p role="status">{feeCopy('checking')}</p>}
                      <Button
                        type="submit"
                        loading={reviewLoading || feeForm.formState.isSubmitting}
                        disabled={
                          editorLocked || unconfirmed || feeUncertain || time.status !== 'ready'
                        }
                      >
                        {copy(
                          current.status === 'offer_accepted'
                            ? 'adjustPaidFee'
                            : current.invoice_id
                              ? 'replaceFee'
                              : 'issueFee'
                        )}
                      </Button>
                    </form>
                  </Form>
                )}
                {current.status === 'offer_pending' && current.has_paid_invoice && (
                  <p className="rounded-lg border p-4 text-sm">{copy('paidAdjustmentPending')}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={editorLocked || unconfirmed}
                    onClick={() => prepare('assign', copy('assignSelf'), { assignTo: 'self' })}
                  >
                    {copy('assignSelf')}
                  </Button>
                  {current.status === 'submitted' && (
                    <Button
                      disabled={editorLocked || unconfirmed}
                      onClick={() => prepare('review', copy('startReview'))}
                    >
                      {copy('startReview')}
                    </Button>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="consultation-team">{copy('team')}</Label>
                    <select
                      id="consultation-team"
                      value={team}
                      disabled={editorLocked || unconfirmed}
                      onChange={(event) => setTeam(event.target.value)}
                      className="w-full rounded-md border bg-background p-2"
                    >
                      <option value="">{copy('selectTeam')}</option>
                      {teams.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="outline"
                    disabled={!team.trim() || editorLocked || unconfirmed}
                    onClick={() =>
                      prepare('assign', copy('assignTeam'), { assignTo: 'team', team: team.trim() })
                    }
                  >
                    {copy('assignTeam')}
                  </Button>
                </div>
                <Form {...reasonForm}>
                  <form
                    aria-label={copy('reasonFormTitle')}
                    className="space-y-2"
                    onSubmit={(event) => event.preventDefault()}
                    noValidate
                  >
                    {reasonForm.formState.errors.root && (
                      <Alert variant="destructive">{copy('validationUnavailable')}</Alert>
                    )}
                    <FormField
                      control={reasonForm.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem id="consultation-reason">
                          <FormLabel>{copy('note')}</FormLabel>
                          <FormControl>
                            <textarea
                              {...field}
                              aria-required="true"
                              disabled={
                                !!action ||
                                !!feeCommand.current ||
                                !!resolutionCommand.current ||
                                commandPending ||
                                unconfirmed
                              }
                              className="min-h-24 w-full rounded-md border bg-background p-2"
                            />
                          </FormControl>
                          <FormDescription>
                            {copy(reasonPaid ? 'paidReasonHelp' : 'reasonHelp')}
                          </FormDescription>
                          <div className="grid">
                            <p
                              aria-hidden="true"
                              className="invisible col-start-1 row-start-1 text-sm"
                            >
                              {copy(reasonPaid ? 'paidReasonInvalid1000' : 'reasonInvalid2000')}
                            </p>
                            <FormMessage className="col-start-1 row-start-1" />
                          </div>
                        </FormItem>
                      )}
                    />
                    {current.has_paid_invoice && (
                      <p className="text-sm text-muted-foreground">{copy('paidClosureHelp')}</p>
                    )}
                    {BigInt(current.uncovered_credit) > 0n && (
                      <p role="status" className="text-sm text-destructive">
                        {copy('uncoveredCredit')}:{' '}
                        {new Intl.NumberFormat(locale).format(BigInt(current.uncovered_credit))} IRR
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {current.status === 'under_review' && (
                        <Button
                          type="button"
                          variant="outline"
                          loading={reasonForm.formState.isSubmitting || reviewLoading}
                          disabled={editorLocked || unconfirmed}
                          onClick={() => prepareReason('request-info', copy('requestInfo'))}
                        >
                          {copy('requestInfo')}
                        </Button>
                      )}
                      {current.status === 'offer_accepted' && (
                        <Button
                          type="button"
                          loading={reasonForm.formState.isSubmitting || reviewLoading}
                          disabled={editorLocked || unconfirmed}
                          onClick={() => prepareReason('complete', copy('complete'))}
                        >
                          {copy('complete')}
                        </Button>
                      )}
                      {!['completed', 'rejected', 'cancelled', 'offer_declined'].includes(
                        current.status
                      ) && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            loading={reasonForm.formState.isSubmitting || reviewLoading}
                            disabled={editorLocked || unconfirmed}
                            onClick={() =>
                              prepareReason('reject', copy('reject'), current.has_paid_invoice)
                            }
                          >
                            {copy('reject')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            loading={reasonForm.formState.isSubmitting || reviewLoading}
                            disabled={editorLocked || unconfirmed}
                            onClick={() =>
                              prepareReason('cancel', copy('cancel'), current.has_paid_invoice)
                            }
                          >
                            {copy('cancel')}
                          </Button>
                        </>
                      )}
                      {BigInt(current.uncovered_credit) > 0n && (
                        <Button
                          type="button"
                          variant="outline"
                          loading={reasonForm.formState.isSubmitting || reviewLoading}
                          disabled={editorLocked || unconfirmed}
                          onClick={() =>
                            prepareReason('recover_refund', copy('recoverRefund'), true)
                          }
                        >
                          {copy('recoverRefund')}
                        </Button>
                      )}
                    </div>
                  </form>
                </Form>
                <section className="space-y-2">
                  <h3 className="font-semibold">{copy('history')}</h3>
                  <StatusTimeline
                    label={copy('history')}
                    items={detail.history.map((event, index) => {
                      const presentation = consultationStatus(event.status, copy);
                      return {
                        id: `${event.created_at}-${index}`,
                        title: presentation.label,
                        tone: presentation.tone,
                        state: event.status,
                        dateTime: event.created_at,
                        dateLabel: time.format(event.created_at),
                        actorLabel: [
                          ['staff', 'customer', 'unknown'].includes(event.actor_type)
                            ? event.actor_name
                            : null,
                          historyContextText(event.actor_type, locale),
                        ]
                          .filter(Boolean)
                          .join(' · '),
                        description: event.reason ?? undefined,
                      };
                    })}
                  />
                </section>
              </>
            )}
          </section>
        </div>
      </ListPage>
      {action && actionScope.current === workScope && (
        <TeamActionDialog
          action={action}
          confirmationDisabled={unconfirmed}
          onPendingChange={(pending) => {
            if (!currentAction()) return;
            if (pending && resolutionCommand.current) {
              resolutionCommand.current.attempted = true;
              invalidateFeeReads();
            }
            if (pending && feeCommand.current) {
              feeCommand.current.attempted = true;
              invalidateFeeReads();
            }
            commandPendingRef.current = pending;
            setCommandPending(pending);
          }}
          onValidationError={(fields) =>
            currentAction() &&
            !resolutionCommand.current &&
            !!reasonCommand.current &&
            fields.length > 0 &&
            fields.every((field) => field === 'reason') &&
            reasonFields(fields)
          }
          onUnconfirmed={() => {
            if (!currentAction()) return;
            if (feeCommand.current) {
              feeUnknown(feeCommand.current);
              return;
            }
            if (resolutionCommand.current) {
              resolutionUnknown(resolutionCommand.current);
              return;
            }
            if (!reasonCommand.current || reasonCommand.current.paid) return;
            recoveringReason.current = reasonCommand.current;
            unconfirmedRef.current = true;
            setUnconfirmed(true);
          }}
          onDenied={() => {
            if (currentAction()) denyAction();
          }}
          summary={
            resolutionReview ? (
              <FinancialReviewSummary
                title={copy('paidResolutionReviewTitle')}
                rows={[
                  {
                    id: 'profile',
                    label: copy('customer'),
                    value: resolutionReview.data.profileName,
                  },
                  {
                    id: 'service',
                    label: copy('details'),
                    value: resolutionReview.data.serviceTitle[locale],
                  },
                  {
                    id: 'status',
                    label: copy('status'),
                    value: copy(`status_${resolutionReview.data.currentStatus}`),
                  },
                  {
                    id: 'outcome',
                    label: copy('nextStep'),
                    value: copy(`status_${resolutionReview.data.resultingStatus}`),
                  },
                  ...(resolutionReview.data.currentInvoice
                    ? [
                        {
                          id: 'invoice',
                          label: copy('paidFeeReviewInvoice'),
                          value: resolutionReview.data.currentInvoice.id,
                        },
                        {
                          id: 'invoiceState',
                          label: copy('invoiceStatus'),
                          value: copy(
                            `invoice_state_${resolutionReview.data.currentInvoice.state}`
                          ),
                        },
                        {
                          id: 'invoicePaid',
                          label: copy('decisionReviewAlreadyPaid'),
                          value: `${new Intl.NumberFormat(locale).format(BigInt(resolutionReview.data.currentInvoice.paidAmount))} IRR`,
                        },
                      ]
                    : []),
                  ...(resolutionReview.data.cancelInvoiceId
                    ? [
                        {
                          id: 'cancelInvoice',
                          label: copy('paidResolutionCancelInvoice'),
                          value: resolutionReview.data.cancelInvoiceId,
                        },
                      ]
                    : []),
                  { id: 'reason', label: copy('reason'), value: resolutionReview.data.reason },
                  ...(resolutionReview.data.totalCredit !== '0'
                    ? [
                        {
                          id: 'credit',
                          label: copy('creditAdjustment'),
                          value: `${new Intl.NumberFormat(locale).format(BigInt(resolutionReview.data.totalCredit))} IRR`,
                        },
                      ]
                    : []),
                  ...resolutionReview.data.refundAllocations.map((allocation) => ({
                    id: `refund-${allocation.invoiceId}`,
                    label: copy('paidFeeReviewRefundInvoice'),
                    value: `${allocation.invoiceId} · ${new Intl.NumberFormat(locale).format(BigInt(allocation.amount))} IRR`,
                  })),
                ]}
                total={{
                  label: copy('paidResolutionRefundTotal'),
                  value: `${new Intl.NumberFormat(locale).format(BigInt(resolutionReview.data.totalRefund))} IRR`,
                }}
                notice={copy(
                  resolutionReview.data.action === 'recover_refund'
                    ? 'paidResolutionRecoveryOutcome'
                    : 'paidResolutionCloseOutcome'
                )}
              />
            ) : paidFeeReview ? (
              <>
                <FinancialReviewSummary
                  title={copy('paidFeeReviewTitle')}
                  rows={[
                    {
                      id: 'profile',
                      label: copy('customer'),
                      value: paidFeeReview.data.profileName,
                    },
                    {
                      id: 'service',
                      label: copy('details'),
                      value: paidFeeReview.data.serviceTitle[locale],
                    },
                    { id: 'scope', label: copy('scope'), value: paidFeeReview.data.scope },
                    {
                      id: 'deliverables',
                      label: copy('deliverables'),
                      value: paidFeeReview.data.deliverables,
                    },
                    {
                      id: 'invoice',
                      label: copy('paidFeeReviewInvoice'),
                      value: paidFeeReview.data.paidInvoice.id,
                    },
                    {
                      id: 'previousFee',
                      label: copy('paidFeeReviewPrevious'),
                      value: `${new Intl.NumberFormat(locale).format(BigInt(paidFeeReview.data.previousFee))} IRR`,
                    },
                    {
                      id: 'change',
                      label: copy(
                        paidFeeReview.data.outcome === 'charge_invoice'
                          ? 'chargeAdjustment'
                          : 'creditAdjustment'
                      ),
                      value: `${new Intl.NumberFormat(locale).format(BigInt(paidFeeReview.data.adjustmentAmount))} IRR`,
                    },
                    {
                      id: 'deadline',
                      label: copy('offerValidUntil'),
                      value: time.format(paidFeeReview.data.validUntil),
                    },
                    { id: 'reason', label: copy('reason'), value: paidFeeReview.data.reason },
                    ...paidFeeReview.data.refundPlan.map((refund) => ({
                      id: `refund-${refund.invoiceId}`,
                      label: copy('paidFeeReviewRefundInvoice'),
                      value: `${refund.invoiceId} · ${new Intl.NumberFormat(locale).format(BigInt(refund.amount))} IRR`,
                    })),
                  ]}
                  total={{
                    label: copy('paidFeeReviewRevised'),
                    value: `${new Intl.NumberFormat(locale).format(BigInt(paidFeeReview.data.revisedFee))} IRR`,
                  }}
                  notice={copy(
                    paidFeeReview.data.outcome === 'charge_invoice'
                      ? 'paidFeeReviewChargeOutcome'
                      : 'paidFeeReviewCreditOutcome'
                  )}
                />
                <OrderWalletBalance
                  profileId={paidFeeReview.scope.profileId}
                  total={
                    paidFeeReview.data.outcome === 'charge_invoice'
                      ? paidFeeReview.data.adjustmentAmount
                      : '0'
                  }
                  scopeKey={paidFeeReview.hash}
                  staff
                />
              </>
            ) : feeReview ? (
              <>
                <FinancialReviewSummary
                  title={copy('feeReviewTitle')}
                  rows={[
                    { id: 'profile', label: copy('customer'), value: feeReview.data.profileName },
                    {
                      id: 'service',
                      label: copy('details'),
                      value: feeReview.data.serviceTitle[locale],
                    },
                    { id: 'scope', label: copy('scope'), value: feeReview.data.scope },
                    {
                      id: 'deliverables',
                      label: copy('deliverables'),
                      value: feeReview.data.deliverables,
                    },
                    {
                      id: 'deadline',
                      label: copy('offerValidUntil'),
                      value: time.format(feeReview.data.validUntil),
                    },
                    ...(feeReview.data.previousInvoice
                      ? [
                          {
                            id: 'previous',
                            label: copy('feeReviewPreviousInvoice'),
                            value: feeReview.data.previousInvoice.id,
                          },
                          {
                            id: 'previousAmount',
                            label: copy('feeReviewPreviousAmount'),
                            value: `${new Intl.NumberFormat(locale).format(BigInt(feeReview.data.previousInvoice.totalAmount))} IRR`,
                          },
                        ]
                      : []),
                    ...(feeReview.data.reason
                      ? [{ id: 'reason', label: copy('reason'), value: feeReview.data.reason }]
                      : []),
                  ]}
                  total={{
                    label: copy('feeIrr'),
                    value: `${new Intl.NumberFormat(locale).format(BigInt(feeReview.data.fee))} IRR`,
                  }}
                  notice={copy(
                    feeReview.data.outcome === 'issue_invoice'
                      ? 'feeReviewIssueOutcome'
                      : 'feeReviewReplaceOutcome'
                  )}
                />
                <OrderWalletBalance
                  profileId={feeReview.scope.profileId}
                  total={feeReview.data.fee}
                  scopeKey={feeReview.hash}
                  staff
                />
              </>
            ) : undefined
          }
          onClose={() => {
            if (!currentAction()) return;
            const command = feeCommand.current;
            if (command) {
              if (command.uncertain || (command.attempted && !command.rejected))
                feeUnknown(command);
              else feeRelease(command);
            } else if (resolutionCommand.current) {
              const resolution = resolutionCommand.current;
              if (resolution.uncertain || (resolution.attempted && !resolution.rejected))
                resolutionUnknown(resolution);
              else resolutionRelease(resolution);
            } else clearAction();
          }}
          onSuccess={async (result) => {
            if (!currentAction()) return;
            const feeCaptured = feeCommand.current;
            if (feeCaptured) {
              if (
                !feeActive(feeCaptured) ||
                !matchedConsultationFeeReceipt(result, feeCaptured.review)
              )
                throw new Error('Consultation fee receipt did not match');
              feeCommand.current = null;
              setFeeUncertain(false);
              offerDirty.current = false;
              setOfferKey(crypto.randomUUID());
              if (feeCaptured.source.status === 'offer_accepted' || feeCaptured.source.invoice_id)
                setOfferReason('');
              setFeeReview(null);
              setPaidFeeReview(null);
              clearAction();
              refresh();
              return;
            }
            const resolutionCaptured = resolutionCommand.current;
            if (resolutionCaptured) {
              if (
                !resolutionActive(resolutionCaptured) ||
                !matchedConsultationResolutionReceipt(result, resolutionCaptured.review)
              )
                throw new Error('Consultation resolution receipt did not match');
              resolutionCommand.current = null;
              setResolutionUncertain(false);
              reasonForm.reset({ reason: '' });
              offerDirty.current = true;
              clearAction();
              refresh();
              return;
            }
            if (
              (feeReview || paidFeeReview || resolutionReview) &&
              (result as { financialReview?: { hash?: string } } | null)?.financialReview?.hash !==
                (feeReview ?? paidFeeReview ?? resolutionReview)?.hash
            )
              throw new Error('Consultation fee confirmation did not match the review');
            const command = reasonCommand.current;
            if (
              command &&
              !command.paid &&
              !consultationReceipt(result, command.requestId, command.expectedStatus)
            )
              throw new Error('Consultation reason receipt did not match');
            if (command) {
              reasonForm.reset({ reason: '' });
              recoveringReason.current = null;
              unconfirmedRef.current = false;
              setUnconfirmed(false);
            } else if (feeReview || paidFeeReview) {
              offerDirty.current = false;
            }
            if (feeReview || paidFeeReview || resolutionReview) setOfferKey(crypto.randomUUID());
            setFeeReview(null);
            setPaidFeeReview(null);
            setResolutionReview(null);
            clearAction();
            refresh();
          }}
        />
      )}
    </main>
  );
}
