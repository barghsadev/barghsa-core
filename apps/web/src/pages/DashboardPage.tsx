import { lazy, Suspense } from 'react';
import { Alert, AlertDescription, Button, buttonVariants, LoadingSkeleton } from '@barghsa/ui';
import { shellText } from '@barghsa/i18n/shell';
import { loadingText } from '@barghsa/i18n/loading-feedback';
import { dashboardText } from '@barghsa/i18n/dashboard';
import {
  Zap,
  Wallet,
  Gauge,
  ReceiptText,
  Package,
  FileCheck2,
  Sprout,
  Sun,
  MessagesSquare,
  ArrowUpRight,
} from 'lucide-react';
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
import type { RecentOrder } from '../components/LatestOrdersWidget.js';
import type { ActiveContract } from '../components/ActiveContractsWidget.js';
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
import { electricityDraftPath } from '../lib/electricity-draft.js';

const LatestOrdersWidget = lazy(() =>
  import('../components/LatestOrdersWidget.js').then(({ LatestOrdersWidget }) => ({
    default: LatestOrdersWidget,
  }))
);
const ActiveContractsWidget = lazy(() =>
  import('../components/ActiveContractsWidget.js').then(({ ActiveContractsWidget }) => ({
    default: ActiveContractsWidget,
  }))
);

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
      {(counts) => <QuickStatusCards {...counts} locale={locale} />}
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
          search={{}}
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
      {(orders) => (
        <Suspense
          fallback={<LoadingSkeleton label={loadingText('loading', locale)} variant="detail" />}
        >
          <LatestOrdersWidget orders={orders} embedded locale={locale} time={time} />
        </Suspense>
      )}
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
          search={{}}
          className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4"
        >
          {dashboardText('invoice.viewAll', locale)}
        </Link>
      }
    >
      {(contracts) => (
        <Suspense
          fallback={<LoadingSkeleton label={loadingText('loading', locale)} variant="detail" />}
        >
          <ActiveContractsWidget contracts={contracts} embedded locale={locale} time={time} />
        </Suspense>
      )}
    </DashboardWidget>
  );
}

function ElectricityHomeAction({
  locale,
  profileId,
}: {
  locale: Locale;
  profileId: string | undefined;
}) {
  const accountId = useAccountUser();
  const revision = useProfileContextRevision();
  const draft = useServerDetailQuery<unknown>({
    queryKey:
      profileId && accountId
        ? queryKeys.orders.detail(
            { context: 'customer', ownerId: profileId, accountId, revision },
            'home-electricity-draft'
          )
        : null,
    manual: true,
    read: async (signal) => {
      const response = await readAsyncResponse(electricityDraftPath('simple', profileId), signal);
      if (!response.ok) throw new ServerQueryError(response.status);
      return response.json();
    },
  });
  const resumable =
    draft.isSuccess &&
    record(draft.data) &&
    record(draft.data.data) &&
    nonempty(draft.data.revision);
  return (
    <Link to="/electricity/orders/new" className={buttonVariants({ className: 'min-h-11' })}>
      <Zap data-icon="inline-start" aria-hidden="true" />
      {dashboardText(resumable ? 'home.resume' : 'home.start', locale)}
    </Link>
  );
}

export function DashboardPage({ locale: localeOverride }: { locale?: Locale } = {}) {
  const documentLocale = useLocale();
  const locale = localeOverride ?? documentLocale;
  const time = useAccountTime(locale);
  const navigation = useNavigation();
  const context = useAsyncData<unknown>('/api/dashboard/context');
  const dashboard = context.status === 'ready' && validContext(context.data) ? context.data : null;
  const services = (
    [
      {
        name: shellText('buyElectricity', locale),
        description: 'electricity',
        to: '/electricity',
        accessPath: '/electricity',
        icon: Zap,
      },
      {
        name: shellText('energySavings', locale),
        description: 'savings',
        to: '/savings',
        accessPath: '/savings',
        icon: Sprout,
      },
      {
        name: t('dashboard.nav.solarRequests', locale),
        description: 'solar',
        to: '/solar/requests/new',
        accessPath: '/solar/requests',
        icon: Sun,
      },
      {
        name: t('dashboard.nav.consultations', locale),
        description: 'consultation',
        to: '/consultations/new',
        accessPath: '/consultations',
        icon: MessagesSquare,
      },
    ] as const
  ).filter(
    ({ accessPath }) => navigation?.area === 'customer' && navigation.paths.includes(accessPath)
  );
  const canOrder =
    navigation?.profileType === 'LEGAL' && services.some(({ to }) => to === '/electricity');

  return (
    <div
      className="mx-auto flex w-full max-w-7xl flex-col gap-5 sm:gap-6"
      dir={locale === 'fa' ? 'rtl' : 'ltr'}
    >
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border/70 pb-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {shellText('home', locale)}
          </h1>
          {dashboard?.profile.name && (
            <p className="mt-1 text-sm font-medium wrap-anywhere text-muted-foreground">
              {dashboard.profile.name}
            </p>
          )}
        </div>
        {canOrder && (
          <ElectricityHomeAction
            locale={locale}
            profileId={
              dashboard?.profile.id === navigation?.profileId ? dashboard?.profile.id : undefined
            }
          />
        )}
      </header>
      {services.length > 0 && (
        <section aria-labelledby="home-services">
          <h2 id="home-services" className="mb-3 text-lg font-semibold">
            {dashboardText('home.services', locale)}
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {services.map(({ name, description, to, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                className="group flex min-h-20 min-w-0 items-start gap-3 rounded-xl border bg-card p-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{name}</span>
                  <span className="mt-1 block text-sm leading-snug text-muted-foreground">
                    {dashboardText(`home.service.${description}`, locale)}
                  </span>
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-primary rtl:-scale-x-100"
                />
              </Link>
            ))}
          </div>
        </section>
      )}
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
      ) : dashboard.access.invoices ? (
        <>
          {time.notice}
          <InvoicesWidget profileId={dashboard.profile.id} locale={locale} time={time} />
        </>
      ) : null}
      {dashboard && (
        <>
          {!dashboard.access.invoices &&
            (dashboard.access.orders || dashboard.access.contracts) &&
            time.notice}
          {(dashboard.access.orders || dashboard.access.contracts) && (
            <section aria-labelledby="home-work">
              <h2 id="home-work" className="mb-3 text-lg font-semibold">
                {dashboardText('home.actions', locale)}
              </h2>
              <DashboardLayout
                key={dashboard.profile.id}
                tracks={dashboard.access.orders && dashboard.access.contracts ? 2 : 1}
              >
                {dashboard.access.orders && (
                  <OrdersWidget profileId={dashboard.profile.id} locale={locale} time={time} />
                )}
                {dashboard.access.contracts && (
                  <ContractsWidget profileId={dashboard.profile.id} locale={locale} time={time} />
                )}
              </DashboardLayout>
            </section>
          )}
          <section aria-labelledby="home-overview">
            <h2 id="home-overview" className="mb-3 text-lg font-semibold">
              {dashboardText('home.overview', locale)}
            </h2>
            <DashboardLayout key={dashboard.profile.id} tracks={dashboard.access.wallet ? 2 : 1}>
              {dashboard.access.wallet && (
                <WalletWidget profileId={dashboard.profile.id} locale={locale} />
              )}
              <StatusWidget profileId={dashboard.profile.id} locale={locale} />
            </DashboardLayout>
          </section>
        </>
      )}
    </div>
  );
}
