import { useCallback } from 'react';
import { Link } from '@tanstack/react-router';
import { Alert, Badge, Button, buttonVariants } from '@barghsa/ui';
import { RecordDetailSkeleton } from './RecordSkeleton.js';
import { RecordListSkeleton } from './RecordListSkeleton.js';
import { verificationConfigText } from '@barghsa/i18n/verification-config';
import { useCatalogueResource, useCatalogueScope } from '../hooks/useCatalogueResource.js';
import { useLocale } from '../hooks/useLocale.js';
import { verificationProviderId } from '../lib/verification-location.js';

type Provider = { providerId: string; displayName: string; state: keyof typeof circuitLabels };
type ProviderDetail = Pick<Provider, 'providerId' | 'displayName'> & {
  config: { providerId: string; enabled: boolean; settingsConfigured: boolean };
};
const circuitLabels = {
  CLOSED: 'providerAvailable',
  OPEN: 'providerPaused',
  HALF_OPEN: 'providerRecovering',
} as const;
const endpoint = '/api/admin/verification/providers';

function validProviderName(row: Partial<Provider>) {
  return (
    verificationProviderId(row.providerId) &&
    typeof row.displayName === 'string' &&
    row.displayName.trim().length > 0 &&
    row.displayName.length <= 200
  );
}

function validProviders(value: unknown): value is Provider[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) => row && validProviderName(row) && Object.hasOwn(circuitLabels, row.state)
    ) &&
    new Set(value.map((row) => row.providerId)).size === value.length
  );
}

export default function VerificationProviders({
  providerId,
  onDenied,
}: {
  providerId?: string;
  onDenied: () => void;
}) {
  const locale = useLocale();
  const t = (key: Parameters<typeof verificationConfigText>[0]) =>
    verificationConfigText(key, locale);
  const scope = useCatalogueScope(onDenied);
  const validDetail = useCallback(
    (value: unknown): value is ProviderDetail => {
      if (!value || typeof value !== 'object') return false;
      const row = value as Partial<ProviderDetail>;
      return (
        validProviderName(row) &&
        row.providerId === providerId &&
        !!row.config &&
        row.config.providerId === providerId &&
        typeof row.config.enabled === 'boolean' &&
        typeof row.config.settingsConfigured === 'boolean'
      );
    },
    [providerId]
  );
  const collection = useCatalogueResource(scope, providerId ? null : endpoint, validProviders);
  const record = useCatalogueResource(
    scope,
    providerId ? `${endpoint}/${encodeURIComponent(providerId)}/config` : null,
    validDetail,
    { clearOnMissing: true }
  );
  const resource = providerId ? record : collection;
  if (scope.denied) return null;
  return (
    <section
      aria-label={t(providerId ? 'providerDetails' : 'providerSection')}
      className="max-w-4xl space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t(providerId ? 'providerConfigHelp' : 'providerDescription')}
        </p>
        {!resource.missing && (
          <Button
            type="button"
            variant="outline"
            disabled={resource.loading}
            onClick={resource.retry}
          >
            {t('reload')}
          </Button>
        )}
      </div>
      {resource.loading &&
        (providerId ? (
          <RecordDetailSkeleton label={t('loading')} layout="payment" />
        ) : (
          <RecordListSkeleton label={t('loading')} view="card" headings={[]} />
        ))}
      {resource.error && (
        <Alert variant="destructive">
          {t(resource.missing ? 'providerMissing' : 'loadFailed')}
        </Alert>
      )}
      {record.data && (
        <div className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">
              <bdi>{record.data.displayName}</bdi>
            </h2>
            <p className="font-mono text-sm text-muted-foreground [overflow-wrap:anywhere]">
              <bdi>{record.data.providerId}</bdi>
            </p>
          </div>
          <dl className="grid gap-4 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">{t('providerEnabled')}</dt>
              <dd className="mt-1 font-medium">{t(record.data.config.enabled ? 'yes' : 'no')}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t('providerConfigured')}</dt>
              <dd className="mt-1 font-medium">
                {t(record.data.config.settingsConfigured ? 'yes' : 'no')}
              </dd>
            </div>
          </dl>
        </div>
      )}
      {collection.data?.length === 0 && (
        <p className="rounded-xl border bg-card p-4">{t('providerEmpty')}</p>
      )}
      {!!collection.data?.length && (
        <ul className="space-y-3">
          {collection.data.map((provider) => (
            <li
              key={provider.providerId}
              className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium [overflow-wrap:anywhere]">
                  <bdi>{provider.displayName}</bdi>
                </p>
                <Badge variant={provider.state === 'OPEN' ? 'destructive' : 'secondary'}>
                  {t(circuitLabels[provider.state])}
                </Badge>
              </div>
              <Link
                to="/admin/verification/providers/$providerId"
                params={{ providerId: provider.providerId }}
                className={buttonVariants({ variant: 'outline', className: 'min-h-11' })}
                aria-label={`${t('providerDetails')} · ${provider.displayName}`}
              >
                {t('providerDetails')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
