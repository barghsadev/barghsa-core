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
  actionLink?: ReactNode;
  supportHref?: string;
  submittedAt?: ReactNode;
  expectedResponse?: ReactNode;
  statusSummary?: ReactNode;
}

/** A shared customer-facing summary for any order, request, or contract. */
export function WorkflowStatusBanner({
  locale,
  status,
  happened,
  nextAction,
  owner,
  actionHref,
  actionLink,
  supportHref = '/tickets',
  submittedAt,
  expectedResponse,
  statusSummary,
}: WorkflowStatusBannerProps) {
  const safeSupportHref =
    supportHref.startsWith('/') && !supportHref.startsWith('//') ? supportHref : '/tickets';
  const waiting = owner === 'staff';
  const label = (key: string) => t(`workflow.${key}`, locale);
  const actionClass = 'touch-action font-medium text-primary underline underline-offset-4';
  const supportLink = (
    <Link className="touch-action text-primary underline underline-offset-4" to={safeSupportHref}>
      {label('support')}
    </Link>
  );
  const action =
    actionLink ??
    (actionHref ? (
      actionHref.startsWith('#') ? (
        <a href={actionHref} className={actionClass}>
          {nextAction}
        </a>
      ) : (
        <Link to={actionHref} className={actionClass}>
          {nextAction}
        </Link>
      )
    ) : (
      <span dir={waiting ? undefined : 'auto'}>{nextAction}</span>
    ));
  if (statusSummary) {
    return (
      <section
        aria-label={label('summary')}
        className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6"
        dir={locale === 'fa' ? 'rtl' : 'ltr'}
      >
        {statusSummary}
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t pt-4 text-sm">
          <div className="min-w-0 space-y-1">
            <h2 className="text-xs font-medium text-muted-foreground">{label('nextAction')}</h2>
            <div className="text-base font-semibold">{action}</div>
            {owner !== 'none' && (
              <p className="text-muted-foreground">
                {label('owner')}: {label(`owner.${owner}`)}
              </p>
            )}
          </div>
          {supportLink}
        </div>
        {(happened !== status || waiting) && (
          <div className="space-y-1 text-sm text-muted-foreground">
            {happened !== status && (
              <p>
                {label('happened')}: <bdi>{happened}</bdi>
              </p>
            )}
            {waiting && (expectedResponse ?? <p>{workflowFeedback('responseUnknown', locale)}</p>)}
          </div>
        )}
      </section>
    );
  }
  return (
    <section
      aria-label={label('summary')}
      className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <div>
        <p className="text-sm text-muted-foreground">{label('status')}</p>
        <h2 className="text-xl font-semibold" dir="auto">
          {status}
        </h2>
      </div>
      {waiting ? (
        <WaitingForBarghsa
          title={workflowFeedback('waiting', locale)}
          description={`${label('owner')}: ${label('owner.staff')}`}
          submittedAt={submittedAt ?? workflowFeedback('submissionUnknown', locale)}
          update={
            <p className="wrap-anywhere">
              {label('happened')}: <bdi>{happened}</bdi>
            </p>
          }
          expectedResponse={expectedResponse ?? workflowFeedback('responseUnknown', locale)}
          help={
            <div className="flex flex-wrap gap-3">
              <span>{label('nextAction')}:</span>
              {action}
              <span>{label('help')}:</span>
              {supportLink}
            </div>
          }
        />
      ) : (
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium">{label('happened')}</dt>
            <dd className="mt-1 text-muted-foreground wrap-anywhere" dir="auto">
              {happened}
            </dd>
          </div>
          <div>
            <dt className="font-medium">{label('nextAction')}</dt>
            <dd className="mt-1">{action}</dd>
          </div>
          <div>
            <dt className="font-medium">{label('owner')}</dt>
            <dd className="mt-1">{label(`owner.${owner}`)}</dd>
          </div>
          <div>
            <dt className="font-medium">{label('help')}</dt>
            <dd className="mt-1">{supportLink}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
