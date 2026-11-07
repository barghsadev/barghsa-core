import { t } from '@barghsa/i18n/workspace';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { WaitingForBarghsa } from '@barghsa/ui';
import { workflowFeedback } from '@barghsa/i18n/workflow-feedback';

export type WorkflowOwner = 'customer' | 'staff' | 'none';

export interface WorkflowStatusBannerProps {
  locale: 'fa' | 'en';
  status: string;
  happened: string;
  nextAction: string;
  owner: WorkflowOwner;
  actionHref?: string | null | undefined;
  supportHref?: string;
  submittedAt?: ReactNode;
  expectedResponse?: ReactNode;
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
  submittedAt,
  expectedResponse,
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
      {owner === 'staff' ? (
        <WaitingForBarghsa
          title={workflowFeedback('waiting', locale)}
          description={`${t('workflow.owner', locale)}: ${t('workflow.owner.staff', locale)}`}
          submittedAt={submittedAt ?? workflowFeedback('submissionUnknown', locale)}
          update={
            <p>
              {t('workflow.happened', locale)}: {happened}
            </p>
          }
          expectedResponse={expectedResponse ?? workflowFeedback('responseUnknown', locale)}
          help={
            <div className="flex flex-wrap gap-3">
              <span>{t('workflow.nextAction', locale)}:</span>
              {actionHref ? (
                actionHref.startsWith('#') ? (
                  <a href={actionHref} className="underline">
                    {nextAction}
                  </a>
                ) : (
                  <Link to={actionHref} className="underline">
                    {nextAction}
                  </Link>
                )
              ) : (
                <span>{nextAction}</span>
              )}
              <span>{t('workflow.help', locale)}:</span>
              <Link to={safeSupportHref} className="underline">
                {t('workflow.support', locale)}
              </Link>
            </div>
          }
        />
      ) : (
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
                actionHref.startsWith('#') ? (
                  <a
                    className="font-medium text-primary underline underline-offset-4"
                    href={actionHref}
                  >
                    {nextAction}
                  </a>
                ) : (
                  <Link
                    className="font-medium text-primary underline underline-offset-4"
                    to={actionHref}
                  >
                    {nextAction}
                  </Link>
                )
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
              <Link className="text-primary underline underline-offset-4" to={safeSupportHref}>
                {t('workflow.support', locale)}
              </Link>
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
