import { useNumberFormatting } from '../hooks/useNumberFormatting.js';
/**
 * Admin dashboard page — heavy module, lazy-loaded.
 */
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { t } from '@barghsa/i18n/app';
import { useLocale } from '../hooks/useLocale.js';

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
        const json = (await res.json()) as PendingVerificationData;
        if (
          !json ||
          typeof json.enabled !== 'boolean' ||
          !Number.isSafeInteger(json.count) ||
          json.count < 0 ||
          !Array.isArray(json.profiles) ||
          json.profiles.length > 5
        )
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
      try {
        const res = await fetch('/api/admin/wallet/chargebacks/unresolved-warning', {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to fetch');
        const json = (await res.json()) as UnresolvedChargebackWarning;
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

  const showChargebackWarning =
    !chargebacksLoading && !chargebacksError && (chargebacks?.count ?? 0) > 0;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'}>
      <h1 className="text-2xl font-bold mb-4">{t('dashboard.admin.title', locale)}</h1>
      <p className="text-muted-foreground mb-6">{t('dashboard.admin.description', locale)}</p>

      {chargebacksError ? (
        <p className="mb-6 text-sm text-red-600" role="status">
          {t('dashboard.admin.chargebackWarning.error', locale)}
        </p>
      ) : null}

      {showChargebackWarning && chargebacks ? (
        <section
          className="mb-6 max-w-2xl rounded-lg border border-red-300 bg-red-50 p-5"
          role="alert"
          aria-live="assertive"
          aria-label={t('dashboard.admin.chargebackWarning.aria.banner', locale)}
        >
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-700" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-red-900">
                {t('dashboard.admin.chargebackWarning.title', locale)}
              </h2>
              <p className="text-sm text-red-800">
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
                className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-gray-800"
              >
                <p className="font-medium">
                  {t(`dashboard.admin.chargebackWarning.status.${item.status}`, locale)}
                  {item.amountIrR ? ` · ${numbers.money(item.amountIrR)}` : ''}
                </p>
                <p className="text-xs text-gray-600">
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
          className="bg-card text-card-foreground rounded-lg shadow-sm border p-5 max-w-sm"
          role="region"
          aria-label={t('dashboard.admin.pendingVerification.aria.widget', locale)}
        >
          <div className="flex items-center gap-3 mb-3">
            {/* Icon */}
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-amber-600" aria-hidden="true" />
            </div>
            <div role="status" aria-live="polite" aria-busy={isLoading}>
              {isLoading ? (
                <div
                  className="h-6 w-12 bg-gray-200 animate-pulse rounded"
                  aria-label={t('dashboard.admin.pendingVerification.loading', locale)}
                />
              ) : isError ? (
                <p className="text-sm text-red-700 dark:text-red-300">
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
