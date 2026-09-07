import { useState, useEffect } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n';
import { WalletBalanceCard } from '../components/WalletBalanceCard.js';
import { QuickStatusCards } from '../components/QuickStatusCards.js';

interface DashboardData {
  profile?: { id: string; name: string };
  wallet: { balance: string; currency: string; lowBalanceWarning: boolean } | null;
  activeOrders: number;
  pendingInvoices: number;
  openTickets: number;
  contracts: { active: number; total: number };
  quickStatus: {
    activeContracts: number;
    pendingOrders: number;
    openTickets: number;
    unpaidInvoices: number;
  };
}

/**
 * Dashboard overview page (T-08.01.01, T-08.01.02, T-08.01.03).
 *
 * Shows:
 *   - A welcome message with profile name.
 *   - Wallet balance card (T-08.01.02).
 *   - Quick status cards (T-08.01.03) with icon+count+label and colour
 *     coding, replacing the previous inline summary cards.
 *   - Quick actions section.
 */
export function DashboardPage({ locale: localeOverride }: { locale?: Locale } = {}) {
  const documentLocale = useLocale();
  const locale = localeOverride ?? documentLocale;
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isRtl = locale === 'fa';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    async function fetchDashboard() {
      try {
        const res = await fetch('/api/dashboard', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: DashboardData = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchDashboard();
    return () => {
      cancelled = true;
    };
  }, [revision]);

  const profileName = data?.profile?.name || t('dashboard.profile.unnamed', locale);

  if (error) {
    return (
      <div className="text-center py-12">
        <p role="alert" className="text-red-600">
          {t('dashboard.overview.loadError', locale)}
        </p>
        <button
          onClick={() => setRevision((value) => value + 1)}
          className="mt-4 px-4 py-2 bg-primary text-white rounded hover:bg-primary-dark"
        >
          {t('dashboard.overview.retry', locale)}
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Welcome skeleton */}
        <div className="h-8 w-64 bg-gray-200 rounded animate-pulse" />
        {/* Wallet card skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 h-32 bg-gray-200 rounded-lg animate-pulse" />
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const quickActions = [
    { label: t('dashboard.overview.newOrder', locale), href: '/electricity' },
    { label: t('dashboard.overview.topUpWallet', locale), href: '/wallet' },
    { label: t('dashboard.overview.supportTicket', locale), href: '/tickets' },
  ];

  const qs = data?.quickStatus ?? {
    activeContracts: data?.contracts?.active ?? 0,
    pendingOrders: data?.activeOrders ?? 0,
    openTickets: data?.openTickets ?? 0,
    unpaidInvoices: data?.pendingInvoices ?? 0,
  };

  return (
    <div className="space-y-6" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Welcome message with profile name */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {t('dashboard.overview.welcome', locale).replace('{name}', profileName)}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {t('dashboard.overview.profileBadge', locale).replace('{name}', profileName)}
          </p>
        </div>
      </div>

      {/* Wallet balance + Quick status cards side‑by‑side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          {data?.wallet ? (
            <WalletBalanceCard
              balance={data.wallet.balance}
              currency={data.wallet.currency}
              lowBalanceWarning={data.wallet.lowBalanceWarning}
              pendingInvoices={data.pendingInvoices}
              locale={locale}
            />
          ) : (
            <p className="text-sm text-gray-500">
              {t('dashboard.overview.walletUnavailable', locale)}
            </p>
          )}
        </div>

        {/* Quick status cards — replaces the previous inline cards */}
        <div className="lg:col-span-2">
          <QuickStatusCards
            activeContracts={qs.activeContracts}
            pendingOrders={qs.pendingOrders}
            openTickets={qs.openTickets}
            unpaidInvoices={qs.unpaidInvoices}
            locale={locale}
          />
        </div>
      </div>

      {/* Quick actions section */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          {t('dashboard.overview.quickActions', locale)}
        </h2>
        <div className="flex flex-wrap gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              to={action.href}
              className="inline-flex items-center px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
