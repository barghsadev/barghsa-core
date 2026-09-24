import type { ContractFinancialReview } from '@barghsa/shared/finance';
import { FinancialReviewSummary } from '@barghsa/ui';
import { contractText } from '@barghsa/i18n/contracts';
import { tWalletInvoicePayment as invoiceText } from '@barghsa/i18n/wallet-invoice-payment';
import { useLocale } from '../hooks/useLocale.js';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { invoiceFinancialReviewRows } from './InvoiceFinancialReviewRows.js';
import { ContractTerms } from './ContractTerms.js';

export function ContractFinancialReviewSummary({
  review,
  formatDate,
}: {
  review: ContractFinancialReview;
  formatDate: (value: string) => string;
}) {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const word = (key: string) => contractText(key, locale);
  const data = review.data;
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
          {word('amendmentAcceptNotice')}
        </p>
      ) : null}
      <FinancialReviewSummary
        title={word('financialReview')}
        rows={rows}
        total={{ label: word('paymentNow'), value: numbers.money('0') }}
        notice={word('financialReviewNotice')}
      />
      <section aria-label={word('terms')}>
        <h3 className="font-semibold">{word('terms')}</h3>
        <ContractTerms value={data.contract.content} />
      </section>
      {data.initialInvoice ? (
        <FinancialReviewSummary
          title={word('initialInvoiceLinked')}
          rows={invoiceFinancialReviewRows(data.initialInvoice, locale, numbers, formatDate)}
          total={{
            label: invoiceText('remaining', locale),
            value: numbers.money(data.initialInvoice.invoice.remainingAmount),
          }}
        />
      ) : (
        <p>{word('initialInvoiceMissing')}</p>
      )}
      {data.signature
        ? [data.signature.originalDocument, data.signature.signedDocument].map((document, index) =>
            document ? (
              <section key={document.id} className="flex flex-col gap-1 break-all">
                <h3 className="font-semibold">
                  {word(index === 0 ? 'approvedOriginal' : 'approvedSigned')}
                </h3>
                <bdi>{document.originalName}</bdi>
                <span>{word('documentChecksum')}</span>
                <bdi>{document.checksum}</bdi>
              </section>
            ) : null
          )
        : null}
    </div>
  );
}
