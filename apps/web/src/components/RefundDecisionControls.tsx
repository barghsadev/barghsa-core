import { useEffect } from 'react';
import { contractText } from '@barghsa/i18n/contracts';
import { refundEditorMessages } from '@barghsa/i18n/refund-editor';
import { Button, Field, FieldLabel, Input, Textarea } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import {
  useRefundDecisionForm,
  type RefundDecisionValues,
  type RefundOperation,
} from '../hooks/useRefundForm.js';
import { RefundFieldFeedback, RefundFormAlert } from './RefundFormFeedback.js';
import { refundOperations } from '../lib/invoice-refund-route.js';
import { RecordEditorActions, recordEditorGrid } from './RecordEditorLayout.js';

export type RefundDecisionDraft = ReturnType<typeof useRefundDecisionForm>;
export function RefundDecisionControls({
  row,
  prefix,
  word,
  disabled,
  onChoose,
  initial,
  saveDraft,
  referenceOnly = false,
  operation,
}: {
  row: {
    id: string;
    destination: 'wallet' | 'external_bank';
    state: string;
    bankReference: string | null;
  };
  prefix: string;
  word: (key: string) => string;
  disabled: boolean;
  onChoose: (operation: RefundOperation, draft: RefundDecisionDraft) => void;
  initial: RefundDecisionValues;
  saveDraft: (values: RefundDecisionValues) => void;
  referenceOnly?: boolean;
  operation?: RefundOperation;
}) {
  const locale = useLocale();
  const editorText = refundEditorMessages[locale];
  const draft = useRefundDecisionForm(row.bankReference, initial, referenceOnly);
  const [reason, setReason] = draft.field('reason');
  const [reference, setReference] = draft.field('bankReference');
  useEffect(() => saveDraft({ reason, bankReference: reference }), [reason, reference]);
  const reasonVisible = operation
    ? operation === 'reject' || operation === 'cancel'
    : !referenceOnly && ['Requested', 'Approved'].includes(row.state);
  const referenceVisible = operation
    ? operation === 'record-transfer' || operation === 'reconcile'
    : row.destination === 'external_bank' &&
      (row.state === 'Approved' || (!referenceOnly && row.state === 'Processing'));
  const operations: RefundOperation[] = operation
    ? [operation]
    : referenceOnly
      ? row.destination === 'wallet'
        ? ['process']
        : row.state === 'Approved'
          ? ['record-transfer']
          : ['reconcile']
      : refundOperations(row);
  const choose = (operation: RefundOperation) => {
    if (!disabled && !draft.form.isSubmissionPending()) onChoose(operation, draft);
  };
  const bankId = referenceOnly ? 'bank-return-' + row.id : 'refund-bank-reference-' + row.id;
  const reasonId = prefix + '-reason-' + row.id;
  const reasonField = draft.bind('reason');
  const bankField = draft.bind('bankReference');
  const recordedReference = operation === 'reconcile' ? row.bankReference : null;
  const ReasonInput = operation ? Textarea : Input;
  const buttons = operations.map((choice) => (
    <Button
      key={choice}
      type={operation ? 'submit' : 'button'}
      variant={
        choice === 'reject' || choice === 'cancel'
          ? 'destructive'
          : operation
            ? 'default'
            : 'outline'
      }
      disabled={disabled}
      onClick={operation ? undefined : () => choose(choice)}
      data-refund-decision-submit={operation || undefined}
    >
      {draft.form.formState.isSubmitting && draft.operation.current === choice && (
        <span
          aria-hidden="true"
          className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {word(choice)}
    </Button>
  ));
  if (!operations.length) return null;
  return (
    <form
      noValidate
      className={operation ? undefined : 'space-y-3'}
      aria-busy={draft.form.formState.isSubmitting || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (operations[0]) choose(operations[0]);
      }}
    >
      <div className={operation ? 'space-y-2.5 px-4 py-4 sm:px-6' : 'space-y-2'}>
        {operation === 'reconcile' && (
          <p id={bankId + '-help'} className="text-sm text-muted-foreground">
            {word('secondReviewer')}
          </p>
        )}
        <div className={reasonVisible && referenceVisible ? recordEditorGrid : 'space-y-2'}>
          {reasonVisible && (
            <Field className="min-w-0 gap-1">
              <FieldLabel htmlFor={reasonId}>
                {operation === 'reject'
                  ? editorText.rejectionReason
                  : operation === 'cancel'
                    ? editorText.cancellationReason
                    : word('decisionReason')}
              </FieldLabel>
              {operation && (
                <p id={reasonId + '-help'} className="text-sm text-muted-foreground">
                  {editorText.decisionReasonHelp}
                </p>
              )}
              <ReasonInput
                id={reasonId}
                dir={operation ? 'auto' : undefined}
                rows={operation ? 2 : undefined}
                className={operation ? 'min-h-12' : undefined}
                maxLength={1000}
                value={reason}
                {...reasonField}
                aria-describedby={
                  operation
                    ? [reasonId + '-help', reasonField['aria-describedby']]
                        .filter(Boolean)
                        .join(' ')
                    : reasonField['aria-describedby']
                }
                disabled={disabled}
                onChange={(event) => setReason(event.target.value)}
              />
              <RefundFieldFeedback
                id={draft.errorId('reason')}
                error={draft.errors.reason}
                message={contractText('cancellationReasonInvalid', locale)}
                reserveSpace={!operation}
              />
            </Field>
          )}
          {referenceVisible && (
            <div className={recordedReference ? recordEditorGrid : undefined}>
              <Field className="min-w-0 gap-1">
                <FieldLabel htmlFor={bankId}>
                  {operation === 'reconcile'
                    ? editorText.reconcileReference
                    : word('bankReference')}
                </FieldLabel>
                {operation === 'record-transfer' && (
                  <p id={bankId + '-help'} className="text-sm text-muted-foreground">
                    {editorText.recordTransferHelp}
                  </p>
                )}
                <Input
                  id={bankId}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  required={!!operation}
                  maxLength={200}
                  value={reference}
                  {...bankField}
                  aria-describedby={
                    operation
                      ? [bankId + '-help', bankField['aria-describedby']].filter(Boolean).join(' ')
                      : bankField['aria-describedby']
                  }
                  disabled={disabled}
                  onChange={(event) => setReference(event.target.value)}
                />
                <RefundFieldFeedback
                  id={draft.errorId('bankReference')}
                  error={draft.errors.bankReference}
                  message={contractText('refundBankReferenceInvalid', locale)}
                  reserveSpace={!operation}
                />
                {!operation && row.state === 'Processing' && (
                  <p className="text-sm text-muted-foreground">{word('secondReviewer')}</p>
                )}
              </Field>
              {recordedReference && (
                <dl className="min-w-0 space-y-1">
                  <dt className="text-sm font-medium text-muted-foreground">
                    {word('recordedReference')}
                  </dt>
                  <dd
                    dir="auto"
                    className="flex min-h-11 items-center rounded-lg bg-muted/50 px-3 py-2 font-mono text-sm [overflow-wrap:anywhere]"
                  >
                    {recordedReference}
                  </dd>
                </dl>
              )}
            </div>
          )}
          {operation && !reasonVisible && !referenceVisible && (
            <p className="text-sm text-muted-foreground">{editorText.reviewDecisionHelp}</p>
          )}
        </div>
        {!referenceVisible && draft.errors.bankReference && (
          <RefundFormAlert message={draft.errors.bankReference.message} />
        )}
        <RefundFormAlert message={draft.errors.root?.validation?.message} />
      </div>
      {operation ? (
        <RecordEditorActions>{buttons}</RecordEditorActions>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">{buttons}</div>
      )}
    </form>
  );
}
