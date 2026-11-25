import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { FinancialReviewSummary } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { tInvoiceFinancialReview as invoiceText } from '@barghsa/i18n/invoice-financial-review';
import { useLocale } from '../hooks/useLocale.js';
import { useFinancialFormatting } from '../hooks/useFinancialFormatting.js';
import { invoiceFinancialReviewRows } from './InvoiceFinancialReviewRows.js';
import { ContractTerms } from './ContractTerms.js';

export function ContractFinancialReviewSummary({
  review,
  formatDate,
  standalone = false,
}: {
  review: ContractFinancialReview;
  formatDate: (value: string) => string;
  standalone?: boolean;
}) {
  const locale = useLocale();
  const numbers = useFinancialFormatting(locale);
  const word = (key: string) => contractText(key, locale);
  const data = review.data;
  const Heading = standalone ? 'h2' : 'h3';
  const date = (value: string | null) => (value === null ? word('noValue') : formatDate(value));
  const rows = [
    { id: 'profile', label: word('draftProfile'), value: data.profile.title || data.profile.id },
    { id: 'version', label: word('version'), value: numbers.number(data.contract.versionNumber) },
    { id: 'published', label: word('publishedAt'), value: formatDate(data.contract.publishedAt) },
    ...(['signatureRequired', 'paymentRequired', 'serviceStartRequired'] as const).map((key) => ({
      id: key,
      label: word(`rule.${key}`),
      value: word(data.activation[key] ? 'yes' : 'no'),
    })),
    {
      id: 'start',
      label: word('prerequisite.serviceStart'),
      value: date(data.activation.serviceStartsAt),
    },
    { id: 'end', label: word('serviceEndsAt'), value: date(data.activation.serviceEndsAt) },
    {
      id: 'refund',
      label: word('cancellationTitle'),
      value: invoiceText(
        data.cancellationRefund === 'full_wallet' ? 'fullWalletRefund' : 'staffRefund',
        locale
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {data.contract.amendment ? (
        <p role="status" className="text-sm text-muted-foreground">
          {word(
            review.scope.action === 'contract.acceptance'
              ? data.activation.signatureRequired
                ? 'amendmentAcceptForSignatureNotice'
                : 'amendmentAcceptNotice'
              : 'amendmentSignatureNotice'
          )}
        </p>
      ) : null}
      {data.signature && (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {[data.signature.originalDocument, data.signature.signedDocument].map(
            (document, index) =>
              document ? (
                <section
                  key={document.id}
                  className="flex min-w-0 flex-col gap-2 rounded-lg border bg-muted/25 px-3 py-2.5 only:col-span-full"
                >
                  <h3 className="text-sm font-medium">
                    {word(index === 0 ? 'approvedOriginal' : 'approvedSigned')}
                  </h3>
                  <p className="text-sm wrap-anywhere">
                    <bdi>{document.originalName}</bdi>
                  </p>
                  <dl>
                    <dt className="text-xs text-muted-foreground">{word('documentChecksum')}</dt>
                    <dd dir="ltr" className="font-mono text-xs wrap-anywhere">
                      {document.checksum}
                    </dd>
                  </dl>
                </section>
              ) : null
          )}
        </div>
      )}
      <FinancialReviewSummary
        title={word('financialReview')}
        heading={Heading}
        compact={standalone}
        totalFirst={standalone}
        rows={rows}
        total={{ label: word('paymentNow'), value: numbers.reviewMoney('0') }}
        notice={word('financialReviewNotice')}
      />
      <section aria-label={word('terms')}>
        <Heading className="font-semibold">{word('terms')}</Heading>
        <ContractTerms value={data.contract.content} />
      </section>
      {data.initialInvoice ? (
        <FinancialReviewSummary
          title={word('initialInvoiceLinked')}
          heading={Heading}
          compact={standalone}
          rows={invoiceFinancialReviewRows(data.initialInvoice, locale, numbers, formatDate)}
          total={{
            label: invoiceText('remaining', locale),
            value: numbers.reviewMoney(data.initialInvoice.invoice.remainingAmount),
          }}
        />
      ) : (
        <p>{word('initialInvoiceMissing')}</p>
      )}
    </div>
  );
}
