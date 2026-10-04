import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, Input } from '@barghsa/ui';
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
function initialIntent(order: SavingOperationSource): SavingOperationIntent {
  return order.status === 'awaiting_staff_review'
    ? { kind: 'decision', action: 'reject' }
    : {
        kind: 'stage',
        stage:
          order.stages.find((row) => row.status === 'in_progress')?.stage ?? 'product_delivery',
        action: 'complete',
      };
}
export function SavingStaffOperationForm({
  order,
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
  const intent = useRef<SavingOperationIntent>(initialIntent(order));
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
    intent.current = initialIntent(order);
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
    const authorized = () => active() && generation === request.current && owner.current === token;
    const fresh = () => authorized() && raw === JSON.stringify(form.getValues());
    void form
      .handleSubmit(async (values) => {
        if (!fresh() || JSON.stringify(values) !== raw) return;
        const path = `/api/staff/saving/orders/${encodeURIComponent(order.id)}`;
        const body = savingOperationPreviewBody(currentIntent, values);
        try {
          const response = await fetch(
            currentIntent.kind === 'decision'
              ? `${path}/financial-review`
              : `${path}/stages/${currentIntent.stage}/${currentIntent.action}/review`,
            {
              method: 'POST',
              credentials: 'include',
              headers: withCsrf({ 'Content-Type': 'application/json' }),
              body: JSON.stringify(body),
            }
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
  const command = captured.current;
  return (
    <div data-testid="saving-staff-operation-form" className="space-y-3">
      <Form {...form}>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            prepare(intent.current);
          }}
        >
          {order.status === 'awaiting_staff_review' && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={blocked}
                onClick={() => prepare({ kind: 'decision', action: 'approve' })}
              >
                {copy('staffApprove')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                className="dark:bg-destructive/10 dark:hover:bg-destructive/20"
                disabled={blocked}
                onClick={() => prepare({ kind: 'decision', action: 'reject' })}
              >
                {copy('staffReject')}
              </Button>
            </div>
          )}
          <FormField
            control={form.control}
            name="note"
            render={({ field }) => (
              <FormItem id="saving-staff-note">
                <FormLabel>{copy('staffReason')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={frozen}
                    onChange={(event) => {
                      if (frozen || !active()) return;
                      field.onChange(event);
                      onDraft({ ...form.getValues(), note: event.target.value });
                    }}
                  />
                </FormControl>
                <FormDescription>
                  {formCopy(
                    order.status === 'awaiting_staff_review' ? 'rejectionHelp' : 'explanationHelp'
                  )}
                </FormDescription>
                <FormMessage reserveSpace />
              </FormItem>
            )}
          />
          {order.stages.some(
            (row) => row.stage === 'equipment_handover' && row.status === 'in_progress'
          ) && (
            <FormField
              control={form.control}
              name="handover"
              render={({ field }) => (
                <FormItem id="saving-handover">
                  <FormLabel>{copy('staffHandover')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      disabled={frozen}
                      onChange={(event) => {
                        if (frozen || !active()) return;
                        field.onChange(event);
                        onDraft({ ...form.getValues(), handover: event.target.value });
                      }}
                    />
                  </FormControl>
                  <FormDescription>{formCopy('handoverHelp')}</FormDescription>
                  <FormMessage reserveSpace />
                </FormItem>
              )}
            />
          )}
          <ol className="space-y-2">
            {order.stages.map((stage) => {
              const reasons = prerequisites(stage.stage);
              return (
                <li key={stage.stage} className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <strong>{copy(stage.stage)}</strong> · {copy(stage.status)}
                    </span>
                    {stage.status === 'in_progress' && (
                      <span className="flex gap-2">
                        <Button
                          size="sm"
                          type="button"
                          disabled={blocked || reasons.length > 0}
                          onClick={() =>
                            prepare({ kind: 'stage', stage: stage.stage, action: 'complete' })
                          }
                        >
                          {copy('staffComplete')}
                        </Button>
                        {stage.stage === 'equipment_handover' && (
                          <Button
                            size="sm"
                            type="button"
                            variant="outline"
                            disabled={blocked}
                            onClick={() =>
                              prepare({ kind: 'stage', stage: stage.stage, action: 'skip' })
                            }
                          >
                            {copy('staffSkip')}
                          </Button>
                        )}
                      </span>
                    )}
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
                  {stage.status === 'in_progress' && reasons.length > 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">{reasons.join(' ')}</p>
                  )}
                  {stage.handover_description && (
                    <p className="mt-2 text-sm">{stage.handover_description}</p>
                  )}
                </li>
              );
            })}
          </ol>
          {busy && (
            <p role="status" className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
              />
              {formCopy('checking')}
            </p>
          )}
          {error && <p role="alert">{copy('staffReviewError')}</p>}
          {form.formState.errors.root?.validation && (
            <p role="alert">{formCopy('validationUnavailable')}</p>
          )}
        </form>
      </Form>
      {uncertain && (
        <div role="alert" className="space-y-2">
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
              command.owner.attempted = true;
              onPending();
              notify();
            }
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
          }}
        />
      )}
    </div>
  );
}
