import { Button } from '@barghsa/ui';
import { t } from '@barghsa/i18n/app';
import { tSaving } from '@barghsa/i18n/saving';
import { useLocale } from '../hooks/useLocale.js';
import type { SavingQuote } from '../pages/SavingsOrderPage.js';
import { SavingReviewPrice } from './SavingReviewPrice.js';
import { StepReviewPage, type ReviewSection } from './StepReviewPage.js';

interface Props {
  quote: SavingQuote | null;
  quoting: boolean;
  quoteError: boolean;
  retryQuote: () => void;
  plan: Pick<SavingQuote['plan'], 'title'> | undefined;
  hardware: Pick<SavingQuote['hardware'], 'title'> | undefined;
  billIdentifier: string;
  address: { fullAddress: string; postalCode: string } | undefined;
  appliedGiftCode: string;
  onEdit: (step: number) => void;
  editDisabled: boolean;
}

export default function SavingsOrderReview({
  quote,
  quoting,
  quoteError,
  retryQuote,
  plan,
  hardware,
  billIdentifier,
  address,
  appliedGiftCode,
  onEdit,
  editDisabled,
}: Props) {
  const locale = useLocale();
  const copy = (key: string) => tSaving(key, locale);
  const productTitle = (product: Props['plan']) =>
    product?.title[locale] || product?.title.en || product?.title.fa;
  const subtitleStyle = 'text-sm font-medium whitespace-pre-wrap wrap-anywhere';
  const fullAddress = quote?.address.full_address ?? address?.fullAddress;
  const postalCode = quote?.address.postal_code ?? address?.postalCode;
  const sections: ReviewSection[] = [
    {
      id: 'price',
      title: t('electricity.order.step3', locale),
      content: quote ? (
        <SavingReviewPrice quote={quote} />
      ) : quoteError ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-destructive/5 px-4 py-2 text-sm"
        >
          <p>{copy('quoteError')}</p>
          <Button type="button" variant="outline" onClick={retryQuote}>
            {copy('retry')}
          </Button>
        </div>
      ) : quoting ? (
        <p role="status" className="text-sm text-muted-foreground">
          {copy('loading')}
        </p>
      ) : null,
    },
    {
      id: 'plan',
      title: copy('stepPlan'),
      step: 1,
      content: (
        <p className={subtitleStyle} dir="auto">
          {productTitle(quote?.plan ?? plan) || '—'}
        </p>
      ),
    },
    {
      id: 'hardware',
      title: copy('stepHardware'),
      step: 1,
      content: (
        <p className={subtitleStyle} dir="auto">
          {productTitle(quote?.hardware ?? hardware) || '—'}
        </p>
      ),
    },
    {
      id: 'bill',
      title: copy('stepBill'),
      step: 2,
      content: (
        <p className="text-sm font-medium tabular-nums">
          <bdi dir="ltr">{(quote?.billIdentifier ?? billIdentifier) || '—'}</bdi>
        </p>
      ),
    },
    {
      id: 'address',
      title: copy('stepAddress'),
      step: 2,
      content: (
        <div className="space-y-1 text-sm">
          <p className={subtitleStyle} dir="auto">
            {fullAddress || '—'}
          </p>
          {postalCode && (
            <dl className="flex flex-wrap gap-x-2">
              <dt className="text-muted-foreground">{t('electricity.order.postalCode', locale)}</dt>
              <dd className="tabular-nums">
                <bdi dir="ltr">{postalCode}</bdi>
              </dd>
            </dl>
          )}
        </div>
      ),
    },
    ...(appliedGiftCode
      ? [
          {
            id: 'gift',
            title: copy('giftCode'),
            content: (
              <p className={subtitleStyle}>
                <bdi>{appliedGiftCode}</bdi>
              </p>
            ),
          },
        ]
      : []),
    ...(quote
      ? [
          {
            id: 'agreement',
            title: copy('stepAgreement'),
            content: (
              <div className="space-y-2 text-sm">
                <p dir="auto" className="font-medium wrap-anywhere">
                  {quote.agreement.title}
                </p>
                <p
                  dir="auto"
                  className="max-h-80 overflow-y-auto whitespace-break-spaces wrap-anywhere rounded-md bg-muted/30 p-4"
                >
                  {quote.agreement.body}
                </p>
              </div>
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="min-[375px]:[&>section]:grid min-[375px]:[&>section]:grid-cols-2 min-[375px]:[&>section]:gap-3 min-[375px]:[&>section]:space-y-0 min-[375px]:[&>section>div]:col-span-full lg:[&>section]:grid-cols-4 [&_[data-review-section=price]]:col-span-full [&_[data-review-section=price]]:bg-card lg:[&_[data-review-section=price]]:col-span-2 lg:[&_[data-review-section=price]]:row-span-2 lg:[&_[data-review-section=price]]:self-start [&_[data-review-section=address]]:max-sm:col-span-full [&_[data-review-section=bill]]:max-sm:col-span-full [&_[data-review-section=gift]]:col-span-full [&_[data-review-section=agreement]]:col-span-full">
      <StepReviewPage
        compact
        title={copy('stepReview')}
        editLabel={t('electricity.order.edit', locale)}
        disabled={editDisabled}
        onEdit={onEdit}
        sections={sections}
      />
    </div>
  );
}
