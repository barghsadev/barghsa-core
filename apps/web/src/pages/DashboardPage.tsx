import {
  PageHeader,
  LoadingSkeleton,
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
} from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { feedbackText } from '@barghsa/i18n/feedback';
import { ArrowUpRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useLocale } from '../hooks/useLocale.js';
import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/app';
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

  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>{t('dashboard.overview.loadError', locale)}</p>
          <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
            {t('dashboard.overview.retry', locale)}
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (loading) return <LoadingSkeleton label={feedbackText('loading', locale)} variant="cards" />;

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
    <div className="flex flex-col gap-8" dir={isRtl ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={shellText('dashboardEyebrow', locale)}
        title={t('dashboard.overview.welcome', locale).replace('{name}', profileName)}
        description={shellText('dashboardDescription', locale)}
      />

      {/* Wallet balance + Quick status cards side‑by‑side */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-5">
        <div className="min-w-0">
          {data?.wallet ? (
            <WalletBalanceCard
              balance={data.wallet.balance}
              currency={data.wallet.currency}
              lowBalanceWarning={data.wallet.lowBalanceWarning}
              pendingInvoices={data.pendingInvoices}
              locale={locale}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              {t('dashboard.overview.walletUnavailable', locale)}
            </p>
          )}
        </div>

        {/* Quick status cards — replaces the previous inline cards */}
        <div className="min-w-0">
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
      <section className="border-t pt-6">
        <h2 className="text-lg font-semibold text-foreground mb-1">
          {t('dashboard.overview.quickActions', locale)}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {shellText('quickActionsDescription', locale)}
        </p>
        <div className="flex flex-wrap gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              to={action.href}
              className={buttonVariants({ variant: 'outline' })}
            >
              {action.label}
              <ArrowUpRight data-icon="inline-end" aria-hidden="true" className="rtl:-rotate-90" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
