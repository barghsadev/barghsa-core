import { confirmationText } from '@barghsa/i18n/confirmation';
import { useOwnedFinancialRead } from '../hooks/useOwnedFinancialRead.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Alert, Button, Textarea, buttonVariants } from '@barghsa/ui';
import { Link } from '@tanstack/react-router';
import { CompactFieldFeedback } from './CompactFieldFeedback.js';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
import {
  savingOperationPath,
  savingOperations,
  type SavingOperationRoute,
} from '../lib/saving-operation-route.js';
import type { SavingQueueFilters } from '../lib/staff-order-list-query.js';
import { Form, FormControl, FormField, FormItem, FormLabel, useZodForm } from '@barghsa/ui/form';
import { tSaving } from '@barghsa/i18n/saving';
import { tSavingStaffReview } from '@barghsa/i18n/saving-staff-review';
import { tSavingOperations } from '@barghsa/i18n/saving-operations';
import { ErrorCodes } from '@barghsa/shared/errors';
import { useLocale } from '../hooks/useLocale.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';
import { withCsrf } from '../lib/csrf.js';
import type { SavingHardwareOwner } from '../lib/saving-hardware-form.js';
import {
  savingOperationPreviewBody,
  savingOperationFields,
  matchedSavingOperationReview,
  matchedSavingOperationReceipt,
  publicSavingOperationError,
  definitiveSavingOperationRejection,
  type SavingOperationDraft,
  type SavingOperationIntent,
  type SavingOperationReview,
  type SavingOperationSource,
  type SavingOperationStage,
} from '../lib/saving-staff-operation-form.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';

interface Command {
  action: TeamAction;
  review: SavingOperationReview;
  intent: SavingOperationIntent;
  owner: SavingHardwareOwner;
  rejected: boolean;
}
function initialIntent(
  order: SavingOperationSource,
  operation?: 'reject' | SavingOperationStage
): SavingOperationIntent {
  return operation === 'reject' || order.status === 'awaiting_staff_review'
    ? { kind: 'decision', action: 'reject' }
    : {
        kind: 'stage',
        stage:
          operation ??
          order.stages.find((row) => row.status === 'in_progress')?.stage ??
          'product_delivery',
        action: 'complete',
      };
}
export function SavingStaffOperationForm(
  props: Parameters<typeof OwnedSavingStaffOperationForm>[0]
) {
  const actor = useAccountUser();
  const profileRevision = useProfileContextRevision();
  return (
    <OwnedSavingStaffOperationForm key={JSON.stringify([actor, profileRevision])} {...props} />
  );
}
function OwnedSavingStaffOperationForm({
  order,
  workflow,
  draft,
  onDraft,
  owner,
  scope,
  currentScope,
  notify,
  onPending,
  onSuccess,
  onWithdraw,
  prerequisites,
  summary,
}: {
  order: SavingOperationSource;
  workflow?:
    | { orderId: string; search: SavingQueueFilters; operation?: SavingOperationRoute | undefined }
    | undefined;
  draft: SavingOperationDraft;
  onDraft: (draft: SavingOperationDraft) => void;
  owner: RefObject<SavingHardwareOwner | null>;
  scope: string;
  currentScope: RefObject<string>;
  notify: () => void;
  onPending: () => void;
  onSuccess: () => void;
  onWithdraw: (reason: 'forbidden' | 'missing') => void;
  prerequisites: (stage: SavingOperationStage) => string[];
  summary: (review: SavingOperationReview) => ReactNode;
}) {
  const actor = useAccountUser();
  const routeOperation = workflow?.operation;
  const operation = routeOperation ? savingOperations[routeOperation] : undefined;
  const visibleOperation = useRef(routeOperation);
  visibleOperation.current = routeOperation;
  const profileRevision = useProfileContextRevision();
  const readFinancial = useOwnedFinancialRead(
    actor,
    profileRevision,
    JSON.stringify([scope, order])
  );
  const locale = useLocale();
  const copy = (key: string) => tSavingStaffReview(key, locale) ?? tSaving(key, locale);
  const formCopy = (key: string) => tSavingOperations(key, locale);
  const mounted = useRef(false);
  const request = useRef(0);
  const preparing = useRef(false);
  const pending = useRef(false);
  const privateWithdrawn = useRef(false);
  const operationOwner = useRef<SavingHardwareOwner | null>(null);
  const captured = useRef<Command | null>(null);
  const intent = useRef<SavingOperationIntent>(initialIntent(order, operation));
  const [action, setAction] = useState<TeamAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const messages = {
    note: formCopy(
      order.status === 'awaiting_staff_review' ? 'reasonInvalid' : 'explanationInvalid'
    ),
    handover: formCopy('handoverInvalid'),
  };
  const form: ReturnType<typeof useZodForm<SavingOperationDraft>> =
    useZodForm<SavingOperationDraft>(
      async () => {
        const raw = JSON.stringify(form.getValues());
        const generation = request.current;
        const currentIntent = intent.current;
        const schemas = await import('../lib/saving-staff-operation-form-schemas.js');
        return currentScope.current === scope &&
          generation === request.current &&
          currentIntent === intent.current &&
          raw === JSON.stringify(form.getValues())
          ? schemas.savingOperationSchema(currentIntent, messages)
          : schemas.inactiveSavingOperationSchema;
      },
      { defaultValues: draft, validationUnavailableMessage: formCopy('validationUnavailable') }
    );
  const applyFields = useActionFieldErrors(form, messages, copy('staffReviewError'));
  const active = () =>
    mounted.current && currentScope.current === scope && !privateWithdrawn.current;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++request.current;
      if (owner.current === operationOwner.current) {
        owner.current = null;
        notify();
      }
    };
  }, []);
  useEffect(() => {
    if (!workflow) return;
    if (operationOwner.current) release();
    intent.current = initialIntent(order, operation);
    setError(false);
    form.reset(draft);
  }, [routeOperation]);
  function release() {
    ++request.current;
    preparing.current = false;
    pending.current = false;
    captured.current = null;
    if (owner.current === operationOwner.current) owner.current = null;
    operationOwner.current = null;
    setAction(null);
    setBusy(false);
    setUncertain(false);
    intent.current = initialIntent(order, operation);
    notify();
  }
  function withdraw(reason: 'forbidden' | 'missing') {
    if (!active()) return;
    privateWithdrawn.current = true;
    form.reset({ note: '', handover: '' });
    release();
    onWithdraw(reason);
  }
  function live(command: Command, ownedAction: TeamAction) {
    return (
      active() &&
      captured.current === command &&
      command.action === ownedAction &&
      owner.current === command.owner
    );
  }
  function unconfirmed(command: Command, ownedAction: TeamAction) {
    if (!live(command, ownedAction)) return;
    command.owner.uncertain = true;
    pending.current = false;
    setUncertain(true);
    setAction(null);
    notify();
  }
  function close(command: Command, ownedAction: TeamAction) {
    if (!live(command, ownedAction) || pending.current) return;
    if (command.owner.uncertain || (command.owner.attempted && !command.rejected))
      unconfirmed(command, ownedAction);
    else release();
  }
  function showFields(value: unknown, currentIntent: SavingOperationIntent) {
    const rejection = definitiveSavingOperationRejection(value);
    if (
      rejection?.code !== ErrorCodes.VALIDATION_INPUT_INVALID.code ||
      !Array.isArray(rejection.fields)
    )
      return false;
    const fields = savingOperationFields(rejection.fields, currentIntent);
    return !!fields && applyFields(fields);
  }
  function decorate(command: Command, ownedAction: TeamAction) {
    ownedAction.errorMessages = Object.fromEntries(
      [
        ErrorCodes.VALIDATION_INPUT_INVALID.code,
        'VALIDATION:INPUT_INVALID',
        ErrorCodes.CONFLICT_STATE.code,
        ErrorCodes.CONFLICT_VERSION.code,
        ErrorCodes.NOT_FOUND_RESOURCE.code,
      ].map((code) => [
        code,
        (value: unknown) => {
          if (!live(command, ownedAction)) return copy('staffReviewError');
          if (publicSavingOperationError(value)?.code === ErrorCodes.NOT_FOUND_RESOURCE.code) {
            withdraw('missing');
            return formCopy('missing');
          }
          if (definitiveSavingOperationRejection(value)) {
            command.rejected = true;
            if (!command.owner.uncertain && showFields(value, command.intent)) {
              pending.current = false;
              close(command, ownedAction);
            }
          }
          return copy(code.startsWith('CONFLICT:') ? 'staffConflict' : 'staffReviewError');
        },
      ])
    );
  }
  function prepare(currentIntent: SavingOperationIntent) {
    if (
      workflow &&
      (currentIntent.kind === 'stage'
        ? operation !== currentIntent.stage
        : (operation && operation !== 'reject') ||
          currentIntent.action !== (operation === 'reject' ? 'reject' : 'approve'))
    )
      return;
    if (
      !active() ||
      owner.current ||
      preparing.current ||
      pending.current ||
      captured.current ||
      form.isSubmissionPending()
    )
      return;
    if (
      currentIntent.kind === 'decision'
        ? order.status !== 'awaiting_staff_review'
        : !['approved', 'in_progress'].includes(order.status) ||
          !order.stages.some(
            (row) => row.stage === currentIntent.stage && row.status === 'in_progress'
          ) ||
          prerequisites(currentIntent.stage).length > 0
    )
      return;
    intent.current = currentIntent;
    const token: SavingHardwareOwner = {
      kind: currentIntent.kind,
      attempted: false,
      uncertain: false,
    };
    owner.current = token;
    operationOwner.current = token;
    preparing.current = true;
    setBusy(true);
    setError(false);
    form.clearErrors();
    notify();
    onPending();
    const generation = ++request.current;
    const raw = JSON.stringify(form.getValues());
    const authorized = () =>
      active() &&
      visibleOperation.current === routeOperation &&
      generation === request.current &&
      owner.current === token;
    const fresh = () => authorized() && raw === JSON.stringify(form.getValues());
    void form
      .handleSubmit(async (values) => {
        if (!fresh() || JSON.stringify(values) !== raw) return;
        const path = `/api/staff/saving/orders/${encodeURIComponent(order.id)}`;
        const body = savingOperationPreviewBody(currentIntent, values);
        try {
          const response = await readFinancial(
            currentIntent.kind === 'decision'
              ? `${path}/financial-review`
              : `${path}/stages/${currentIntent.stage}/${currentIntent.action}/review`,
            {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
            },
            true
          );
          if (!authorized()) return;
          if (response.status === 401 || response.status === 403) {
            withdraw('forbidden');
            return;
          }
          if (response.status === 404) {
            withdraw('missing');
            return;
          }
          const value: unknown = await response.json().catch(() => null);
          if (!fresh()) return;
          if (!response.ok) {
            if (response.status === 400 && showFields(value, currentIntent)) return;
            throw new Error('Review unavailable');
          }
          const review =
            response.status === 200
              ? matchedSavingOperationReview(value, order, currentIntent, values)
              : null;
          if (!review) throw new Error('Review mismatch');
          const ownedAction: TeamAction = {
            ...(currentIntent.kind === 'decision' && currentIntent.action === 'reject'
              ? { risk: 'both' as const }
              : { risk: 'financial' as const }),
            title: copy(
              currentIntent.kind === 'decision'
                ? currentIntent.action === 'approve'
                  ? 'staffApprove'
                  : 'staffReject'
                : currentIntent.action === 'skip'
                  ? 'staffSkip'
                  : 'staffComplete'
            ),
            description: copy(
              currentIntent.kind === 'decision' ? 'staffReviewConfirm' : 'staffStageReviewConfirm'
            ),
            method: 'POST',
            responseDeadline: true,
            successStatus: 200,
            path:
              currentIntent.kind === 'decision'
                ? `${path}/${currentIntent.action}`
                : `${path}/stages/${currentIntent.stage}/${currentIntent.action}`,
            body: Object.freeze({
              idempotencyKey: crypto.randomUUID(),
              expectedReviewHash: review.value.hash,
              ...(currentIntent.kind === 'decision'
                ? {
                    expectedVersionId: order.versionId,
                    ...(currentIntent.action === 'reject' ? { reason: values.note.trim() } : {}),
                  }
                : {
                    expectedStatus: 'in_progress',
                    explanation: values.note.trim(),
                    ...(values.handover.trim()
                      ? { handoverDescription: values.handover.trim() }
                      : {}),
                  }),
            }),
            conflictMessage: copy('staffConflict'),
            forbiddenMessage: copy('staffForbidden'),
          };
          const command: Command = {
            action: ownedAction,
            review,
            intent: currentIntent,
            owner: token,
            rejected: false,
          };
          captured.current = command;
          decorate(command, ownedAction);
          setAction(ownedAction);
        } catch {
          if (fresh()) setError(true);
        }
      })()
      .finally(() => {
        if (!authorized()) return;
        preparing.current = false;
        setBusy(false);
        if (!captured.current) release();
      });
  }
  function retry() {
    if (!active()) return;
    const command = captured.current;
    if (
      !command ||
      !live(command, command.action) ||
      !command.owner.uncertain ||
      pending.current ||
      action
    )
      return;
    const next = { ...command.action };
    command.action = next;
    decorate(command, next);
    setAction(next);
  }
  const frozen = !!captured.current || pending.current || uncertain;
  const blocked = busy || !!owner.current;
  const reviewing = order.status === 'awaiting_staff_review';
  const reviewingForm = reviewing && (!workflow || operation === 'reject');
  const inProgress = ['approved', 'in_progress'].includes(order.status)
    ? order.stages.filter((row) => row.status === 'in_progress')
    : [];
  const activeStages = workflow ? inProgress.filter((row) => row.stage === operation) : inProgress;
  const progress = order.stages.filter((row) => !inProgress.includes(row));
  const explanationRequired = activeStages.length > 0;
  const handoverStage = activeStages.some((row) => row.stage === 'equipment_handover');
  const showEditor = reviewingForm || explanationRequired;
  const actionTitle = reviewing
    ? formCopy('decisionTitle')
    : activeStages.length === 1
      ? copy(activeStages[0]!.stage)
      : copy('staffFulfillmentLane');
  const ProgressFrame = workflow ? 'details' : 'section';
  const command = captured.current;
  const openOperation = (entry: SavingOperationRoute, label: string) =>
    workflow && (
      <Link
        key={entry}
        to={savingOperationPath}
        params={{ orderId: workflow.orderId, operation: entry }}
        search={workflow.search}
        className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
        disabled={blocked}
      >
        {label}
      </Link>
    );
  const stageAction = (
    stage: SavingOperationStage,
    action: 'complete' | 'skip',
    blockedByStage: boolean
  ) => (
    <Button
      type="button"
      variant={action === 'skip' ? 'outline' : 'default'}
      disabled={blocked || blockedByStage}
      onClick={() => prepare({ kind: 'stage', stage, action })}
    >
      {copy(action === 'skip' ? 'staffSkip' : 'staffComplete')}
    </Button>
  );
  return (
    <div data-testid="saving-staff-operation-form" className="space-y-3">
      {workflow && !operation && (
        <div className="flex flex-wrap gap-2">
          {reviewing && (
            <>
              <Button
                disabled={blocked}
                onClick={() => prepare({ kind: 'decision', action: 'approve' })}
              >
                {copy('staffApprove')}
              </Button>
              {openOperation('reject', copy('staffReject'))}
            </>
          )}
          {inProgress.map((stage) => {
            const entry = stage.stage.replaceAll('_', '-') as SavingOperationRoute;
            return openOperation(entry, copy(stage.stage));
          })}
        </div>
      )}
      {operation && !showEditor && !uncertain && (
        <p role="status" className="rounded-lg border bg-card p-4 text-sm">
          {formCopy('actionUnavailable')}
        </p>
      )}
      <Form {...form}>
        <form
          className="space-y-3"
          aria-label={
            routeOperation ? copy(operation === 'reject' ? 'staffReject' : operation!) : undefined
          }
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (showEditor) prepare(intent.current);
          }}
        >
          {showEditor && (
            <div className={recordEditorSurface}>
              {!workflow && (
                <header className="border-b bg-muted/25 px-4 py-3">
                  <h3 className="font-semibold">{actionTitle}</h3>
                </header>
              )}
              <div className="space-y-4 px-4 py-4 sm:px-6">
                {operation === 'reject' && (
                  <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    {formCopy('rejectionNotice')}
                  </p>
                )}
                <div className={handoverStage ? 'grid gap-x-4 gap-y-3 md:grid-cols-2' : undefined}>
                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field, fieldState }) => (
                      <FormItem id="saving-staff-note">
                        <FormLabel>
                          {reviewingForm ? formCopy('rejectionReason') : copy('staffReason')}
                        </FormLabel>
                        {operation && (
                          <p
                            id="saving-staff-note-prompt"
                            className="text-sm text-muted-foreground"
                          >
                            {formCopy(
                              operation === 'reject' ? 'rejectionPrompt' : operation + 'Prompt'
                            )}
                          </p>
                        )}
                        <FormControl>
                          <Textarea
                            {...field}
                            rows={operation ? 3 : 2}
                            className="max-h-44 min-h-14 bg-background"
                            dir="auto"
                            aria-describedby={operation ? 'saving-staff-note-prompt' : undefined}
                            aria-required={!!operation || explanationRequired || undefined}
                            disabled={frozen}
                            onChange={(event) => {
                              if (frozen || !active()) return;
                              field.onChange(event);
                              onDraft({ ...form.getValues(), note: event.target.value });
                            }}
                          />
                        </FormControl>
                        <CompactFieldFeedback
                          help={
                            operation
                              ? formCopy(reviewingForm ? 'noteLimit' : 'noteVisible')
                              : formCopy(reviewingForm ? 'rejectionHelp' : 'explanationHelp')
                          }
                          validationMessage={messages.note}
                          invalid={!!fieldState.error?.message}
                        />
                      </FormItem>
                    )}
                  />
                  {handoverStage && (
                    <FormField
                      control={form.control}
                      name="handover"
                      render={({ field, fieldState }) => (
                        <FormItem id="saving-handover">
                          <FormLabel>{copy('staffHandover')}</FormLabel>
                          <p id="saving-handover-prompt" className="text-sm text-muted-foreground">
                            {formCopy('handoverExample')}
                          </p>
                          <FormControl>
                            <Textarea
                              {...field}
                              rows={operation ? 3 : 2}
                              className="max-h-44 min-h-14 bg-background"
                              dir="auto"
                              aria-describedby="saving-handover-prompt"
                              disabled={frozen}
                              onChange={(event) => {
                                if (frozen || !active()) return;
                                field.onChange(event);
                                onDraft({ ...form.getValues(), handover: event.target.value });
                              }}
                            />
                          </FormControl>
                          <CompactFieldFeedback
                            help={formCopy('handoverHelp')}
                            validationMessage={messages.handover}
                            invalid={!!fieldState.error?.message}
                          />
                        </FormItem>
                      )}
                    />
                  )}
                </div>
                {activeStages.map((stage) => {
                  const reasons = prerequisites(stage.stage);
                  return (
                    (reasons.length > 0 || stage.explanation || stage.handover_description) && (
                      <div key={stage.stage} className="space-y-1 text-sm wrap-anywhere">
                        {stage.explanation && <p>{stage.explanation}</p>}
                        {stage.handover_description && <p>{stage.handover_description}</p>}
                        {reasons.length > 0 && (
                          <p className="text-muted-foreground">{reasons.join(' ')}</p>
                        )}
                      </div>
                    )
                  );
                })}
              </div>
              {reviewingForm && (
                <RecordEditorActions>
                  {!workflow && (
                    <Button
                      type="button"
                      disabled={blocked}
                      onClick={() => prepare({ kind: 'decision', action: 'approve' })}
                    >
                      {copy('staffApprove')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={blocked}
                    onClick={() => prepare({ kind: 'decision', action: 'reject' })}
                  >
                    {copy('staffReject')}
                  </Button>
                </RecordEditorActions>
              )}
              {activeStages.map((stage) => {
                const blockedByStage = prerequisites(stage.stage).length > 0;
                return (
                  <RecordEditorActions key={stage.stage}>
                    {activeStages.length > 1 && (
                      <strong className="text-sm">{copy(stage.stage)}</strong>
                    )}
                    {stage.stage === 'equipment_handover' &&
                      stageAction(stage.stage, 'skip', blockedByStage)}
                    {stageAction(stage.stage, 'complete', blockedByStage)}
                  </RecordEditorActions>
                );
              })}
            </div>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
              {formCopy('checking')}
            </p>
          )}
          {error && <Alert variant="destructive">{copy('staffReviewError')}</Alert>}
          {form.formState.errors.root?.validation && (
            <p role="alert">{formCopy('validationUnavailable')}</p>
          )}
          {progress.length > 0 && (
            <ProgressFrame className="space-y-2" aria-label={formCopy('stageProgress')}>
              {workflow ? (
                <summary className="touch-action cursor-pointer rounded-lg border bg-card px-4 py-2 text-sm font-medium">
                  {formCopy('stageProgress')}
                </summary>
              ) : (
                <h3 className="text-sm font-medium">{formCopy('stageProgress')}</h3>
              )}
              <ol className="divide-y rounded-lg border">
                {progress.map((stage) => (
                  <li key={stage.stage} className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <strong>{copy(stage.stage)}</strong>
                      <span className="text-xs text-muted-foreground">
                        {copy(stage.status === 'in_progress' ? 'inProgress' : stage.status)}
                      </span>
                    </div>
                    {stage.explanation && (
                      <p className="mt-2 text-sm">
                        {stage.stage === 'request_confirmation' &&
                        stage.status === 'completed' &&
                        stage.explanation === 'Staff approved request'
                          ? copy('stageConfirmedNote')
                          : stage.explanation}
                      </p>
                    )}
                    {stage.handover_description && (
                      <p className="mt-1 wrap-anywhere text-sm">{stage.handover_description}</p>
                    )}
                  </li>
                ))}
              </ol>
            </ProgressFrame>
          )}
        </form>
      </Form>
      {uncertain && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 px-4 py-3 text-sm"
        >
          <p>{formCopy('uncertain')}</p>
          <Button
            type="button"
            variant="outline"
            data-testid="saving-staff-operation-retry"
            disabled={pending.current || !!action}
            onClick={retry}
          >
            {formCopy('retryCaptured')}
          </Button>
        </div>
      )}
      {action && command && live(command, action) && (
        <TeamActionDialog
          action={action}
          focusSummary
          summary={summary(command.review)}
          onClose={() => close(command, action)}
          onValidationError={() => false}
          onDenied={() => {
            if (live(command, action)) withdraw('forbidden');
          }}
          onUnconfirmed={() => unconfirmed(command, action)}
          onPendingChange={(value) => {
            if (!live(command, action)) return;
            pending.current = value;
            if (value) {
              onPending();
              notify();
            }
          }}
          onCommandDispatch={(dispatched) => {
            if (live(command, action))
              command.owner.attempted = dispatched || command.owner.uncertain;
          }}
          onSuccess={async (value) => {
            if (!live(command, action)) return;
            if (!matchedSavingOperationReceipt(value, command.review)) {
              unconfirmed(command, action);
              return;
            }
            const next = form.getValues();
            if (command.intent.kind === 'stage' || command.intent.action === 'reject')
              next.note = '';
            if (
              command.intent.kind === 'stage' &&
              command.review.kind === 'stage' &&
              command.review.value.data.handoverDescription !== null
            )
              next.handover = '';
            form.reset(next);
            onDraft(next);
            release();
            onSuccess();
            return confirmationText('recorded', locale);
          }}
        />
      )}
    </div>
  );
}
