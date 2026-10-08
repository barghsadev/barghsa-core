import {
  PageHeader,
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  LoadingSkeleton,
} from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { feedbackText } from '@barghsa/i18n/feedback';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { ArrowUpRight, Wallet, Gauge, ReceiptText, Package, FileCheck2 } from 'lucide-react';
import { useLocale } from '../hooks/useLocale.js';
import { Link } from '@tanstack/react-router';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { WalletBalanceCard, type WalletBalanceCardProps } from '../components/WalletBalanceCard.js';
import { QuickStatusCards, type QuickStatusCardsProps } from '../components/QuickStatusCards.js';
import {
  UpcomingInvoicesWidget,
  type UpcomingInvoice,
} from '../components/UpcomingInvoicesWidget.js';
import { useAccountTime } from '../hooks/useAccountTime.js';
import { LatestOrdersWidget, type RecentOrder } from '../components/LatestOrdersWidget.js';
import { ActiveContractsWidget, type ActiveContract } from '../components/ActiveContractsWidget.js';
import { DashboardLayout } from '../components/dashboard/DashboardLayout.js';
import { DashboardWidget } from '../components/dashboard/DashboardWidget.js';
import { useAsyncData, type AsyncData } from '../hooks/useAsyncData.js';

interface DashboardContext {
  profile: { id: string; name: string };
  access: { wallet: boolean; invoices: boolean; orders: boolean; contracts: boolean };
}

type WidgetKey = 'wallet' | 'status' | 'invoices' | 'orders' | 'contracts';

function useWidget<T>(widget: WidgetKey, profileId: string): AsyncData<T> {
  const resource = useAsyncData<{ profileId: string; data: T }>(
    `/api/dashboard/widgets/${widget}?profileId=${encodeURIComponent(profileId)}`
  );
  if (resource.status !== 'ready') return resource;
  if (!resource.data || resource.data.profileId !== profileId || resource.data.data == null)
    return { status: 'error', data: null, retry: resource.retry };
  return { status: 'ready', data: resource.data.data, retry: resource.retry };
}

function WalletWidget({ profileId, locale }: { profileId: string; locale: Locale }) {
  const resource = useWidget<Omit<WalletBalanceCardProps, 'locale'>>('wallet', profileId);
  return (
    <DashboardWidget
      title={t('dashboard.overview.walletBalance', locale)}
      icon={Wallet}
      resource={resource}
      locale={locale}
    >
      {(wallet) => <WalletBalanceCard {...wallet} embedded locale={locale} />}
    </DashboardWidget>
  );
}

function StatusWidget({ profileId, locale }: { profileId: string; locale: Locale }) {
  const resource = useWidget<Omit<QuickStatusCardsProps, 'locale'>>('status', profileId);
  return (
    <DashboardWidget
      title={dashboardText('status.title', locale)}
      icon={Gauge}
      resource={resource}
      locale={locale}
    >
      {(counts) => <QuickStatusCards {...counts} embedded locale={locale} />}
    </DashboardWidget>
  );
}

function InvoicesWidget({
  profileId,
  locale,
  time,
}: {
  profileId: string;
  locale: Locale;
  time: ReturnType<typeof useAccountTime>;
}) {
  const resource = useWidget<UpcomingInvoice[]>('invoices', profileId);
  return (
    <DashboardWidget
      title={dashboardText('invoice.title', locale)}
      icon={ReceiptText}
      resource={resource}
      locale={locale}
      empty={(invoices) => invoices.length === 0}
      emptyMessage={dashboardText('invoice.empty', locale)}
      viewAll={
        <Link
          to="/invoices"
          search={{ status: 'unpaid' }}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
        >
          {dashboardText('invoice.viewAll', locale)}
        </Link>
      }
    >
      {(invoices) => (
        <UpcomingInvoicesWidget invoices={invoices} embedded locale={locale} time={time} />
      )}
    </DashboardWidget>
  );
}

function OrdersWidget({
  profileId,
  locale,
  time,
}: {
  profileId: string;
  locale: Locale;
  time: ReturnType<typeof useAccountTime>;
}) {
  const resource = useWidget<RecentOrder[]>('orders', profileId);
  return (
    <DashboardWidget
      title={dashboardText('orders.title', locale)}
      icon={Package}
      resource={resource}
      locale={locale}
    >
      {(orders) => <LatestOrdersWidget orders={orders} embedded locale={locale} time={time} />}
    </DashboardWidget>
  );
}

function ContractsWidget({
  profileId,
  locale,
  time,
}: {
  profileId: string;
  locale: Locale;
  time: ReturnType<typeof useAccountTime>;
}) {
  const resource = useWidget<ActiveContract[]>('contracts', profileId);
  return (
    <DashboardWidget
      title={t('dashboard.overview.contractStatus', locale)}
      icon={FileCheck2}
      resource={resource}
      locale={locale}
      empty={(contracts) => contracts.length === 0}
      emptyMessage={dashboardText('contracts.empty', locale)}
      viewAll={
        <Link
          to="/contracts"
          search={{ state: 'Active' }}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
        >
          {dashboardText('invoice.viewAll', locale)}
        </Link>
      }
    >
      {(contracts) => (
        <ActiveContractsWidget contracts={contracts} embedded locale={locale} time={time} />
      )}
    </DashboardWidget>
  );
}

export function DashboardPage({ locale: localeOverride }: { locale?: Locale } = {}) {
  const documentLocale = useLocale();
  const locale = localeOverride ?? documentLocale;
  const time = useAccountTime(locale);
  const context = useAsyncData<DashboardContext>('/api/dashboard/context');
  const ready = context.status === 'ready' && context.data?.profile?.id && context.data.access;
  const profileName = ready
    ? context.data.profile.name || t('dashboard.profile.unnamed', locale)
    : t('dashboard.profile.unnamed', locale);
  const actions = [
    { label: t('dashboard.overview.newOrder', locale), href: '/electricity' },
    { label: t('dashboard.overview.topUpWallet', locale), href: '/wallet' },
    { label: t('dashboard.overview.supportTicket', locale), href: '/tickets' },
  ];

  return (
    <div className="flex flex-col gap-8" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <PageHeader
        eyebrow={shellText('dashboardEyebrow', locale)}
        title={t('dashboard.overview.welcome', locale).replace('{name}', profileName)}
        description={shellText('dashboardDescription', locale)}
      />
      {context.status === 'loading' ? (
        <LoadingSkeleton label={feedbackText('loading', locale)} variant="cards" />
      ) : !ready ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{t('dashboard.overview.loadError', locale)}</p>
            <Button variant="outline" onClick={context.retry}>
              {t('dashboard.overview.retry', locale)}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {(context.data.access.invoices ||
            context.data.access.orders ||
            context.data.access.contracts) &&
            time.notice}
          <DashboardLayout key={context.data.profile.id}>
            {context.data.access.wallet && (
              <WalletWidget profileId={context.data.profile.id} locale={locale} />
            )}
            <StatusWidget profileId={context.data.profile.id} locale={locale} />
            {context.data.access.invoices && (
              <InvoicesWidget profileId={context.data.profile.id} locale={locale} time={time} />
            )}
            {context.data.access.orders && (
              <OrdersWidget profileId={context.data.profile.id} locale={locale} time={time} />
            )}
            {context.data.access.contracts && (
              <ContractsWidget profileId={context.data.profile.id} locale={locale} time={time} />
            )}
          </DashboardLayout>
        </>
      )}
      <section className="border-t pt-6">
        <h2 className="mb-1 text-lg font-semibold">
          {t('dashboard.overview.quickActions', locale)}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          {shellText('quickActionsDescription', locale)}
        </p>
        <div className="flex flex-wrap gap-3">
          {actions.map((action) => (
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
