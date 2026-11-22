import { Alert, AlertDescription, Button, buttonVariants, LoadingSkeleton } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { dashboardText } from '@barghsa/i18n/dashboard';
import { Zap, Wallet, Gauge, ReceiptText, Package, FileCheck2, LifeBuoy } from 'lucide-react';
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
import { DashboardWidget, retryDashboardRead } from '../components/dashboard/DashboardWidget.js';
import {
  localizedAsyncReadError,
  readAsyncResponse,
  useAsyncData,
  type AsyncData,
} from '../hooks/useAsyncData.js';
import { useServerDetailQuery } from '../hooks/useServerQuery.js';
import { queryKeys } from '../lib/query-keys.js';
import { ServerQueryError } from '../lib/server-query-client.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { useAccountUser } from '../hooks/useAccountUser.js';
import { useNavigation } from '../hooks/useNavigation.js';
import './dashboard-intro.css';

interface DashboardContext {
  profile: { id: string; name: string };
  access: { wallet: boolean; invoices: boolean; orders: boolean; contracts: boolean };
}

type WidgetKey = 'wallet' | 'status' | 'invoices' | 'orders' | 'contracts';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function irr(value: unknown): boolean {
  return typeof value === 'string'
    ? /^-?\d{1,19}$/.test(value)
    : typeof value === 'number' && Number.isSafeInteger(value);
}
function instant(value: unknown): boolean {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function nullableInstant(value: unknown): boolean {
  return value === null || instant(value);
}
function validContext(value: unknown): value is DashboardContext {
  if (!record(value) || !record(value.profile) || !record(value.access)) return false;
  const { profile, access } = value;
  return (
    nonempty(profile.id) &&
    typeof profile.name === 'string' &&
    ['wallet', 'invoices', 'orders', 'contracts'].every((key) => typeof access[key] === 'boolean')
  );
}
function validWallet(value: unknown): value is WalletBalanceCardProps {
  return (
    record(value) &&
    irr(value.balance) &&
    (value.postedBalance === undefined || irr(value.postedBalance)) &&
    (value.reservedBalance === undefined || irr(value.reservedBalance)) &&
    value.currency === 'IRR' &&
    typeof value.lowBalanceWarning === 'boolean' &&
    count(value.pendingInvoices)
  );
}
function validStatus(value: unknown): value is QuickStatusCardsProps {
  return (
    record(value) &&
    ['activeContracts', 'pendingOrders', 'openTickets', 'unpaidInvoices'].every((key) =>
      count(value[key])
    )
  );
}
function validInvoices(value: unknown): value is UpcomingInvoice[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row: unknown) =>
        record(row) &&
        nonempty(row.invoiceId) &&
        nullableInstant(row.dueAt) &&
        nullableInstant(row.payableFrom) &&
        typeof row.remainingAmount === 'string' &&
        irr(row.remainingAmount)
    )
  );
}
function validOrders(value: unknown): value is RecentOrder[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row: unknown) =>
        record(row) &&
        (row.kind === 'electricity' || row.kind === 'saving') &&
        nonempty(row.orderId) &&
        nonempty(row.status) &&
        instant(row.submittedAt) &&
        (row.amountIrR === null || (typeof row.amountIrR === 'string' && irr(row.amountIrR)))
    )
  );
}
function validContracts(value: unknown): value is ActiveContract[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row: unknown) =>
        record(row) &&
        nonempty(row.contractId) &&
        nonempty(row.contractNumber) &&
        (row.serviceType === 'electricity' ||
          row.serviceType === 'savings' ||
          row.serviceType === 'solar') &&
        row.status === 'Active' &&
        nullableInstant(row.serviceStartsAt) &&
        nullableInstant(row.serviceEndsAt)
    )
  );
}

function useWidget<T>(
  widget: WidgetKey,
  profileId: string,
  valid: (value: unknown) => value is T
): AsyncData<T> {
  const locale = useLocale();
  const revision = useProfileContextRevision();
  const accountId = useAccountUser();
  const scope = { context: 'customer' as const, ownerId: profileId, revision, accountId };
  const resource = useServerDetailQuery<unknown>({
    queryKey:
      widget === 'status'
        ? queryKeys.dashboard.detail(scope, widget)
        : queryKeys[widget].detail(scope, 'dashboard'),
    manual: true,
    read: async (signal) => {
      const response = await readAsyncResponse(
        `/api/dashboard/widgets/${widget}?profileId=${encodeURIComponent(profileId)}`,
        signal
      );
      if (!response.ok) throw new ServerQueryError(response.status);
      return response.json();
    },
  });
  const retry = () => void resource.refetch();
  if (resource.isPending || resource.isFetching) return { status: 'loading', data: null, retry };
  if (
    resource.isError ||
    !record(resource.data) ||
    resource.data.profileId !== profileId ||
    !valid(resource.data.data)
  )
    return {
      status: 'error',
      data: null,
      retry,
      error: localizedAsyncReadError(resource.error, locale),
    };
  return { status: 'ready', data: resource.data.data, retry };
}

function WalletWidget({ profileId, locale }: { profileId: string; locale: Locale }) {
  const resource = useWidget('wallet', profileId, validWallet);
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
  const resource = useWidget('status', profileId, validStatus);
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
  const resource = useWidget('invoices', profileId, validInvoices);
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
  const resource = useWidget('orders', profileId, validOrders);
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
  const resource = useWidget('contracts', profileId, validContracts);
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
  const navigation = useNavigation();
  const context = useAsyncData<unknown>('/api/dashboard/context');
  const dashboard = context.status === 'ready' && validContext(context.data) ? context.data : null;
  const profileName = dashboard?.profile.name;
  const actions = (
    [
      { label: shellText('buyElectricity', locale), href: '/electricity', icon: Zap },
      { label: t('dashboard.overview.topUpWallet', locale), href: '/wallet', icon: Wallet },
      { label: t('dashboard.overview.supportTicket', locale), href: '/tickets', icon: LifeBuoy },
    ] as const
  ).filter(({ href }) => navigation?.area === 'customer' && navigation.paths.includes(href));

  return (
    <div className="flex flex-col gap-5 lg:gap-6" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <header className="overflow-hidden rounded-2xl border bg-card">
        <div className="dashboard-intro bg-brand-panel px-5 py-6 text-brand-panel-foreground sm:px-7 sm:py-8">
          <h1 className="max-w-3xl text-[clamp(1.625rem,3.2vw,2.625rem)] font-bold leading-tight wrap-anywhere">
            {profileName
              ? t('dashboard.overview.welcome', locale).replace('{name}', profileName)
              : t('dashboard.nav.overview', locale)}
          </h1>
          <p className="mt-2 max-w-xl text-sm text-brand-panel-muted sm:text-base">
            {shellText('dashboardDescription', locale)}
          </p>
        </div>
        {actions.length > 0 && (
          <div
            role="group"
            aria-label={t('dashboard.overview.quickActions', locale)}
            className="flex flex-wrap gap-2 px-4 py-3 sm:px-6"
          >
            {actions.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                to={href}
                className={buttonVariants({
                  variant: href === '/electricity' ? 'default' : 'ghost',
                })}
              >
                <Icon data-icon="inline-start" aria-hidden="true" />
                {label}
              </Link>
            ))}
          </div>
        )}
      </header>
      {context.status === 'loading' ? (
        <LoadingSkeleton label={loadingText('loading', locale)} variant="cards" />
      ) : !dashboard ? (
        <Alert variant="destructive">
          <AlertDescription>
            <p>{t('dashboard.overview.loadError', locale)}</p>
            <Button variant="outline" onClick={() => retryDashboardRead(context, locale)}>
              {t('dashboard.overview.retry', locale)}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {(dashboard.access.invoices || dashboard.access.orders || dashboard.access.contracts) &&
            time.notice}
          <DashboardLayout key={dashboard.profile.id}>
            {dashboard.access.wallet && (
              <WalletWidget profileId={dashboard.profile.id} locale={locale} />
            )}
            <StatusWidget profileId={dashboard.profile.id} locale={locale} />
            {dashboard.access.invoices && (
              <InvoicesWidget profileId={dashboard.profile.id} locale={locale} time={time} />
            )}
            {dashboard.access.orders && (
              <OrdersWidget profileId={dashboard.profile.id} locale={locale} time={time} />
            )}
            {dashboard.access.contracts && (
              <ContractsWidget profileId={dashboard.profile.id} locale={locale} time={time} />
            )}
          </DashboardLayout>
        </>
      )}
    </div>
  );
}
