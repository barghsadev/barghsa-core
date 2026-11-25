import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { z } from 'zod/mini';
import { APPROVAL_REVIEW_REASON_MAX_LENGTH } from '@barghsa/shared/finance';
import { tWorkspace as t } from '@barghsa/i18n/workspace-admin';
import { Button, Label, Textarea } from '@barghsa/ui';
import { RecordEditorActions, recordEditorSurface } from './RecordEditorLayout.js';
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
  rejectionRoute,
  onChange,
  validate,
  decide,
}: {
  requestId: string;
  initialReason: string;
  disabled: boolean;
  draftDisabled?: boolean;
  pending?: 'approve' | 'reject';
  rejectionRoute?: { active: boolean; link: ReactNode } | undefined;
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
  const label = (key: string) => t(`admin.approvals.${key}`, locale);
  const message = label('invalidReason');
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
  const [inlineRejection, setInlineRejection] = useState(Boolean(initialReason));
  const rejecting = rejectionRoute?.active ?? inlineRejection;
  const reasonElement = useRef<HTMLTextAreaElement | null>(null);
  const rejectTrigger = useRef<HTMLButtonElement>(null);
  const moveFocus = useRef(false);
  const binding = draft.bind('reason');
  const busy = disabled || draft.form.formState.isSubmitting;
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const target = rejecting ? reasonElement.current : rejectTrigger.current;
    target?.focus();
  }, [rejecting]);
  function showRejection(visible: boolean) {
    moveFocus.current = true;
    setInlineRejection(visible);
  }
  function access(focus: HTMLElement | null): ApprovalDecisionDraft {
    return { applyServerErrors, clear: () => draft.form.reset({ reason: '' }), focus };
  }
  function reject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rejecting || busy || draft.form.isSubmissionPending()) return;
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
      id={`decision-${requestId}`}
      onSubmit={reject}
      noValidate
      className={recordEditorSurface}
      aria-label={label('staffDecision')}
      aria-busy={Boolean(pending || draft.form.formState.isSubmitting) || undefined}
    >
      <div className="space-y-1 px-4 py-3">
        <h3 className="text-base font-semibold">
          {label(
            rejecting ? (rejectionRoute ? 'rejectionNote' : 'rejectRequest') : 'staffDecision'
          )}
        </h3>
        {rejecting ? (
          <div className="max-w-prose space-y-1.5 pt-1">
            {rejectionRoute && (
              <p className="text-sm text-muted-foreground">{label('rejectionHelp')}</p>
            )}
            <Label htmlFor={`reason-${requestId}`}>{label('rejectReason')}</Label>
            <Textarea
              id={`reason-${requestId}`}
              {...binding}
              ref={(element) => {
                reasonElement.current = element;
                binding.ref(element);
              }}
              aria-required="true"
              required
              rows={2}
              dir="auto"
              maxLength={APPROVAL_REVIEW_REASON_MAX_LENGTH}
              className="min-h-14 resize-y"
              placeholder={label('rejectExample')}
              disabled={draftDisabled || draft.form.formState.isSubmitting}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                onChange(event.target.value);
              }}
            />
            <div className="min-h-5">
              <p
                id={draft.errorId('reason')}
                role={draft.errors.reason ? 'alert' : undefined}
                aria-hidden={!draft.errors.reason || undefined}
                className="text-sm text-destructive"
                hidden={!draft.errors.reason}
              >
                {draft.errors.reason?.message ?? message}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{label('decisionHelp')}</p>
        )}
      </div>
      <RecordEditorActions>
        {rejecting ? (
          <>
            {rejectionRoute?.link ?? (
              <Button
                type="button"
                variant="ghost"
                disabled={draftDisabled || draft.form.formState.isSubmitting}
                onClick={() => showRejection(false)}
              >
                {label('cancelRejection')}
              </Button>
            )}
            <Button
              type="submit"
              disabled={busy}
              aria-busy={pending === 'reject' || draft.form.formState.isSubmitting || undefined}
            >
              {(pending === 'reject' || draft.form.formState.isSubmitting) && spinner}
              {label('reject')}
            </Button>
          </>
        ) : (
          <>
            {rejectionRoute?.link ?? (
              <Button
                type="button"
                variant="outline"
                ref={rejectTrigger}
                disabled={busy}
                onClick={() => showRejection(true)}
              >
                {label('reject')}
              </Button>
            )}
            <Button
              type="button"
              disabled={busy}
              aria-busy={pending === 'approve' || undefined}
              onClick={(event) => decide('approve', access(event.currentTarget))}
            >
              {pending === 'approve' && spinner}
              {label('approve')}
            </Button>
          </>
        )}
      </RecordEditorActions>
    </form>
  );
}
