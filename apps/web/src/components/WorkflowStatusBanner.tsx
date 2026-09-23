import { t } from '@barghsa/i18n/app';

export type WorkflowOwner = 'customer' | 'staff' | 'none';

export interface WorkflowStatusBannerProps {
  locale: 'fa' | 'en';
  status: string;
  happened: string;
  nextAction: string;
  owner: WorkflowOwner;
  actionHref?: string | null | undefined;
  supportHref?: string;
}

/** A shared customer-facing summary for any order, request, or contract. */
export function WorkflowStatusBanner({
  locale,
  status,
  happened,
  nextAction,
  owner,
  actionHref,
  supportHref = '/tickets',
}: WorkflowStatusBannerProps) {
  const safeSupportHref =
    supportHref.startsWith('/') && !supportHref.startsWith('//') ? supportHref : '/tickets';
  return (
    <section
      aria-label={t('workflow.summary', locale)}
      className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div>
        <p className="text-sm text-muted-foreground">{t('workflow.status', locale)}</p>
        <h2 className="text-xl font-semibold" dir="auto">
          {status}
        </h2>
      </div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="font-medium">{t('workflow.happened', locale)}</dt>
          <dd className="mt-1 text-muted-foreground" dir="auto">
            {happened}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('workflow.nextAction', locale)}</dt>
          <dd className="mt-1">
            {actionHref ? (
              <a
                className="font-medium text-primary underline underline-offset-4"
                href={actionHref}
              >
                {nextAction}
              </a>
            ) : (
              <span dir="auto">{nextAction}</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{t('workflow.owner', locale)}</dt>
          <dd className="mt-1">{t(`workflow.owner.${owner}`, locale)}</dd>
        </div>
        <div>
          <dt className="font-medium">{t('workflow.help', locale)}</dt>
          <dd className="mt-1">
            <a className="text-primary underline underline-offset-4" href={safeSupportHref}>
              {t('workflow.support', locale)}
            </a>
          </dd>
        </div>
      </dl>
    </section>
  );
}
