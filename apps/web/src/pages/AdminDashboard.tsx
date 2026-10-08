/**
 * Admin dashboard page — heavy module, lazy-loaded.
 */
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { t } from '@barghsa/i18n/workspace';
import { tWorkspace as tCrm } from '@barghsa/i18n/workspace-crm';
import { useLocale } from '../hooks/useLocale.js';
import { AdminBusinessWorkCounts } from '../components/AdminBusinessWorkCounts.js';
import { AdminMaintenanceSummary } from '../components/AdminMaintenanceSummary.js';
import { DashboardLayout } from '../components/dashboard/DashboardLayout.js';
import { DashboardWidget } from '../components/dashboard/DashboardWidget.js';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { Button } from '@barghsa/ui';
import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
import { staffDashboardReader, useStaffDashboardData } from '../hooks/useStaffDashboardData.js';

interface PendingVerificationProfile {
  id: string;
  profileType: 'INDIVIDUAL' | 'LEGAL';
  firstName: string | null;
  lastName: string | null;
  legalName: string | null;
  createdAt: string;
}

interface PendingVerificationData {
  enabled: boolean;
  count: number;
  profiles: PendingVerificationProfile[];
}

function isPendingVerificationData(value: unknown): value is PendingVerificationData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.enabled === 'boolean' &&
    typeof data.count === 'number' &&
    Number.isSafeInteger(data.count) &&
    data.count >= 0 &&
    Array.isArray(data.profiles) &&
    data.profiles.length <= (data.enabled ? Math.min(data.count, 5) : 0) &&
    data.profiles.every((profile: unknown) => {
      if (!profile || typeof profile !== 'object') return false;
      const row = profile as Record<string, unknown>;
      return (
        typeof row.id === 'string' &&
        /^[a-f0-9-]{36}$/i.test(row.id) &&
        (row.profileType === 'INDIVIDUAL' || row.profileType === 'LEGAL') &&
        ['firstName', 'lastName', 'legalName'].every(
          (key) => row[key] === null || typeof row[key] === 'string'
        ) &&
        typeof row.createdAt === 'string'
      );
    })
  );
}

function pendingProfileName(profile: PendingVerificationProfile, locale: 'fa' | 'en'): string {
  const name =
    profile.profileType === 'LEGAL'
      ? profile.legalName?.trim()
      : [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  return name || `${tCrm(`crm.list.${profile.profileType}`, locale)} · ${profile.id.slice(0, 8)}`;
}

interface UnresolvedChargebackItem {
  eventId: string;
  status: 'unmatched' | 'unresolved';
  amountIrR: string | null;
  walletId: string | null;
  originalTransactionId: string | null;
  reason: string | null;
  createdAt: string;
}

interface UnresolvedChargebackWarning {
  count: number;
  unmatchedCount: number;
  reversalFailedCount: number;
  items: UnresolvedChargebackItem[];
}

function isChargebackWarning(value: unknown): value is UnresolvedChargebackWarning {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  const count = (n: unknown): n is number =>
    typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  return (
    count(row.count) &&
    count(row.unmatchedCount) &&
    count(row.reversalFailedCount) &&
    row.count === row.unmatchedCount + row.reversalFailedCount &&
    Array.isArray(row.items) &&
    row.items.length <= 20 &&
    row.items.length <= row.count &&
    row.items.every((item: unknown) => {
      if (!item || typeof item !== 'object') return false;
      const entry = item as Record<string, unknown>;
      return (
        typeof entry.eventId === 'string' &&
        entry.eventId.length > 0 &&
        (entry.status === 'unmatched' || entry.status === 'unresolved') &&
        (entry.amountIrR === null ||
          (typeof entry.amountIrR === 'string' && /^\d{1,19}$/.test(entry.amountIrR))) &&
        ['walletId', 'originalTransactionId', 'reason'].every(
          (key) => entry[key] === null || typeof entry[key] === 'string'
        ) &&
        typeof entry.createdAt === 'string'
      );
    })
  );
}

const readVerification = staffDashboardReader<PendingVerificationData>((value) => {
  if (!isPendingVerificationData(value)) throw new Error('Invalid pending verification response');
  return value.enabled ? value : null;
});
const readChargebacks = staffDashboardReader<UnresolvedChargebackWarning>((value) => {
  if (!isChargebackWarning(value)) throw new Error('Invalid chargeback warning');
  return value;
});

function PendingVerification() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const resource = useStaffDashboardData(
    '/api/crm/dashboard/pending-verification',
    readVerification
  );
  if (!resource) return null;
  return (
    <DashboardWidget
      title={t('dashboard.admin.pendingVerification.label', locale)}
      icon={ShieldCheck}
      locale={locale}
      resource={resource}
      viewAll={
        resource.status === 'ready' ? (
          <Link
            to="/admin/crm"
            search={{ verification: 'PENDING' }}
            className="text-sm font-medium text-primary hover:underline"
            aria-label={t('dashboard.admin.pendingVerification.aria.showAll', locale)}
          >
            {t('dashboard.admin.pendingVerification.showAll', locale)}
          </Link>
        ) : undefined
      }
    >
      {(data) => (
        <>
          <p
            className="mb-4 text-2xl font-bold"
            aria-label={t('dashboard.admin.pendingVerification.aria.count', locale)}
          >
            {numbers.number(data.count)}
          </p>
          {data.profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {dashboardText('verification.empty', locale)}
            </p>
          ) : (
            <ul
              className="space-y-2"
              aria-label={t('dashboard.admin.pendingVerification.recent', locale)}
            >
              {data.profiles.map((profile) => (
                <li key={profile.id}>
                  <Link
                    to="/admin/crm/profiles/$profileId"
                    params={{ profileId: profile.id }}
                    className="block rounded-md border px-3 py-2 text-sm transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="block break-words font-medium" dir="auto">
                      {pendingProfileName(profile, locale)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {tCrm(`crm.list.${profile.profileType}`, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </DashboardWidget>
  );
}

function ChargebackWarning() {
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const resource = useStaffDashboardData(
    '/api/admin/wallet/chargebacks/unresolved-warning',
    readChargebacks,
    true
  );
  if (!resource) return null;
  // A stale zero is not evidence that finance has no unresolved exceptions.
  const widgetResource =
    resource.status === 'ready' && resource.refreshError && resource.data.count === 0
      ? { status: 'error' as const, data: null, retry: resource.retry }
      : resource;
  return (
    <DashboardWidget
      title={t('dashboard.admin.chargebackWarning.title', locale)}
      icon={AlertTriangle}
      locale={locale}
      resource={widgetResource}
      empty={(data) => data.count === 0}
      emptyMessage={dashboardText('chargebacks.empty', locale)}
    >
      {(chargebacks) => (
        <section
          className="space-y-3"
          role="alert"
          aria-live="assertive"
          aria-label={t('dashboard.admin.chargebackWarning.aria.banner', locale)}
        >
          {resource.status === 'ready' && resource.refreshError && (
            <div className="space-y-2">
              <p role="status" className="text-sm text-destructive">
                {t('dashboard.admin.chargebackWarning.error', locale)}
              </p>
              <Button variant="outline" onClick={resource.retry}>
                {dashboardText('widget.retry', locale)}
              </Button>
            </div>
          )}
          <p className="text-sm font-medium text-destructive">
            {t('dashboard.admin.chargebackWarning.summary', locale)
              .replace('{count}', numbers.number(chargebacks.count))
              .replace('{unmatched}', numbers.number(chargebacks.unmatchedCount))
              .replace('{failed}', numbers.number(chargebacks.reversalFailedCount))}
          </p>
          <ul className="space-y-2">
            {chargebacks.items.map((item) => (
              <li
                key={item.eventId}
                className="rounded-md border border-destructive/20 bg-card px-3 py-2 text-sm text-card-foreground"
              >
                <p className="font-medium">
                  {t(`dashboard.admin.chargebackWarning.status.${item.status}`, locale)}
                  {item.amountIrR ? ` · ${numbers.money(item.amountIrR)}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.admin.chargebackWarning.eventId', locale).replace('{id}', '')}
                  <span className="font-mono break-all" dir="ltr">
                    {item.eventId}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DashboardWidget>
  );
}

export default function AdminDashboard() {
  const locale = useLocale();
  return (
    <div dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <h1 className="mb-4 text-2xl font-bold">{t('dashboard.admin.title', locale)}</h1>
      <p className="mb-6 text-muted-foreground">{t('dashboard.admin.description', locale)}</p>
      <DashboardLayout>
        <AdminBusinessWorkCounts />
        <PendingVerification />
        <ChargebackWarning />
        <AdminMaintenanceSummary />
      </DashboardLayout>
    </div>
  );
}
