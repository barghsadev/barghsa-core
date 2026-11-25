import { t } from '@barghsa/i18n/app';
import { tSolar } from '@barghsa/i18n/solar';
import { solarIntakeText } from '@barghsa/i18n/solar-intake';
import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import type { SolarReview } from '../pages/SolarRequestPage.js';
import { StepReviewPage } from './StepReviewPage.js';

export function SolarRequestReview({
  data,
  completionDate,
  editDisabled,
  onEdit,
}: {
  data: SolarReview['data'];
  completionDate: ReactNode;
  editDisabled: boolean;
  onEdit: (step: number) => void;
}) {
  const locale = useLocale();
  const copy = (key: string) => tSolar(key, locale);
  const property = data.submission;
  const propertyRows = [
    {
      label: copy('building'),
      value: copy(property.buildingType === 'non_household' ? 'nonHousehold' : 'building'),
    },
    ...['propertyForm', 'structuralFrame', 'siteCategory', 'installationSurface'].flatMap((key) =>
      property[key] ? [{ label: copy(key), value: copy(String(property[key])) }] : []
    ),
    ...(completionDate ? [{ label: copy('completionDate'), value: completionDate }] : []),
    ...(property.totalUnits
      ? [{ label: copy('totalUnits'), value: String(property.totalUnits) }]
      : []),
    ...(property.usableAreaSqm
      ? [{ label: copy('usableArea'), value: String(property.usableAreaSqm) }]
      : []),
    ...(property.siteRelationship
      ? [
          {
            label: copy('relationship'),
            value: copy(
              property.siteRelationship === 'authorized_operator'
                ? 'authorizedOperator'
                : String(property.siteRelationship)
            ),
          },
        ]
      : []),
  ];
  return (
    <div className="lg:[&>section]:grid lg:[&>section]:grid-cols-2 lg:[&>section]:items-start lg:[&>section]:gap-3 lg:[&>section]:space-y-0 [&>section>div]:col-span-full [&>section>div>p]:rounded-lg [&>section>div>p]:border [&>section>div>p]:bg-primary/5 [&>section>div>p]:px-3 [&>section>div>p]:py-2 [&>section>div>p]:text-foreground [&_[data-review-section=agreement]]:col-span-full">
      <StepReviewPage
        compact
        title={copy('reviewTitle')}
        description={copy('reviewNoContractInvoice')}
        editLabel={t('electricity.order.edit', locale)}
        disabled={editDisabled}
        onEdit={onEdit}
        sections={[
          {
            id: 'property',
            title: copy('address'),
            step: 1,
            content: (
              <>
                <p dir="auto" className="text-sm font-semibold wrap-anywhere">
                  {data.siteAddress}
                </p>
                <dl className="flex flex-wrap gap-x-2 text-sm">
                  <dt className="text-muted-foreground">
                    {t('electricity.order.postalCode', locale)}
                  </dt>
                  <dd className="tabular-nums">
                    <bdi dir="ltr">{data.siteAddressSnapshot.postal_code}</bdi>
                  </dd>
                </dl>
                <details className="group border-t">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md px-1 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    {copy('wizardProperty')}
                    <ChevronDownIcon
                      aria-hidden="true"
                      className="size-4 shrink-0 group-open:rotate-180 motion-safe:transition-transform"
                    />
                  </summary>
                  <dl className="grid gap-x-4 gap-y-3 px-1 pb-2 text-sm min-[375px]:grid-cols-2">
                    {propertyRows.map(({ label, value }) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="mt-1 font-medium wrap-anywhere">
                          <bdi>{value}</bdi>
                        </dd>
                      </div>
                    ))}
                    {property.siteDescription && (
                      <div className="col-span-full min-w-0">
                        <dt className="text-muted-foreground">{copy('description')}</dt>
                        <dd dir="auto" className="mt-1 whitespace-pre-wrap wrap-anywhere">
                          {String(property.siteDescription)}
                        </dd>
                      </div>
                    )}
                  </dl>
                </details>
              </>
            ),
          },
          {
            id: 'grid',
            title: copy('gridType'),
            step: 2,
            content: (
              <div className="space-y-2 text-sm">
                <p className="font-semibold">
                  {copy(property.gridType === 'off_grid' ? 'offGrid' : 'onGrid')}
                </p>
                {property.billIdentifier && (
                  <dl className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">{copy('billIdentifier')}</dt>
                    <dd className="tabular-nums">
                      <bdi dir="ltr">{String(property.billIdentifier)}</bdi>
                    </dd>
                  </dl>
                )}
              </div>
            ),
          },
          {
            id: 'agreement',
            title: solarIntakeText('acceptedTerms', locale),
            step: 2,
            content: (
              <div className="space-y-2 text-sm">
                <p lang="fa" dir="rtl" className="whitespace-pre-wrap wrap-anywhere">
                  {data.agreementText}
                </p>
                <dl className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">{copy('reviewTermsVersion')}</dt>
                  <dd className="min-w-0 wrap-anywhere">
                    <bdi>{data.agreementVersion}</bdi>
                  </dd>
                </dl>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
