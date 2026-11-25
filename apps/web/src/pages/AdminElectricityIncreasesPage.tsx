import { ArrowLeft, ArrowRight, ChevronDown, Eye as TableEyeIcon } from 'lucide-react';
import { TableActionIcon } from '../components/TableActionIcon.js';
import { Link } from '@tanstack/react-router';
import { RecordCommandGuard } from '../components/RecordCommandGuard.js';
import { RecordDateTimeField } from '../components/RecordDateTimeField.js';
import {
  RecordEditorActions,
  RecordEditorSection,
  recordEditorField,
  recordEditorSurface,
} from '../components/RecordEditorLayout.js';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedStaffServiceRead } from '../hooks/useOwnedStaffServiceRead.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { OrderWalletBalance } from '../components/OrderWalletBalance.js';
import { OperationalQueueTable } from '../components/OperationalQueueTable.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { useEffect, useRef, useState } from 'react';
import { editorText, t as appText } from '@barghsa/i18n/electricity-increase-decision-forms';
import { ErrorCodes } from '@barghsa/shared/errors';
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
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import {
  increaseEffectiveFrom,
  boundIncreaseDecisionReview,
  confirmedIncreaseDecision,
  definitiveStaffDecisionRejection,
  definitiveMissingIncrease,
  type IncreaseDecision,
  type IncreaseDecisionDraft,
} from '../lib/electricity-increase-decision-form.js';
import { adminText as t } from '@barghsa/i18n/electricity-increase-decision-forms';
import {
  LoadingStatus,
  Button,
  Card,
  CardContent,
  FinancialReviewSummary,
  Textarea,
  buttonVariants,
  ListPage,
  ListRefreshButton,
  TextCell,
  DateCell,
  CurrencyCell,
  LinkCell,
  StatusCell,
} from '@barghsa/ui';
import { type ElectricityIncreaseStaffDecisionReview } from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';
import { readWithDeadline } from '../lib/server-query-client.js';
import { QueueEmptyState } from '../components/QueueEmptyState.js';

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
  canReview?: boolean;
  adjustmentAmount?: string | null;
  reviewedAt?: string | null;
  reviewReason?: string | null;
}

type DecisionForm = ReturnType<typeof useZodForm<IncreaseDecisionDraft>>;
interface CapturedDecision {
  actor: string | null;
  action: TeamAction;
  review: ElectricityIncreaseStaffDecisionReview;
  request: number;
  scope: string;
  attempted: boolean;
  rejected: boolean;
  unconfirmed: boolean;
  fields: (fields: unknown[]) => boolean;
}

function IncreaseDecisionEditor({
  request,
  decision,
  locale,
  timezone,
  draft,
  approvalReasonDraft,
  disabled,
  busy,
  blocked,
  onDraft,
  onApprovalReason,
  onPrepare,
}: {
  request: IncreaseRequest;
  decision: IncreaseDecision;
  locale: 'en' | 'fa';
  timezone: string | null;
  draft: string;
  approvalReasonDraft?: string;
  disabled: boolean;
  busy: boolean;
  blocked: boolean;
  onDraft: (draft: string) => void;
  onApprovalReason?: (reason: string) => void;
  onPrepare: (form: DecisionForm, fields: (fields: unknown[]) => boolean) => void;
}) {
  const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
  const formCopy = (key: string) => appText(`electricity.increaseDecisionForm.${key}`, locale);
  const currentTimezone = useRef(timezone);
  currentTimezone.current = timezone;
  const dateUnavailable = decision === 'approve' && !timezone;
  const name = decision === 'approve' ? 'effectiveDate' : 'reason';
  const message = formCopy(decision === 'approve' ? 'dateInvalid' : 'reasonInvalid');
  const reasonMessage = formCopy('reasonInvalid');
  const form: DecisionForm = useZodForm<IncreaseDecisionDraft>(
    async () => {
      const raw = JSON.stringify(form.getValues());
      const schemas = await import('../lib/electricity-increase-decision-form-schemas.js');
      return JSON.stringify(form.getValues()) === raw && currentTimezone.current === timezone
        ? schemas.increaseDecisionSchema(decision, message, timezone, reasonMessage)
        : schemas.inactiveIncreaseDecisionSchema;
    },
    {
      defaultValues: {
        effectiveDate: decision === 'approve' ? draft : '',
        reason: decision === 'reject' ? draft : (approvalReasonDraft ?? ''),
      },
      validationUnavailableMessage: formCopy('validationUnavailable'),
    }
  );
  useEffect(() => {
    if (
      form.getValues(name) !== draft ||
      (decision === 'approve' && form.getValues('reason') !== (approvalReasonDraft ?? ''))
    )
      form.reset({
        effectiveDate: decision === 'approve' ? draft : '',
        reason: decision === 'reject' ? draft : (approvalReasonDraft ?? ''),
      });
  }, [draft, approvalReasonDraft]);
  const fieldErrors = useActionFieldErrors(
    form,
    { [name]: message, reason: reasonMessage },
    copy('reviewError')
  );
  return (
    <Form {...form}>
      <form
        noValidate
        data-testid={`electricity-increase-${decision}-form`}
        className={recordEditorSurface}
        onSubmit={(event) => {
          event.preventDefault();
          onPrepare(
            form,
            (fields) =>
              fields.length > 0 &&
              fields.every(
                (field) =>
                  field === 'reason' || (decision === 'approve' && field === 'effectiveFrom')
              ) &&
              fieldErrors(
                fields.map((field) => (field === 'effectiveFrom' ? 'effectiveDate' : 'reason'))
              )
          );
        }}
      >
        <RecordEditorSection
          title={editorText(decision === 'approve' ? 'approvalDetails' : 'declineDetails', locale)}
          description={editorText(
            decision === 'approve' ? 'approvalEffect' : 'declineEffect',
            locale
          )}
        >
          {decision === 'approve' && (
            <FormField
              control={form.control}
              name="effectiveDate"
              render={({ field }) => (
                <FormItem
                  className={recordEditorField}
                  id={`increase-effective-${request.requestId}`}
                >
                  <FormLabel>{copy('approveDate')}</FormLabel>
                  <FormControl>
                    <RecordDateTimeField
                      {...field}
                      label={copy('approveDate')}
                      locale={locale}
                      timezone={timezone}
                      clearable
                      disabled={disabled || dateUnavailable}
                      onChange={(value) => {
                        field.onChange(value);
                        onDraft(value);
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {copy('approveDateHelp')} {copy('dateZone')}{' '}
                    <bdi dir="ltr">{timezone ?? '—'}</bdi>
                  </FormDescription>
                  <FormMessage reserveSpace className="min-h-5" />
                </FormItem>
              )}
            />
          )}
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem
                id={`increase-${decision === 'approve' ? 'approval-' : ''}reason-${request.requestId}`}
                className={recordEditorField}
              >
                <FormLabel>{copy(decision === 'approve' ? 'approvalReason' : 'reason')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    aria-required="true"
                    rows={2}
                    dir="auto"
                    className={`max-w-prose resize-y border-border ${locale === 'fa' ? 'placeholder:text-right' : 'placeholder:text-left'}`}
                    placeholder={editorText(
                      decision === 'approve' ? 'approvalExample' : 'declineExample',
                      locale
                    )}
                    disabled={disabled || dateUnavailable}
                    onChange={(event) => {
                      field.onChange(event);
                      if (decision === 'approve') onApprovalReason?.(event.target.value);
                      else onDraft(event.target.value);
                    }}
                  />
                </FormControl>
                <FormDescription>
                  {editorText(
                    decision === 'approve' ? 'approvalReasonUse' : 'declineReasonUse',
                    locale
                  )}
                </FormDescription>
                <FormMessage reserveSpace className="min-h-5" />
              </FormItem>
            )}
          />
          {form.formState.errors.root?.validation ? (
            <p role="alert">{formCopy('validationUnavailable')}</p>
          ) : null}
        </RecordEditorSection>
        <RecordEditorActions>
          <Button
            type="submit"
            variant={decision === 'reject' ? 'destructive' : 'default'}
            className={
              decision === 'reject'
                ? 'dark:bg-destructive/10 dark:hover:bg-destructive/20'
                : undefined
            }
            disabled={disabled || dateUnavailable || blocked || busy}
            aria-busy={busy || undefined}
          >
            {busy ? (
              <span
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
              />
            ) : null}
            {copy(decision === 'approve' ? 'previewApproval' : 'previewRejection')}
          </Button>
        </RecordEditorActions>
      </form>
    </Form>
  );
}

export default function AdminElectricityIncreasesPage(
  props: Parameters<typeof OwnedAdminElectricityIncreasesPage>[0] = {}
) {
  const revision = useProfileContextRevision();
  return <OwnedAdminElectricityIncreasesPage key={revision} {...props} />;
}
function OwnedAdminElectricityIncreasesPage({
  queries,
  recordId,
  recordDecision,
  queueSearch,
}: {
  queries?: ListQueryBinding;
  recordId?: string;
  recordDecision?: IncreaseDecision | undefined;
  queueSearch?: Record<string, unknown>;
} = {}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const readStaff = useOwnedStaffServiceRead(actor, profileRevision);
  const formCopy = (key: string) => appText(`electricity.increaseDecisionForm.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const time = useAccountTime(locale);
  const timezone = time.status === 'ready' ? time.timezone : null;
  const currentTimezone = useRef(timezone);
  currentTimezone.current = timezone;
  const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
  const [requests, setRequests] = useState<IncreaseRequest[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [localBefore, setLocalBefore] = useState<string | null>(null);
  const [localView, setLocalView] = useState<'pending' | 'expired'>('pending');
  const before = queries ? queries.query.cursor || null : localBefore;
  const view = queries ? (queries.query.filters.status as 'pending' | 'expired') : localView;
  const otherView = view === 'pending' ? 'expired' : 'pending';
  function changeQueueStatus(status: 'pending' | 'expired') {
    if (status === view || readLocked()) return;
    setNextBefore(null);
    if (queries) queries.setQuery({ filters: { status } });
    else {
      setLocalView(status);
      setLocalBefore(null);
    }
  }
  const setBefore = (cursor: string | null) =>
    queries ? queries.setQuery({ cursor: cursor ?? '' }) : setLocalBefore(cursor);
  const expectedNext = useRef<string | null>(null);
  const acceptedCursor = useRef<string | null>(null);
  const [acceptedView, setAcceptedView] = useState(view);
  const [acceptedActor, setAcceptedActor] = useState(actor);
  const visibleRequests = acceptedView === view && acceptedActor === actor ? requests : null;
  const accessDenied = useRef(false);
  const reviewedRequest = useRef<IncreaseRequest | null>(null);
  const [revision, setRevision] = useState(0);
  const [reason, setReason] = useState<Record<string, string>>({});
  const [approvalReason, setApprovalReason] = useState<Record<string, string>>({});
  const [effectiveDate, setEffectiveDate] = useState<Record<string, string>>({});
  const [action, setAction] = useState<TeamAction | null>(null);
  const [decisionReview, setDecisionReview] =
    useState<ElectricityIncreaseStaffDecisionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const reviewRequest = useRef(0);
  const previewAbort = useRef<AbortController | null>(null);
  const preparing = useRef(false);
  const pending = useRef(false);
  const captured = useRef<CapturedDecision | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [busyDecision, setBusyDecision] = useState<IncreaseDecision | null>(null);
  const mounted = useRef(false);
  const currentActor = useRef(actor);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [denied, setDenied] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const scope = JSON.stringify([actor, recordId, view, before]);
  const currentScope = useRef(scope);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    ++reviewRequest.current;
  }
  if (currentActor.current !== actor) {
    currentActor.current = actor;
    accessDenied.current = false;
  }
  const previousScope = useRef(scope);
  useEffect(() => {
    if (scope === previousScope.current) return;
    previousScope.current = scope;
    if (captured.current && (captured.current.actor !== actor || !captured.current.attempted))
      clearReview();
    else if (captured.current) {
      if (pending.current) {
        // An external cursor change must not unmount an in-flight captured write.
        captured.current.request = reviewRequest.current;
        captured.current.scope = scope;
      } else {
        setAction(null);
        setDecisionReview(null);
        captured.current.unconfirmed = true;
        setUncertain(true);
      }
    } else clearReview();
    if (expectedNext.current !== scope) {
      setReason({});
      setApprovalReason({});
      setEffectiveDate({});
    }
    expectedNext.current = null;
  }, [scope]);
  useEffect(() => {
    clearReview();
    setReason({});
    setApprovalReason({});
    setEffectiveDate({});
    setRequests(null);
    setNextBefore(null);
    setDenied(false);
  }, [actor]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    setNotFound(false);
    const base = '/api/staff/electricity/increase-requests';
    const path = recordId
      ? `${base}/${encodeURIComponent(recordId)}`
      : `${base}?status=${view}` + (before ? `&before=${encodeURIComponent(before)}` : '');
    void readStaff('orders', recordId ? 'detail' : 'list', path, controller.signal)
      .then(async (response) => {
        if (
          controller.signal.aborted ||
          currentActor.current !== actor ||
          currentScope.current !== scope
        )
          return null;
        if ([401, 403].includes(response.status)) throw new Error('denied');
        if (recordId && response.status === 404) throw new Error('not found');
        if (!response.ok) throw new Error('Queue unavailable');
        if (recordId) {
          const record = (await response.json()) as IncreaseRequest | null;
          if (
            record?.requestId !== recordId ||
            typeof record.profileId !== 'string' ||
            typeof record.status !== 'string' ||
            typeof record.canReview !== 'boolean'
          )
            throw new Error('Invalid record');
          return { requests: [record], nextBefore: null };
        }
        return response.json() as Promise<{
          requests: IncreaseRequest[];
          nextBefore: string | null;
        }>;
      })
      .then((value) => {
        if (
          !controller.signal.aborted &&
          value &&
          currentActor.current === actor &&
          currentScope.current === scope
        ) {
          if (
            !value ||
            !Array.isArray(value.requests) ||
            (value.nextBefore !== null && typeof value.nextBefore !== 'string')
          )
            throw new Error('Invalid queue');
          const selected = reviewedRequest.current;
          if (
            !captured.current?.attempted &&
            selected &&
            !value.requests.some((item) => JSON.stringify(item) === JSON.stringify(selected))
          )
            clearReview();
          accessDenied.current = false;
          setDenied(false);
          setAcceptedView(view);
          setAcceptedActor(actor);
          acceptedCursor.current = before;
          setRequests(value.requests);
          setNextBefore(value.nextBefore);
        }
      })
      .catch((caught: unknown) => {
        if (
          controller.signal.aborted ||
          currentActor.current !== actor ||
          currentScope.current !== scope
        )
          return;
        setError(true);
        if (caught instanceof Error && caught.message === 'denied') deny();
        if (caught instanceof Error && caught.message === 'not found') {
          clearReview();
          setRequests([]);
          setNotFound(true);
        }
      })
      .finally(() => {
        if (
          !controller.signal.aborted &&
          currentActor.current === actor &&
          currentScope.current === scope
        )
          setLoading(false);
      });
    return () => controller.abort();
  }, [before, revision, view, actor, readStaff, recordId]);

  function deny() {
    accessDenied.current = true;
    setDenied(true);
    setLoading(false);
    setError(true);
    setRequests(null);
    setNextBefore(null);
    setReason({});
    setApprovalReason({});
    setEffectiveDate({});
    clearReview();
  }
  function clearReview() {
    ++reviewRequest.current;
    previewAbort.current?.abort();
    preparing.current = false;
    pending.current = false;
    captured.current = null;
    setUncertain(false);
    setBusyRow(null);
    setBusyDecision(null);
    reviewedRequest.current = null;
    setDecisionReview(null);
    setAction(null);
    setReviewLoading(false);
    setReviewError(false);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewAbort.current?.abort();
      ++reviewRequest.current;
    };
  }, []);
  function locked() {
    return preparing.current || pending.current || !!captured.current || uncertain;
  }
  function readLocked() {
    return pending.current || captured.current?.attempted === true || uncertain;
  }
  function refresh() {
    if (readLocked()) return;
    if (preparing.current) clearReview();
    setRevision((value) => value + 1);
  }
  function live(command: CapturedDecision) {
    return (
      mounted.current &&
      !accessDenied.current &&
      command.actor === currentActor.current &&
      command.actor === actor &&
      captured.current === command &&
      command.request === reviewRequest.current &&
      command.scope === currentScope.current
    );
  }
  function missing(requestId: string) {
    clearReview();
    setRequests((current) => current?.filter((request) => request.requestId !== requestId) ?? null);
    setReason((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    setEffectiveDate((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    setApprovalReason((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    setReviewError(true);
  }
  function unconfirmed(command: CapturedDecision) {
    if (!live(command)) return;
    command.unconfirmed = true;
    pending.current = false;
    setUncertain(true);
    setAction(null);
    setDecisionReview(null);
  }
  function closeDecision(command: CapturedDecision, ownedAction: TeamAction) {
    if (!live(command) || command.action !== ownedAction || pending.current) return;
    if (command.unconfirmed || (command.attempted && !command.rejected)) unconfirmed(command);
    else {
      captured.current = null;
      setAction(null);
      setDecisionReview(null);
    }
  }
  function decorateAction(command: CapturedDecision, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (result: unknown) => {
          if (!live(command) || command.action !== ownedAction) return copy('reviewError');
          if (code === ErrorCodes.NOT_FOUND_RESOURCE.code && definitiveMissingIncrease(result)) {
            missing(command.review.data.requestId);
            return copy('reviewError');
          }
          if (definitiveStaffDecisionRejection(result)) {
            command.rejected = true;
            const fields = (result as { error: { fields?: unknown[] } }).error.fields;
            if (
              !command.unconfirmed &&
              code === ErrorCodes.VALIDATION_INPUT_INVALID.code &&
              Array.isArray(fields) &&
              command.fields(fields)
            ) {
              pending.current = false;
              closeDecision(command, ownedAction);
            }
          }
          return code.startsWith('CONFLICT:') ? copy('conflict') : copy('reviewError');
        },
      ])
    );
  }
  function retryCaptured() {
    const command = captured.current;
    if (
      !command ||
      command.actor !== actor ||
      !command.unconfirmed ||
      pending.current ||
      accessDenied.current ||
      currentActor.current !== actor ||
      currentScope.current !== scope
    )
      return;
    command.request = reviewRequest.current;
    command.scope = currentScope.current;
    const next = { ...command.action };
    command.action = next;
    decorateAction(command, next);
    setDecisionReview(command.review);
    setAction(next);
  }
  function reviewDecision(
    request: IncreaseRequest,
    decision: IncreaseDecision,
    form: DecisionForm,
    fields: (fields: unknown[]) => boolean
  ) {
    if (
      locked() ||
      (recordId &&
        (recordDecision !== decision || request.status !== 'pending' || !request.canReview)) ||
      (decision === 'approve' && !timezone) ||
      loading ||
      error ||
      accessDenied.current ||
      view !== 'pending' ||
      acceptedActor !== actor ||
      currentScope.current !== scope ||
      !visibleRequests?.some((row) => JSON.stringify(row) === JSON.stringify(request))
    )
      return;
    const raw = JSON.stringify(form.getValues());
    const generation = ++reviewRequest.current;
    reviewedRequest.current = request;
    preparing.current = true;
    setBusyRow(request.requestId);
    setBusyDecision(decision);
    setReviewLoading(true);
    setReviewError(false);
    const authorized = () =>
      mounted.current &&
      !accessDenied.current &&
      generation === reviewRequest.current &&
      currentScope.current === scope;
    const fresh = () =>
      authorized() &&
      JSON.stringify(form.getValues()) === raw &&
      (decision === 'reject' || currentTimezone.current === timezone);
    void form
      .handleSubmit(async (draft) => {
        if (!fresh() || JSON.stringify(draft) !== raw) return;
        const effectiveFrom =
          decision === 'approve' ? increaseEffectiveFrom(draft.effectiveDate, timezone) : undefined;
        if (effectiveFrom === null) return;
        const previewInput = {
          reason: draft.reason.trim(),
          ...(effectiveFrom ? { effectiveFrom } : {}),
        };
        const path = `/api/staff/electricity/increase-requests/${encodeURIComponent(request.requestId)}/${decision}`;
        const previewController = new AbortController();
        previewAbort.current = previewController;
        try {
          const { response, value } = await readWithDeadline(
            previewController.signal,
            async (signal) => {
              const response = await fetch(`${path}/review`, {
                signal,
                method: 'POST',
                credentials: 'include',
                headers: withCsrf({ 'Content-Type': 'application/json' }),
                body: JSON.stringify(previewInput),
              });
              const value: unknown = [401, 403, 404].includes(response.status)
                ? null
                : await response.json().catch(() => null);
              return { response, value };
            }
          );
          if (!authorized()) return;
          if ([401, 403].includes(response.status)) {
            deny();
            return;
          }
          if (response.status === 404) {
            missing(request.requestId);
            return;
          }
          if (!fresh()) return;
          if (response.status === 400 && definitiveStaffDecisionRejection(value)) {
            const owned = (value as { error: { fields?: unknown[] } }).error.fields;
            if (Array.isArray(owned) && fields(owned)) return;
          }
          if (!response.ok) throw new Error('Review unavailable');
          const review = boundIncreaseDecisionReview(value, request, decision, previewInput);
          if (!review) throw new Error('Review mismatch');
          const command: CapturedDecision = {
            actor,
            request: generation,
            scope,
            review,
            fields,
            attempted: false,
            rejected: false,
            unconfirmed: false,
            action: {
              risk: decision === 'approve' ? 'financial' : 'both',
              title: copy(decision),
              description: copy('reviewConfirm'),
              path,
              method: 'POST',
              responseDeadline: true,
              successStatus: 201,
              body: {
                idempotencyKey: crypto.randomUUID(),
                expectedReviewHash: review.hash,
                ...(decision === 'approve'
                  ? { effectiveFrom: review.data.effectiveFrom, reason: review.data.reason }
                  : { reason: review.data.reason }),
              },
              conflictMessage: copy('conflict'),
              forbiddenMessage: copy('forbidden'),
            },
          };
          decorateAction(command, command.action);
          captured.current = command;
          setDecisionReview(review);
          setAction(command.action);
        } catch {
          if (fresh()) {
            setDecisionReview(null);
            setReviewError(true);
          }
        } finally {
          if (previewAbort.current === previewController) previewAbort.current = null;
        }
      })()
      .finally(() => {
        if (authorized()) {
          preparing.current = false;
          setBusyRow(null);
          setReviewLoading(false);
        }
      });
  }

  const recordHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (recordId) {
      if (!readLocked()) clearReview();
      recordHeading.current?.focus({ preventScroll: true });
    }
  }, [recordId, recordDecision]);
  const command = captured.current;
  const frozen = pending.current || !!captured.current || uncertain;
  return (
    <section
      data-slot={recordId ? 'electricity-increase-record' : undefined}
      className={recordId ? 'mx-auto max-w-3xl space-y-3' : 'space-y-5'}
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      {recordId && <RecordCommandGuard blocked={readLocked} />}
      <header
        className={
          recordId
            ? 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3'
            : 'flex flex-wrap items-start justify-between gap-3'
        }
      >
        {recordId && (
          <Link
            {...(recordDecision
              ? {
                  to: '/admin/electricity-increases/$requestId/{-$decision}' as const,
                  params: { requestId: recordId, decision: undefined },
                }
              : { to: '/admin/electricity-increases' as const })}
            search={queueSearch ?? {}}
            className="col-start-1 row-start-1 inline-flex min-h-11 w-fit items-center gap-2 text-sm font-medium text-primary hover:underline hover:underline-offset-4 aria-disabled:opacity-60"
            aria-disabled={readLocked() || undefined}
            onClick={(event) => {
              if (readLocked()) event.preventDefault();
            }}
          >
            <ArrowLeft aria-hidden="true" className="size-4 rtl:hidden" />
            <ArrowRight aria-hidden="true" className="hidden size-4 rtl:block" />
            {copy(recordDecision ? 'backToRequest' : 'backToQueue')}
          </Link>
        )}
        <div className={recordId ? 'col-span-2 mt-1' : undefined}>
          <h1
            ref={recordHeading}
            tabIndex={recordId ? -1 : undefined}
            className={
              recordId
                ? 'w-fit text-xl font-semibold focus-visible:shadow-none! focus-visible:outline-hidden!'
                : 'text-2xl font-semibold'
            }
          >
            {copy(
              recordDecision === 'approve'
                ? 'prepareApproval'
                : (recordDecision ?? (recordId ? 'recordTitle' : 'title'))
            )}
          </h1>
          {!recordId && <p className="text-muted-foreground">{copy('description')}</p>}
        </div>
        <div className={recordId ? 'col-start-2 row-start-1' : undefined}>
          <ListRefreshButton
            label={copy('refresh')}
            refreshing={loading}
            disabled={readLocked()}
            onClick={() => {
              if (readLocked()) return;
              if (preparing.current) clearReview();
              setBefore(null);
              setRevision((value) => value + 1);
            }}
          />
        </div>
      </header>
      {time.notice}
      <ListPage role="region" aria-label={copy('listTitle')}>
        {!recordId && (
          <ListPage.Toolbar>
            <div className="flex flex-wrap gap-2" role="group" aria-label={copy('viewLabel')}>
              {(['pending', 'expired'] as const).map((status) => (
                <Button
                  key={status}
                  variant={view === status ? 'default' : 'outline'}
                  disabled={readLocked()}
                  onClick={() => changeQueueStatus(status)}
                >
                  {copy(`${status}Tab`)}
                </Button>
              ))}
            </div>
          </ListPage.Toolbar>
        )}
        <ListPage.Content
          loading={loading}
          error={error}
          empty={!visibleRequests?.length}
          retainContent={!!visibleRequests?.length && !denied}
          loadingView={<LoadingStatus>{copy('loading')}</LoadingStatus>}
          errorView={
            <div role="alert" className="space-y-2">
              <p>{copy(denied ? 'forbidden' : notFound ? 'recordNotFound' : 'error')}</p>
              {!denied && !notFound && (
                <Button type="button" variant="outline" disabled={readLocked()} onClick={refresh}>
                  {copy('retry')}
                </Button>
              )}
            </div>
          }
          emptyView={
            !recordId && !before ? (
              <QueueEmptyState
                locale={locale}
                message={copy(view === 'pending' ? 'empty' : 'emptyExpired')}
                alternatives={[
                  {
                    value: otherView,
                    label: copy(`${otherView}Tab`),
                    path: `/api/staff/electricity/increase-requests?status=${otherView}`,
                  },
                ]}
                hasResults={(body, value) => {
                  const rows = (body as { requests?: unknown } | null)?.requests;
                  return (
                    Array.isArray(rows) &&
                    rows.some((row) => row?.status === value && typeof row.requestId === 'string')
                  );
                }}
                select={() => changeQueueStatus(otherView)}
                disabled={readLocked()}
              />
            ) : (
              <p>{copy(view === 'pending' ? 'empty' : 'emptyExpired')}</p>
            )
          }
        >
          {!recordId && !!visibleRequests?.length && (
            <OperationalQueueTable
              locale={locale}
              rows={visibleRequests.map((request) => ({ ...request, id: request.requestId }))}
              caption={copy(view === 'pending' ? 'pendingDirectory' : 'expiredDirectory')}
              scrollLabel={copy(view === 'pending' ? 'pendingDirectory' : 'expiredDirectory')}
              nameHeader={copy('request')}
              renderName={(request) => <TextCell value={request.requestId} />}
              fields={[
                {
                  id: 'contract',
                  label: copy('contract'),
                  render: (request) => (
                    <LinkCell href={`/admin/contracts/${encodeURIComponent(request.contractId)}`}>
                      {request.contractId}
                    </LinkCell>
                  ),
                },
                {
                  id: 'order',
                  label: copy('order'),
                  render: (request) => (
                    <LinkCell
                      href={`/admin/electricity-orders/${encodeURIComponent(request.orderId)}`}
                    >
                      {request.orderId}
                    </LinkCell>
                  ),
                },
                {
                  id: 'quantity',
                  label: copy('quantity'),
                  render: (request) => (
                    <TextCell
                      value={`${numbers.irrDigits(request.originalKwh)} → ${numbers.irrDigits(request.requestedKwh)} kWh`}
                    />
                  ),
                },
                {
                  id: 'change',
                  label: copy('change'),
                  render: (request) => (
                    <TextCell
                      value={`${numbers.number(Number(((BigInt(request.requestedKwh) - BigInt(request.originalKwh)) * 10000n) / BigInt(request.originalKwh)) / 100)}%`}
                    />
                  ),
                },
                {
                  id: 'effective',
                  label: copy('effective'),
                  render: (request) => (
                    <DateCell
                      value={request.effectiveFrom}
                      format={(value) => time.format(value)}
                    />
                  ),
                },
                {
                  id: 'end',
                  label: copy('end'),
                  render: (request) => (
                    <DateCell value={request.periodEnd} format={(value) => time.format(value)} />
                  ),
                },
                {
                  id: 'created',
                  label: copy('created'),
                  render: (request) => (
                    <DateCell value={request.createdAt} format={(value) => time.format(value)} />
                  ),
                },
                {
                  id: 'status',
                  label: copy('status'),
                  render: (request) => (
                    <StatusCell
                      state={request.contractState}
                      label={copy(
                        `state.${['Active', 'Completed', 'Cancelled'].includes(request.contractState) ? request.contractState : 'other'}`
                      )}
                    />
                  ),
                },
                ...(view === 'expired'
                  ? [
                      {
                        id: 'invoice',
                        label: copy('invoiceState'),
                        render: (request: IncreaseRequest) => (
                          <div className="space-y-1">
                            {request.adjustmentInvoiceState ? (
                              <div>
                                <StatusCell
                                  state={request.adjustmentInvoiceState}
                                  label={copy(`invoice.${request.adjustmentInvoiceState}`)}
                                />
                              </div>
                            ) : (
                              <TextCell value={copy('notIssued')} />
                            )}
                            {request.adjustmentInvoiceId ? (
                              <div className="break-all">
                                <LinkCell
                                  href={`/admin/invoices/${encodeURIComponent(request.adjustmentInvoiceId)}`}
                                >
                                  {request.adjustmentInvoiceId}
                                </LinkCell>
                              </div>
                            ) : null}
                          </div>
                        ),
                      },
                      {
                        id: 'paid',
                        label: copy('paidAmount'),
                        render: (request: IncreaseRequest) => (
                          <CurrencyCell
                            amount={request.adjustmentPaidAmount}
                            format={numbers.money}
                          />
                        ),
                      },
                      {
                        id: 'finance',
                        label: copy('finance'),
                        render: (request: IncreaseRequest) => (
                          <TextCell
                            value={copy(
                              request.financialFollowUp ? 'financeFollowUp' : 'expiredClosed'
                            )}
                          />
                        ),
                      },
                    ]
                  : []),
              ]}
              {...(queueSearch
                ? {
                    actionHeader: copy('actions'),
                    renderActions: (request: IncreaseRequest) => (
                      <Link
                        to="/admin/electricity-increases/$requestId/{-$decision}"
                        params={{ requestId: request.requestId, decision: undefined }}
                        search={queueSearch}
                        className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                        data-table-action-tooltip={copy(
                          view === 'pending' ? 'reviewRequest' : 'openRecord'
                        )}
                      >
                        <TableActionIcon icon={TableEyeIcon}>
                          {copy(view === 'pending' ? 'reviewRequest' : 'openRecord')}
                        </TableActionIcon>
                        <span className="sr-only"> {request.requestId}</span>
                      </Link>
                    ),
                  }
                : view === 'pending'
                  ? {
                      actionHeader: copy('actions'),
                      renderActions: (request: IncreaseRequest) => (
                        <Button
                          type="button"
                          variant="outline"
                          className="min-h-11"
                          disabled={loading || error || locked()}
                          onClick={() => {
                            if (loading || error || locked()) return;
                            document
                              .getElementById(`increase-decision-${request.requestId}`)
                              ?.focus();
                          }}
                          data-table-action-tooltip={copy('reviewRequest')}
                        >
                          <TableActionIcon icon={TableEyeIcon}>
                            {copy('reviewRequest')}
                          </TableActionIcon>
                          <span className="sr-only">: {request.requestId}</span>
                        </Button>
                      ),
                    }
                  : {})}
              cardHeading="h2"
              loading={loading}
              emptyMessage={copy(view === 'pending' ? 'empty' : 'emptyExpired')}
              tableClassName="min-w-[80rem]"
            />
          )}
          {recordId || (!queueSearch && view === 'pending') ? (
            <div
              className={recordId ? 'mx-auto w-full max-w-3xl' : 'mt-5 grid gap-4 lg:grid-cols-2'}
            >
              {visibleRequests?.map((request) => (
                <div key={request.requestId} className="min-w-0 space-y-3">
                  <Card
                    id={`increase-decision-${request.requestId}`}
                    tabIndex={-1}
                    aria-labelledby={`increase-decision-title-${request.requestId}`}
                    className="gap-0 py-0 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CardContent className="space-y-3 px-4 py-4 text-sm sm:px-6">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/55 px-3 py-2">
                        <div>
                          <h2
                            id={`increase-decision-title-${request.requestId}`}
                            className="text-xs font-medium text-muted-foreground"
                          >
                            {copy('quantity')}
                          </h2>
                          <bdi dir="ltr" className="text-lg font-semibold tabular-nums">
                            {numbers.irrDigits(request.originalKwh)} →{' '}
                            {numbers.irrDigits(request.requestedKwh)} kWh
                          </bdi>
                        </div>
                        <StatusCell
                          state={request.status}
                          label={copy(`requestState.${request.status}`)}
                        />
                      </div>
                      {recordId && (
                        <dl className="grid grid-cols-2 gap-3">
                          <div>
                            <dt className="text-muted-foreground">{copy('effective')}</dt>
                            <dd>
                              <DateCell
                                value={request.effectiveFrom}
                                format={(value) => time.format(value)}
                              />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{copy('end')}</dt>
                            <dd>
                              <DateCell
                                value={request.periodEnd}
                                format={(value) => time.format(value)}
                              />
                            </dd>
                          </div>
                          {request.reviewedAt && (
                            <div>
                              <dt className="text-muted-foreground">{copy('reviewedAt')}</dt>
                              <dd>
                                <DateCell
                                  value={request.reviewedAt}
                                  format={(value) => time.format(value)}
                                />
                              </dd>
                            </div>
                          )}
                          {request.reviewReason && (
                            <div className="sm:col-span-2">
                              <dt className="text-muted-foreground">{copy('reviewReason')}</dt>
                              <dd dir="auto" className="wrap-anywhere">
                                {request.reviewReason}
                              </dd>
                            </div>
                          )}
                          {request.adjustmentInvoiceId && (
                            <div>
                              <dt className="text-muted-foreground">{copy('invoiceState')}</dt>
                              <dd>
                                <LinkCell
                                  href={`/admin/invoices/${encodeURIComponent(request.adjustmentInvoiceId)}`}
                                >
                                  {request.adjustmentInvoiceState
                                    ? copy(`invoice.${request.adjustmentInvoiceState}`)
                                    : request.adjustmentInvoiceId}
                                </LinkCell>
                              </dd>
                            </div>
                          )}
                          {request.adjustmentAmount && (
                            <div>
                              <dt className="text-muted-foreground">{copy('adjustmentAmount')}</dt>
                              <dd>
                                <CurrencyCell
                                  amount={request.adjustmentAmount}
                                  format={numbers.money}
                                />
                              </dd>
                            </div>
                          )}
                          {request.adjustmentPaidAmount && (
                            <div>
                              <dt className="text-muted-foreground">{copy('paidAmount')}</dt>
                              <dd>
                                <CurrencyCell
                                  amount={request.adjustmentPaidAmount}
                                  format={numbers.money}
                                />
                              </dd>
                            </div>
                          )}
                        </dl>
                      )}
                      <details className="group border-t pt-1">
                        <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                          <ChevronDown
                            aria-hidden="true"
                            className="size-3.5 group-open:rotate-180"
                          />
                          {copy('requestReferences')}
                        </summary>
                        <dl className="grid gap-x-4 gap-y-2 pb-1 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="text-muted-foreground">{copy('request')}</dt>
                            <dd>
                              <TextCell value={request.requestId} />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-muted-foreground">{copy('contract')}</dt>
                            <dd>
                              <LinkCell
                                href={`/admin/contracts/${encodeURIComponent(request.contractId)}`}
                              >
                                {request.contractId}
                              </LinkCell>
                            </dd>
                          </div>
                          {recordId && (
                            <div>
                              <dt className="text-muted-foreground">{copy('order')}</dt>
                              <dd>
                                <LinkCell
                                  href={`/admin/electricity-orders/${encodeURIComponent(request.orderId)}`}
                                >
                                  {request.orderId}
                                </LinkCell>
                              </dd>
                            </div>
                          )}
                        </dl>
                      </details>
                      {recordId && request.status === 'pending' && !request.canReview && (
                        <p>{copy('readOnlyRecord')}</p>
                      )}
                      {recordId && recordDecision && request.status !== 'pending' && (
                        <p role="status" className="rounded-lg border bg-muted/25 p-3">
                          {copy(
                            request.status === 'awaiting_signature'
                              ? 'approvalRecorded'
                              : request.status === 'rejected'
                                ? 'rejectionRecorded'
                                : 'decisionUnavailable'
                          )}
                        </p>
                      )}
                      {recordId &&
                        !recordDecision &&
                        request.status === 'pending' &&
                        request.canReview && (
                          <div className="flex flex-wrap gap-2 border-t pt-3">
                            {(['approve', 'reject'] as const).map((decision) => (
                              <Link
                                key={decision}
                                to="/admin/electricity-increases/$requestId/{-$decision}"
                                params={{ requestId: recordId, decision }}
                                search={queueSearch ?? {}}
                                disabled={loading || error}
                                className={buttonVariants({
                                  variant: decision === 'approve' ? 'default' : 'outline',
                                  className: 'min-h-11 aria-disabled:opacity-60',
                                })}
                              >
                                {copy(decision === 'approve' ? 'prepareApproval' : 'reject')}
                              </Link>
                            ))}
                          </div>
                        )}
                    </CardContent>
                  </Card>
                  {(recordId
                    ? request.status === 'pending' && request.canReview
                    : view === 'pending') &&
                    (recordId
                      ? recordDecision
                        ? [recordDecision]
                        : []
                      : (['approve', 'reject'] as const)
                    ).map((decision) => {
                      const approving = decision === 'approve';
                      const setDraft = approving ? setEffectiveDate : setReason;
                      return (
                        <IncreaseDecisionEditor
                          key={`${decision}-${actor}-${request.requestId}`}
                          request={request}
                          decision={decision}
                          timezone={timezone}
                          locale={locale}
                          draft={(approving ? effectiveDate : reason)[request.requestId] ?? ''}
                          approvalReasonDraft={approvalReason[request.requestId] ?? ''}
                          onApprovalReason={(value) =>
                            setApprovalReason((current) => ({
                              ...current,
                              [request.requestId]: value,
                            }))
                          }
                          disabled={frozen}
                          blocked={loading || error || reviewLoading}
                          busy={busyRow === request.requestId && busyDecision === decision}
                          onDraft={(value) =>
                            setDraft((current) => ({ ...current, [request.requestId]: value }))
                          }
                          onPrepare={(form, fields) =>
                            reviewDecision(request, decision, form, fields)
                          }
                        />
                      );
                    })}
                </div>
              ))}
            </div>
          ) : null}
        </ListPage.Content>
        {reviewLoading ? <LoadingStatus>{copy('reviewLoading')}</LoadingStatus> : null}
        {uncertain ? (
          <div role="alert" className="space-y-2">
            <p>{formCopy('uncertain')}</p>
            <Button
              type="button"
              variant="outline"
              disabled={pending.current || !!action || denied}
              onClick={retryCaptured}
            >
              {formCopy('retryCaptured')}
            </Button>
          </div>
        ) : null}
        {reviewError ? <p role="alert">{copy('reviewError')}</p> : null}
        {!recordId && (
          <ListPage.Pagination
            kind="cursor"
            hasMore={
              !!nextBefore &&
              !error &&
              !denied &&
              (loading ||
                (nextBefore !== acceptedCursor.current &&
                  (!queries || queries.canAdvance(nextBefore))))
            }
            loading={loading || readLocked()}
            label={copy('pages')}
            nextLabel={copy('more')}
            onNext={() => {
              if (
                nextBefore &&
                !loading &&
                !readLocked() &&
                !error &&
                !denied &&
                nextBefore !== before &&
                (!queries || queries.canAdvance(nextBefore))
              ) {
                expectedNext.current = JSON.stringify([actor, recordId, view, nextBefore]);
                setBefore(nextBefore);
              }
            }}
          />
        )}
      </ListPage>
      {action && command && command.actor === actor ? (
        <TeamActionDialog
          action={action}
          summary={
            decisionReview ? (
              <>
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
                        ? time.format(decisionReview.data.effectiveFrom)
                        : copy('notApplicable'),
                    },
                    {
                      id: 'end',
                      label: copy('end'),
                      value: time.format(decisionReview.data.periodEnd),
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
                      ? [
                          {
                            id: 'reason',
                            label: copy(
                              decisionReview.data.action === 'approve' ? 'approvalReason' : 'reason'
                            ),
                            value: decisionReview.data.reason,
                          },
                        ]
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
                <OrderWalletBalance
                  profileId={decisionReview.scope.profileId}
                  scopeKey={decisionReview.hash}
                  staff
                />
              </>
            ) : undefined
          }
          onClose={() => closeDecision(command, action)}
          onValidationError={() => false}
          onDenied={() => {
            if (live(command) && command.action === action) deny();
          }}
          onUnconfirmed={() => {
            if (live(command) && command.action === action) unconfirmed(command);
          }}
          onPendingChange={(value) => {
            if (!live(command) || command.action !== action) return;
            pending.current = value;
          }}
          onCommandDispatch={(dispatched) => {
            if (live(command) && command.action === action)
              command.attempted = dispatched || command.unconfirmed;
          }}
          onSuccess={async (result) => {
            if (!live(command) || command.action !== action) return;
            if (!(await confirmedIncreaseDecision(result, command.review))) {
              unconfirmed(command);
              return;
            }
            if (!live(command) || command.action !== action) return;
            clearReview();
            setLoading(true);
            setRequests(
              (current) =>
                current?.filter((row) => row.requestId !== command.review.data.requestId) ?? null
            );
            setReason((current) => {
              const next = { ...current };
              delete next[command.review.data.requestId];
              return next;
            });
            setEffectiveDate((current) => {
              const next = { ...current };
              delete next[command.review.data.requestId];
              return next;
            });
            setApprovalReason((current) => {
              const next = { ...current };
              delete next[command.review.data.requestId];
              return next;
            });
            setRevision((value) => value + 1);
            return recordId ? undefined : confirmationText('recorded', locale);
          }}
        />
      ) : null}
    </section>
  );
}
