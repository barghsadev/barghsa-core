import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { contractText } from '@barghsa/i18n/contracts';
import { Progress } from '@barghsa/ui';
import type { useAccountTime } from '../hooks/useAccountTime.js';

export interface ActiveContract {
  contractId: string;
  contractNumber: string;
  serviceType: 'electricity' | 'savings' | 'solar';
  status: 'Active';
  serviceStartsAt: string | null;
  serviceEndsAt: string | null;
}

function elapsedPercent(contract: ActiveContract): number | null {
  if (!contract.serviceStartsAt || !contract.serviceEndsAt) return null;
  const start = Date.parse(contract.serviceStartsAt);
  const end = Date.parse(contract.serviceEndsAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.max(0, Math.min(100, Math.round(((Date.now() - start) / (end - start)) * 100)));
}

export function ActiveContractsWidget({
  contracts,
  locale,
  time,
  embedded = false,
}: {
  contracts: ActiveContract[];
  locale: Locale;
  time: ReturnType<typeof useAccountTime>;
  embedded?: boolean;
}) {
  const Frame = embedded ? 'div' : 'section';
  return (
    <Frame
      className={embedded ? 'space-y-4' : 'space-y-4 rounded-xl border bg-card p-5'}
      aria-labelledby={embedded ? undefined : 'active-contracts-title'}
    >
      {!embedded && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="active-contracts-title" className="text-lg font-semibold">
            {t('dashboard.overview.contractStatus', locale)}
          </h2>
          <Link
            to="/contracts"
            search={{ state: 'Active' }}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            {dashboardText('invoice.viewAll', locale)}
          </Link>
        </div>
      )}
      {contracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{dashboardText('contracts.empty', locale)}</p>
      ) : (
        <ul className={embedded ? 'grid gap-4' : 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'}>
          {contracts.map((contract) => {
            const percent = elapsedPercent(contract);
            return (
              <li key={contract.contractId} className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {contractText(contract.serviceType, locale)} ·{' '}
                    <bdi>{contract.contractNumber}</bdi>
                  </p>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                    {contractText(contract.status, locale)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {contractText('serviceEndsAt', locale)}:{' '}
                  {contract.serviceEndsAt
                    ? time.format(contract.serviceEndsAt, {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })
                    : '—'}
                </p>
                {percent === null ? (
                  <p className="text-sm text-muted-foreground">
                    {dashboardText('contracts.progressUnavailable', locale)}
                  </p>
                ) : (
                  <div className="space-y-2">
                    <p
                      id={`contract-progress-${contract.contractId}`}
                      className="text-sm text-muted-foreground"
                    >
                      {dashboardText('contracts.progress', locale).replace(
                        '{percent}',
                        new Intl.NumberFormat(locale).format(percent)
                      )}
                    </p>
                    <Progress
                      value={percent}
                      aria-labelledby={`contract-progress-${contract.contractId}`}
                    />
                  </div>
                )}
                <Link
                  to="/contracts"
                  search={{ state: 'Active', contractId: contract.contractId }}
                  className="inline-block text-sm font-medium text-primary underline underline-offset-4"
                  aria-label={`${dashboardText('contracts.view', locale)} · ${contract.contractNumber}`}
                >
                  {dashboardText('contracts.view', locale)}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Frame>
  );
}
