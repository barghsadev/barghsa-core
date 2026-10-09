import { useRef, type FormEvent } from 'react';
import { z } from 'zod/mini';
import { APPROVAL_REVIEW_REASON_MAX_LENGTH } from '@barghsa/shared/finance';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { Button, Label } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import { useWizardForm as useDraftForm } from '../hooks/useWizardForm.js';
import { useActionFieldErrors } from '../hooks/useActionFieldErrors.js';

export interface ApprovalDecisionDraft {
  applyServerErrors: (fields: unknown[]) => boolean;
  clear: () => void;
  focus: HTMLElement | null;
}

export function ApprovalDecisionForm({
  requestId,
  initialReason,
  disabled,
  draftDisabled = disabled,
  pending,
  onChange,
  validate,
  decide,
}: {
  requestId: string;
  initialReason: string;
  disabled: boolean;
  draftDisabled?: boolean;
  pending?: 'approve' | 'reject';
  onChange: (reason: string) => void;
  validate: (run: (generation: number) => Promise<void>) => Promise<void>;
  decide: (
    decision: 'approve' | 'reject',
    draft: ApprovalDecisionDraft,
    reason?: string,
    generation?: number
  ) => void;
}) {
  const locale = useLocale();
  const message = t('admin.approvals.invalidReason', locale);
  const draft = useDraftForm<{ reason: string }>(
    z.object({
      reason: z
        .string()
        .check(
          z.refine(
            (reason) =>
              reason.trim().length > 0 && reason.trim().length <= APPROVAL_REVIEW_REASON_MAX_LENGTH,
            message
          )
        ),
    }),
    { reason: initialReason }
  );
  const [reason, setReason] = draft.field('reason');
  const applyServerErrors = useActionFieldErrors(draft.form, { reason: message }, message);
  const reasonElement = useRef<HTMLTextAreaElement | null>(null);
  const binding = draft.bind('reason');
  const busy = disabled || draft.form.formState.isSubmitting;
  function access(focus: HTMLElement | null): ApprovalDecisionDraft {
    return { applyServerErrors, clear: () => draft.form.reset({ reason: '' }), focus };
  }
  function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || draft.form.isSubmissionPending()) return;
    void validate((generation) =>
      draft.form.handleSubmit(({ reason }) =>
        decide('reject', access(reasonElement.current), reason.trim(), generation)
      )(event)
    );
  }
  const spinner = (
    <span
      aria-hidden="true"
      className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
    />
  );
  return (
    <form
      onSubmit={reject}
      noValidate
      className="space-y-2"
      aria-busy={Boolean(pending || draft.form.formState.isSubmitting) || undefined}
    >
      <Label htmlFor={`reason-${requestId}`}>{t('admin.approvals.rejectReason', locale)}</Label>
      <textarea
        id={`reason-${requestId}`}
        {...binding}
        ref={(element) => {
          reasonElement.current = element;
          binding.ref(element);
        }}
        aria-required="true"
        required
        rows={3}
        maxLength={APPROVAL_REVIEW_REASON_MAX_LENGTH}
        className="block w-full rounded border bg-background p-2 text-foreground"
        disabled={draftDisabled || draft.form.formState.isSubmitting}
        value={reason}
        onChange={(event) => {
          setReason(event.target.value);
          onChange(event.target.value);
        }}
      />
      <p
        id={draft.errorId('reason')}
        role={draft.errors.reason ? 'alert' : undefined}
        aria-hidden={!draft.errors.reason || undefined}
        className={`text-sm text-destructive${draft.errors.reason ? '' : ' invisible'}`}
      >
        {draft.errors.reason?.message ?? message}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={busy}
          aria-busy={pending === 'approve' || undefined}
          onClick={(event) => decide('approve', access(event.currentTarget))}
        >
          {pending === 'approve' && spinner}
          {t('admin.approvals.approve', locale)}
        </Button>
        <Button
          type="submit"
          variant="outline"
          disabled={busy}
          aria-busy={pending === 'reject' || draft.form.formState.isSubmitting || undefined}
        >
          {(pending === 'reject' || draft.form.formState.isSubmitting) && spinner}
          {t('admin.approvals.reject', locale)}
        </Button>
      </div>
    </form>
  );
}
