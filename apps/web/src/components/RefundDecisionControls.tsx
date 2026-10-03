import { useEffect } from 'react';
import { contractText } from '@barghsa/i18n/contracts';
import { Button, Field, FieldLabel, Input } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import {
  useRefundDecisionForm,
  type RefundDecisionValues,
  type RefundOperation,
} from '../hooks/useRefundForm.js';
import { RefundFieldFeedback, RefundFormAlert } from './RefundFormFeedback.js';

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
}) {
  const locale = useLocale();
  const draft = useRefundDecisionForm(row.bankReference, initial, referenceOnly);
  const [reason, setReason] = draft.field('reason');
  const [reference, setReference] = draft.field('bankReference');
  useEffect(() => saveDraft({ reason, bankReference: reference }), [reason, reference]);
  const reasonVisible = !referenceOnly && ['Requested', 'Approved'].includes(row.state);
  const referenceVisible =
    row.destination === 'external_bank' &&
    (row.state === 'Approved' || (!referenceOnly && row.state === 'Processing'));
  const operations: RefundOperation[] = referenceOnly
    ? row.destination === 'wallet'
      ? ['process']
      : row.state === 'Approved'
        ? ['record-transfer']
        : ['reconcile']
    : row.state === 'Requested'
      ? ['approve', 'reject', 'cancel']
      : row.state === 'Approved'
        ? ['cancel', row.destination === 'wallet' ? 'process' : 'record-transfer']
        : row.state === 'Processing' && row.destination === 'external_bank'
          ? ['reconcile']
          : row.state === 'Failed' && row.destination === 'wallet'
            ? ['process']
            : [];
  const choose = (operation: RefundOperation) => {
    if (!disabled && !draft.form.isSubmissionPending()) onChoose(operation, draft);
  };
  const bankId = referenceOnly ? 'bank-return-' + row.id : 'refund-bank-reference-' + row.id;
  return (
    <form
      noValidate
      className="space-y-3"
      aria-busy={draft.form.formState.isSubmitting || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (operations[0]) choose(operations[0]);
      }}
    >
      {reasonVisible && (
        <Field>
          <FieldLabel htmlFor={prefix + '-reason-' + row.id}>{word('decisionReason')}</FieldLabel>
          <Input
            id={prefix + '-reason-' + row.id}
            maxLength={1000}
            value={reason}
            {...draft.bind('reason')}
            disabled={disabled}
            onChange={(event) => setReason(event.target.value)}
          />
          <RefundFieldFeedback
            id={draft.errorId('reason')}
            error={draft.errors.reason}
            message={contractText('cancellationReasonInvalid', locale)}
          />
        </Field>
      )}
      {referenceVisible && (
        <Field>
          <FieldLabel htmlFor={bankId}>{word('bankReference')}</FieldLabel>
          <Input
            id={bankId}
            dir="ltr"
            maxLength={200}
            value={reference}
            {...draft.bind('bankReference')}
            disabled={disabled}
            onChange={(event) => setReference(event.target.value)}
          />
          <RefundFieldFeedback
            id={draft.errorId('bankReference')}
            error={draft.errors.bankReference}
            message={contractText('refundBankReferenceInvalid', locale)}
          />
          {row.state === 'Processing' && (
            <p className="text-sm text-muted-foreground">{word('secondReviewer')}</p>
          )}
        </Field>
      )}
      {!referenceVisible && draft.errors.bankReference && (
        <RefundFormAlert message={draft.errors.bankReference.message} />
      )}
      <RefundFormAlert message={draft.errors.root?.validation?.message} />
      <div className="flex flex-wrap gap-2">
        {operations.map((operation) => (
          <Button
            key={operation}
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() => choose(operation)}
          >
            {draft.form.formState.isSubmitting && draft.operation.current === operation && (
              <span
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
              />
            )}
            {word(operation)}
          </Button>
        ))}
      </div>
    </form>
  );
}
