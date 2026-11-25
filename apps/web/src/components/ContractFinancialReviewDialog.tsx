import { useOwnedContractRead } from '../hooks/useOwnedContractRead.js';
import { useEffect, useMemo, useState } from 'react';
import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { contractText } from '@barghsa/i18n/contracts';
import { Alert, AlertDescription, Button, PageLoading } from '@barghsa/ui';
import { confirmationText } from '@barghsa/i18n/confirmation';
import { useLocale } from '../hooks/useLocale.js';
import type { useAccountTime } from '../hooks/useAccountTime.js';
import { sameContractEvidence } from '../lib/contract-review-signature-form.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractFinancialReviewSummary } from './ContractFinancialReviewSummary.js';
import { DocumentRequestError } from '../lib/documents.js';

/** The selected intent and server review stay fixed through password and network retries. */
export function ContractFinancialReviewDialog(
  props: Parameters<typeof OwnedContractFinancialReviewDialog>[0]
) {
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  return <OwnedContractFinancialReviewDialog key={JSON.stringify([actor, revision])} {...props} />;
}
function OwnedContractFinancialReviewDialog({
  action,
  profileId,
  contractId,
  time,
  onClose,
  onSuccess,
  review: capturedReview,
  onPendingChange,
  onCommandDispatch,
  onDenied,
  onUnconfirmed,
  retryReview,
  inlineAcceptance = false,
}: {
  action: TeamAction;
  review?: ContractFinancialReview;
  onPendingChange?: (pending: boolean) => void;
  onCommandDispatch?: (dispatched: boolean) => void;
  onDenied?: () => void;
  onUnconfirmed?: (command?: TeamAction) => void;
  retryReview?: { hash: string; idempotencyKey: string };
  inlineAcceptance?: boolean;
  profileId: string;
  contractId: string;
  time: ReturnType<typeof useAccountTime>;
  onClose: () => void;
  onSuccess: (result: unknown) => Promise<void | string>;
}) {
  const locale = useLocale();
  const actor = useAccountUser();
  const revision = useProfileContextRevision();
  const readContract = useOwnedContractRead(
    actor,
    revision,
    profileId,
    JSON.stringify([action.path, action.body, contractId])
  );
  const [review, setReview] = useState<ContractFinancialReview | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setReview(capturedReview ?? null);
    setError(false);
    if (capturedReview) return () => controller.abort();
    const input = action.body as Record<string, unknown>;
    const acceptance = action.path.endsWith('/accept');
    const request = action.path.endsWith('/signature-request');
    const base = action.path.slice(0, action.path.lastIndexOf('/'));
    const selection = request
      ? {
          action: 'request',
          expectedVersionId: input.expectedVersionId,
          originalDocumentId: input.originalDocumentId,
          expectedRequestId: input.expectedRequestId,
        }
      : {
          action: 'record',
          expectedVersionId: input.expectedVersionId,
          signedDocumentId: input.signedDocumentId,
          requestId: input.requestId,
        };
    void readContract<unknown>(
      acceptance
        ? `${base}/acceptance-review?versionId=${encodeURIComponent(String(input.expectedVersionId))}`
        : `${base}/signature/review`,
      {
        signal: controller.signal,
        ...(acceptance ? {} : { method: 'POST', body: JSON.stringify(selection) }),
      }
    )
      .then(async (value) => {
        if (controller.signal.aborted) return;
        const { parseContractFinancialReview } = await import('@barghsa/shared/finance');
        if (controller.signal.aborted) return;
        const parsed = parseContractFinancialReview(value);
        const expectedAction = acceptance
          ? 'contract.acceptance'
          : request
            ? 'contract.signature-request'
            : 'contract.signature-record';
        if (
          !parsed ||
          parsed.scope.action !== expectedAction ||
          parsed.scope.profileId !== profileId ||
          parsed.scope.resourceId !== contractId ||
          parsed.data.contract.versionId !== input.expectedVersionId ||
          (!acceptance &&
            (request
              ? parsed.data.signature?.originalDocument.id !== input.originalDocumentId ||
                parsed.data.signature?.requestId !== input.expectedRequestId
              : parsed.data.signature?.signedDocument?.id !== input.signedDocumentId ||
                parsed.data.signature?.requestId !== input.requestId))
        )
          throw new Error('Mismatched contract review');
        setReview(parsed);
      })
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (
          inlineAcceptance &&
          failure instanceof DocumentRequestError &&
          [401, 403, 404].includes(failure.status)
        ) {
          onDenied?.();
          return;
        }
        setError(true);
      });
    return () => controller.abort();
  }, [action, profileId, contractId, capturedReview, readContract, attempt, inlineAcceptance]);
  const confirmedAction = useMemo(
    () => ({
      ...action,
      body: {
        ...(action.body as Record<string, unknown>),
        ...(review ? { expectedReviewHash: review.hash } : {}),
        ...(retryReview && review?.hash === retryReview.hash
          ? { idempotencyKey: retryReview.idempotencyKey }
          : {}),
      },
    }),
    [action, review, retryReview]
  );
  return (
    <TeamActionDialog
      risk="financial"
      focusSummary={!inlineAcceptance}
      {...(inlineAcceptance && {
        inlineConfirmLabel: contractText('accept', locale),
        financialAcknowledgement: `${contractText('acceptAcknowledgement', locale)} ${confirmationText('acknowledge', locale)}`,
      })}
      action={confirmedAction}
      {...(onPendingChange ? { onPendingChange } : {})}
      {...(onCommandDispatch ? { onCommandDispatch } : {})}
      {...(onDenied ? { onDenied } : {})}
      {...(onUnconfirmed ? { onUnconfirmed: () => onUnconfirmed(confirmedAction) } : {})}
      confirmationDisabled={!review || time.status !== 'ready'}
      summary={
        <>
          {time.notice}
          {error ? (
            inlineAcceptance ? (
              <Alert variant="destructive">
                <AlertDescription>{contractText('financialReviewError', locale)}</AlertDescription>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  {contractText('refresh', locale)}
                </Button>
              </Alert>
            ) : (
              <p role="alert">{contractText('financialReviewError', locale)}</p>
            )
          ) : review ? (
            <ContractFinancialReviewSummary
              review={review}
              formatDate={time.format}
              standalone={inlineAcceptance}
            />
          ) : (
            <PageLoading label={contractText('loading', locale)} />
          )}
        </>
      }
      onClose={onClose}
      onSuccess={async (result) => {
        const { parseContractFinancialReview } = await import('@barghsa/shared/finance');
        const returned = parseContractFinancialReview(
          (result as { financialReview?: unknown } | null)?.financialReview
        );
        if (!review || !sameContractEvidence(returned, review))
          throw new Error('Missing confirmed contract review');
        return onSuccess(result);
      }}
    />
  );
}
