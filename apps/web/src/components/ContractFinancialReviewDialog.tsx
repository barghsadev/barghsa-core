import { useEffect, useState } from 'react';
import {
  parseContractFinancialReview,
  type ContractFinancialReview,
} from '@barghsa/shared/finance';
import { contractText } from '@barghsa/i18n/contracts';
import { PageLoading } from '@barghsa/ui';
import { useLocale } from '../hooks/useLocale.js';
import type { useAccountTime } from '../hooks/useAccountTime.js';
import { documentRequest } from '../lib/documents.js';
import { TeamActionDialog, type TeamAction } from './TeamActionDialog.js';
import { ContractFinancialReviewSummary } from './ContractFinancialReviewSummary.js';

/** The selected intent and server review stay fixed through password and network retries. */
export function ContractFinancialReviewDialog({
  action,
  profileId,
  contractId,
  time,
  onClose,
  onSuccess,
}: {
  action: TeamAction;
  profileId: string;
  contractId: string;
  time: ReturnType<typeof useAccountTime>;
  onClose: () => void;
  onSuccess: (result: unknown) => Promise<void>;
}) {
  const locale = useLocale();
  const [review, setReview] = useState<ContractFinancialReview | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setReview(null);
    setError(false);
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
    void documentRequest<unknown>(
      acceptance
        ? `${base}/acceptance-review?versionId=${encodeURIComponent(String(input.expectedVersionId))}`
        : `${base}/signature/review`,
      {
        signal: controller.signal,
        ...(acceptance ? {} : { method: 'POST', body: JSON.stringify(selection) }),
      }
    )
      .then((value) => {
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
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [action, profileId, contractId]);
  return (
    <TeamActionDialog
      action={{
        ...action,
        body: {
          ...(action.body as Record<string, unknown>),
          ...(review ? { expectedReviewHash: review.hash } : {}),
        },
      }}
      confirmationDisabled={!review || time.status !== 'ready'}
      summary={
        <>
          {time.notice}
          {error ? (
            <p role="alert">{contractText('financialReviewError', locale)}</p>
          ) : review ? (
            <ContractFinancialReviewSummary review={review} formatDate={time.format} />
          ) : (
            <PageLoading label={contractText('loading', locale)} />
          )}
        </>
      }
      onClose={onClose}
      onSuccess={async (result) => {
        const returned = parseContractFinancialReview(
          (result as { financialReview?: unknown } | null)?.financialReview
        );
        if (!review || returned?.hash !== review.hash)
          throw new Error('Missing confirmed contract review');
        await onSuccess(result);
      }}
    />
  );
}
