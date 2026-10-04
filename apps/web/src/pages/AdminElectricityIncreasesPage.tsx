import { useEffect, useRef, useState } from 'react';
import { t as appText } from '@barghsa/i18n/app';
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
import { t } from '@barghsa/i18n/admin-ui';
import { Button, Card, CardContent, FinancialReviewSummary, Input, ListPage } from '@barghsa/ui';
import { type ElectricityIncreaseStaffDecisionReview } from '@barghsa/shared/finance';
import { TeamActionDialog, type TeamAction } from '../components/TeamActionDialog.js';
import { withCsrf } from '../lib/csrf.js';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import type { ListQueryBinding } from '../hooks/useListQuery.js';

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
  draft,
  disabled,
  busy,
  blocked,
  onDraft,
  onPrepare,
}: {
  request: IncreaseRequest;
  decision: IncreaseDecision;
  locale: 'en' | 'fa';
  draft: string;
  disabled: boolean;
  busy: boolean;
  blocked: boolean;
  onDraft: (draft: string) => void;
  onPrepare: (form: DecisionForm, fields: (fields: unknown[]) => boolean) => void;
}) {
  const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
  const formCopy = (key: string) => appText(`electricity.increaseDecisionForm.${key}`, locale);
  const name = decision === 'approve' ? 'effectiveDate' : 'reason';
  const message = formCopy(decision === 'approve' ? 'dateInvalid' : 'reasonInvalid');
  const form: DecisionForm = useZodForm<IncreaseDecisionDraft>(
    async () => {
      const raw = form.getValues(name);
      const schemas = await import('../lib/electricity-increase-decision-form-schemas.js');
      return form.getValues(name) === raw
        ? schemas.increaseDecisionSchema(decision, message)
        : schemas.inactiveIncreaseDecisionSchema;
    },
    {
      defaultValues: {
        effectiveDate: decision === 'approve' ? draft : '',
        reason: decision === 'reject' ? draft : '',
      },
      validationUnavailableMessage: formCopy('validationUnavailable'),
    }
  );
  useEffect(() => {
    if (form.getValues(name) !== draft)
      form.reset({
        effectiveDate: decision === 'approve' ? draft : '',
        reason: decision === 'reject' ? draft : '',
      });
  }, [draft]);
  const fieldErrors = useActionFieldErrors(form, { [name]: message }, copy('reviewError'));
  return (
    <Form {...form}>
      <form
        noValidate
        data-testid={`electricity-increase-${decision}-form`}
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          onPrepare(
            form,
            (fields) =>
              fields.length > 0 &&
              fields.every(
                (field) => field === (decision === 'approve' ? 'effectiveFrom' : 'reason')
              ) &&
              fieldErrors(fields.map(() => name))
          );
        }}
      >
        <FormField
          control={form.control}
          name={name}
          render={({ field }) => (
            <FormItem
              id={`increase-${decision === 'approve' ? 'effective' : 'reason'}-${request.requestId}`}
            >
              <FormLabel>{copy(decision === 'approve' ? 'approveDate' : 'reason')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type={decision === 'approve' ? 'datetime-local' : 'text'}
                  disabled={disabled}
                  onChange={(event) => {
                    field.onChange(event);
                    onDraft(event.target.value);
                  }}
                />
              </FormControl>
              <FormDescription>
                {decision === 'approve' ? copy('approveDateHelp') : formCopy('reasonHelp')}
              </FormDescription>
              <FormMessage reserveSpace />
            </FormItem>
          )}
        />
        {form.formState.errors.root?.validation ? (
          <p role="alert">{formCopy('validationUnavailable')}</p>
        ) : null}
        <Button
          type="submit"
          variant={decision === 'reject' ? 'destructive' : 'default'}
          className={
            decision === 'reject'
              ? 'dark:bg-destructive/10 dark:hover:bg-destructive/20'
              : undefined
          }
          disabled={disabled || blocked || busy}
          aria-busy={busy || undefined}
        >
          {busy ? (
            <span
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
            />
          ) : null}
          {copy(decision)}
        </Button>
      </form>
    </Form>
  );
}

export default function AdminElectricityIncreasesPage({
  queries,
}: { queries?: ListQueryBinding } = {}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const formCopy = (key: string) => appText(`electricity.increaseDecisionForm.${key}`, locale);
  const numbers = useNumberFormatting(locale);
  const copy = (key: string) => t(`admin.electricityIncreases.${key}`, locale);
  const [requests, setRequests] = useState<IncreaseRequest[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [localBefore, setLocalBefore] = useState<string | null>(null);
  const [localView, setLocalView] = useState<'pending' | 'expired'>('pending');
  const before = queries ? queries.query.cursor || null : localBefore;
  const view = queries ? (queries.query.filters.status as 'pending' | 'expired') : localView;
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
  const [effectiveDate, setEffectiveDate] = useState<Record<string, string>>({});
  const [action, setAction] = useState<TeamAction | null>(null);
  const [decisionReview, setDecisionReview] =
    useState<ElectricityIncreaseStaffDecisionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState(false);
  const reviewRequest = useRef(0);
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

  const scope = JSON.stringify([actor, view, before]);
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
      setEffectiveDate({});
    }
    expectedNext.current = null;
  }, [scope]);
  useEffect(() => {
    clearReview();
    setReason({});
    setEffectiveDate({});
    setRequests(null);
    setNextBefore(null);
    setDenied(false);
  }, [actor]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const path =
      `/api/staff/electricity/increase-requests?status=${view}` +
      (before ? `&before=${encodeURIComponent(before)}` : '');
    void fetch(path, { credentials: 'include', signal: controller.signal })
      .then(async (response) => {
        if (
          controller.signal.aborted ||
          currentActor.current !== actor ||
          currentScope.current !== scope
        )
          return null;
        if ([401, 403].includes(response.status)) throw new Error('denied');
        if (!response.ok) throw new Error('Queue unavailable');
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
        if (caught instanceof Error && caught.message === 'denied') {
          deny();
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
  }, [before, revision, view, actor]);

  function deny() {
    accessDenied.current = true;
    setDenied(true);
    setLoading(false);
    setError(true);
    setRequests(null);
    setNextBefore(null);
    setReason({});
    setEffectiveDate({});
    clearReview();
  }
  function clearReview() {
    ++reviewRequest.current;
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
      loading ||
      error ||
      accessDenied.current ||
      view !== 'pending' ||
      acceptedActor !== actor ||
      currentScope.current !== scope ||
      !visibleRequests?.some((row) => JSON.stringify(row) === JSON.stringify(request))
    )
      return;
    const name = decision === 'approve' ? 'effectiveDate' : 'reason';
    const raw = form.getValues(name);
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
    const fresh = () => authorized() && form.getValues(name) === raw;
    void form
      .handleSubmit(async (draft) => {
        if (!fresh() || draft[name] !== raw) return;
        const effectiveFrom = decision === 'approve' ? increaseEffectiveFrom(raw) : undefined;
        if (effectiveFrom === null) return;
        const previewInput =
          decision === 'approve'
            ? effectiveFrom
              ? { effectiveFrom }
              : {}
            : { reason: raw.trim() };
        const path = `/api/staff/electricity/increase-requests/${encodeURIComponent(request.requestId)}/${decision}`;
        try {
          const response = await fetch(`${path}/review`, {
            method: 'POST',
            credentials: 'include',
            headers: withCsrf({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(previewInput),
          });
          if (!authorized()) return;
          if ([401, 403].includes(response.status)) {
            deny();
            return;
          }
          if (response.status === 404) {
            missing(request.requestId);
            return;
          }
          const value: unknown = await response.json().catch(() => null);
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
              title: copy(decision),
              description: copy('reviewConfirm'),
              path,
              method: 'POST',
              successStatus: 201,
              body: {
                idempotencyKey: crypto.randomUUID(),
                expectedReviewHash: review.hash,
                ...(decision === 'approve'
                  ? { effectiveFrom: review.data.effectiveFrom }
                  : { reason: raw.trim() }),
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

  const command = captured.current;
  const frozen = pending.current || !!captured.current || uncertain;
  return (
    <section className="space-y-5" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{copy('title')}</h1>
          <p className="text-muted-foreground">{copy('description')}</p>
        </div>
        <Button
          variant="outline"
          disabled={loading || readLocked()}
          onClick={() => {
            if (readLocked()) return;
            if (preparing.current) clearReview();
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
                disabled={readLocked()}
                onClick={() => {
                  if (status === view || readLocked()) return;
                  setNextBefore(null);
                  if (queries) queries.setQuery({ filters: { status } });
                  else {
                    setLocalView(status);
                    setLocalBefore(null);
                  }
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
                <Button type="button" variant="outline" disabled={readLocked()} onClick={refresh}>
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
                    <>
                      <IncreaseDecisionEditor
                        key={`approve-${actor}-${request.requestId}`}
                        request={request}
                        decision="approve"
                        locale={locale}
                        draft={effectiveDate[request.requestId] ?? ''}
                        disabled={frozen}
                        blocked={loading || error || reviewLoading}
                        busy={busyRow === request.requestId && busyDecision === 'approve'}
                        onDraft={(draft) =>
                          setEffectiveDate((current) => ({
                            ...current,
                            [request.requestId]: draft,
                          }))
                        }
                        onPrepare={(form, fields) =>
                          reviewDecision(request, 'approve', form, fields)
                        }
                      />
                      <IncreaseDecisionEditor
                        key={`reject-${actor}-${request.requestId}`}
                        request={request}
                        decision="reject"
                        locale={locale}
                        draft={reason[request.requestId] ?? ''}
                        disabled={frozen}
                        blocked={loading || error || reviewLoading}
                        busy={busyRow === request.requestId && busyDecision === 'reject'}
                        onDraft={(draft) =>
                          setReason((current) => ({ ...current, [request.requestId]: draft }))
                        }
                        onPrepare={(form, fields) =>
                          reviewDecision(request, 'reject', form, fields)
                        }
                      />
                    </>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </ListPage.Content>
        {reviewLoading ? <p role="status">{copy('reviewLoading')}</p> : null}
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
              expectedNext.current = JSON.stringify([actor, view, nextBefore]);
              setBefore(nextBefore);
            }
          }}
        />
      </ListPage>
      {action && command && command.actor === actor ? (
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
            if (value) command.attempted = true;
          }}
          onSuccess={async (result) => {
            if (!live(command) || command.action !== action) return;
            if (!(await confirmedIncreaseDecision(result, command.review))) {
              unconfirmed(command);
              return;
            }
            if (!live(command) || command.action !== action) return;
            clearReview();
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
            setRevision((value) => value + 1);
          }}
        />
      ) : null}
    </section>
  );
}
