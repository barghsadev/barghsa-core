import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
/**
 * Admin dashboard page — heavy module, lazy-loaded.
 */
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { t } from '@barghsa/i18n/app';
import { t as tCrm } from '@barghsa/i18n/crm';
import { useLocale } from '../hooks/useLocale.js';
import { AdminBusinessWorkCounts } from '../components/AdminBusinessWorkCounts.js';
import { AdminMaintenanceSummary } from '../components/AdminMaintenanceSummary.js';

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

export default function AdminDashboard() {
  const [data, setData] = useState<PendingVerificationData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [verificationHidden, setVerificationHidden] = useState(false);
  const [chargebacks, setChargebacks] = useState<UnresolvedChargebackWarning | null>(null);
  const [chargebacksLoading, setChargebacksLoading] = useState(true);
  const [chargebacksError, setChargebacksError] = useState(false);
  const locale = useLocale();
  const numbers = useNumberFormatting(locale);
  const isRtl = locale === 'fa';

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let pendingRequest = false;
    let pendingChargebacks = false;

    const fetchData = async () => {
      if (pendingRequest) return;
      pendingRequest = true;
      try {
        const res = await fetch('/api/crm/dashboard/pending-verification', {
          credentials: 'include',
        });
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) {
            setData(null);
            setVerificationHidden(true);
            setIsLoading(false);
            setIsError(false);
          }
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch');
        const json: unknown = await res.json();
        if (!isPendingVerificationData(json))
          throw new Error('Invalid pending verification response');
        if (!cancelled) {
          setData(json.enabled ? json : null);
          setVerificationHidden(!json.enabled);
          setIsLoading(false);
          setIsError(false);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setIsLoading(false);
          setIsError(true);
        }
      } finally {
        pendingRequest = false;
      }
    };

    const fetchChargebacks = async () => {
      if (pendingChargebacks) return;
      pendingChargebacks = true;
      try {
        const res = await fetch('/api/admin/wallet/chargebacks/unresolved-warning', {
          credentials: 'include',
        });
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) {
            setChargebacks(null);
            setChargebacksLoading(false);
            setChargebacksError(false);
          }
          return;
        }
        if (!res.ok) throw new Error('Failed to fetch');
        const json: unknown = await res.json();
        if (!isChargebackWarning(json)) throw new Error('Invalid chargeback warning');
        if (!cancelled) {
          setChargebacks(json);
          setChargebacksLoading(false);
          setChargebacksError(false);
        }
      } catch {
        if (!cancelled) {
          setChargebacksLoading(false);
          setChargebacksError(true);
        }
      } finally {
        pendingChargebacks = false;
      }
    };

    fetchData();
    fetchChargebacks();
    intervalId = setInterval(() => {
      fetchData();
      fetchChargebacks();
    }, 30_000);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const showChargebackWarning = !chargebacksLoading && (chargebacks?.count ?? 0) > 0;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-4">{t('dashboard.admin.title', locale)}</h1>
      <p className="text-muted-foreground mb-6">{t('dashboard.admin.description', locale)}</p>

      <AdminMaintenanceSummary />

      <AdminBusinessWorkCounts />

      {chargebacksError ? (
        <p className="mb-6 text-sm text-destructive" role="status">
          {t('dashboard.admin.chargebackWarning.error', locale)}
        </p>
      ) : null}

      {showChargebackWarning && chargebacks ? (
        <section
          className="mb-6 max-w-2xl rounded-lg border border-destructive/20 bg-danger-soft p-5"
          role="alert"
          aria-live="assertive"
          aria-label={t('dashboard.admin.chargebackWarning.aria.banner', locale)}
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft">
              <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-destructive">
                {t('dashboard.admin.chargebackWarning.title', locale)}
              </h2>
              <p className="text-sm text-destructive">
                {t('dashboard.admin.chargebackWarning.summary', locale)
                  .replace('{count}', numbers.number(chargebacks.count))
                  .replace('{unmatched}', numbers.number(chargebacks.unmatchedCount))
                  .replace('{failed}', numbers.number(chargebacks.reversalFailedCount))}
              </p>
            </div>
          </div>
          <ul className="space-y-2">
            {chargebacks.items.map((item) => (
              <li
                key={item.eventId}
                className="rounded-md border border-destructive/20 bg-card text-card-foreground px-3 py-2 text-sm text-foreground"
              >
                <p className="font-medium">
                  {t(`dashboard.admin.chargebackWarning.status.${item.status}`, locale)}
                  {item.amountIrR ? ` · ${numbers.money(item.amountIrR)}` : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.admin.chargebackWarning.eventId', locale).replace('{id}', '')}
                  <span className="font-mono" dir="ltr">
                    {item.eventId}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Pending verification widget */}
      {!verificationHidden && (
        <div
          className="bg-card text-card-foreground rounded-lg shadow-sm border p-5 max-w-lg"
          role="region"
          aria-label={t('dashboard.admin.pendingVerification.aria.widget', locale)}
        >
          <div className="flex items-center gap-3 mb-3">
            {/* Icon */}
            <div className="w-10 h-10 rounded-full bg-warning-soft flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-warning" aria-hidden="true" />
            </div>
            <div role="status" aria-live="polite" aria-busy={isLoading}>
              {isLoading ? (
                <div
                  className="h-6 w-12 bg-muted animate-pulse rounded"
                  aria-label={t('dashboard.admin.pendingVerification.loading', locale)}
                />
              ) : isError ? (
                <p className="text-sm text-destructive">
                  {t('dashboard.admin.pendingVerification.error', locale)}
                </p>
              ) : (
                <>
                  <p
                    className="text-2xl font-bold"
                    aria-label={t('dashboard.admin.pendingVerification.aria.count', locale)}
                  >
                    {numbers.number(data?.count ?? 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('dashboard.admin.pendingVerification.label', locale)}
                  </p>
                </>
              )}
            </div>
          </div>
          {!isLoading && !isError && data?.enabled && data.profiles.length > 0 && (
            <ul
              className="mb-4 space-y-2"
              aria-label={t('dashboard.admin.pendingVerification.recent', locale)}
            >
              {data.profiles.map((profile) => (
                <li key={profile.id}>
                  <Link
                    to="/admin/crm/profiles/$profileId"
                    params={{ profileId: profile.id }}
                    className="block rounded-md border px-3 py-2 text-sm transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="block font-medium break-words" dir="auto">
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
          {!isLoading && !isError && data?.enabled && (
            <Link
              to="/admin/crm"
              search={{ verification: 'PENDING' }}
              className="text-sm text-blue-700 dark:text-blue-300 hover:underline font-medium"
              aria-label={t('dashboard.admin.pendingVerification.aria.showAll', locale)}
            >
              {t('dashboard.admin.pendingVerification.showAll', locale)}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
