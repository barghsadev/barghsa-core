import { lazy, Suspense } from 'react';
import { RouteSkeleton } from '../components/RouteSkeleton.js';
import { Outlet, useLocation } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Zap,
  Sprout,
  Sun,
  MessagesSquare,
  Wallet,
  ReceiptText,
  LifeBuoy,
  Bell,
  Users,
  Settings,
  FileText,
  BookOpenText,
} from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/workspace';
import { shellText } from '@barghsa/i18n/shell';
import { useLocale } from '../hooks/useLocale.js';
import { TosBanner } from '../components/TosBanner.js';
import { NotificationBell } from '../components/NotificationBell.js';
import { AppShell, type NavigationGroup } from '../components/AppShell.js';
import { useNavigation } from '../hooks/useNavigation.js';
import { permittedNavigation } from '../lib/navigation-config.js';

const CustomerProfileWorkspace = lazy(() =>
  import('../components/CustomerProfileWorkspace.js').then((module) => ({
    default: module.CustomerProfileWorkspace,
  }))
);
const KnowledgeAssistantLauncher = lazy(() =>
  import('../components/KnowledgeAssistantLauncher.js').then((module) => ({
    default: module.KnowledgeAssistantLauncher,
  }))
);
const OwnershipBanner = lazy(() =>
  import('../components/OwnershipBanner.js').then((module) => ({ default: module.OwnershipBanner }))
);
const InvitationBanner = lazy(() =>
  import('../components/InvitationBanner.js').then((module) => ({
    default: module.InvitationBanner,
  }))
);

export function DashboardLayout({ locale: localeOverride }: { locale?: Locale }) {
  const currentLocale = useLocale();
  const locale = localeOverride ?? currentLocale;
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigation = useNavigation();
  const candidates: NavigationGroup[] = [
    {
      label: shellText('overview', locale),
      items: [{ to: '/app', label: shellText('home', locale), icon: LayoutDashboard }],
    },
    {
      label: shellText('services', locale),
      items: [
        { to: '/electricity', label: shellText('buyElectricity', locale), icon: Zap },
        { to: '/savings', label: shellText('energySavings', locale), icon: Sprout },
        { to: '/solar/requests', label: t('dashboard.nav.solarRequests', locale), icon: Sun },
        {
          to: '/consultations',
          label: t('dashboard.nav.consultations', locale),
          icon: MessagesSquare,
        },
      ],
    },
    {
      label: shellText('finance', locale),
      items: [
        { to: '/wallet', label: t('dashboard.nav.wallet', locale), icon: Wallet },
        { to: '/invoices', label: t('dashboard.nav.invoices', locale), icon: ReceiptText },
        { to: '/contracts', label: t('dashboard.nav.contracts', locale), icon: FileText },
      ],
    },
    {
      label: shellText('support', locale),
      items: [
        { to: '/documents', label: t('dashboard.nav.documentsList', locale), icon: FileText },
        { to: '/tickets', label: t('tickets.title', locale), icon: LifeBuoy },
        { to: '/ai', label: t('assistant.open', locale), icon: BookOpenText },
      ],
    },
    {
      label: shellText('account', locale),
      items: [
        {
          to: '/settings/profile',
          label: shellText(
            navigation?.profileType === 'LEGAL' ? 'legalProfile' : 'personalProfile',
            locale
          ),
          icon: Users,
        },
        { to: '/settings/addresses', label: shellText('addresses', locale), icon: Settings },
        { to: '/notifications', label: t('notifications.nav', locale), icon: Bell },
        { to: '/settings/team', label: t('team.title', locale), icon: Users },
        { to: '/settings', label: t('dashboard.nav.settings', locale), icon: Settings },
      ],
    },
  ];
  const groups = permittedNavigation(candidates, navigation, 'customer');
  const focused =
    pathname === '/electricity/orders/new' || pathname === '/electricity/orders/new/advanced';
  const showAssistant =
    pathname !== '/ai' &&
    pathname !== '/electricity' &&
    !pathname.startsWith('/settings') &&
    !/(?:^|\/)(?:new|edit|pay|payment|checkout|topup)(?:\/|$)/.test(pathname);
  return (
    <Suspense fallback={<RouteSkeleton />}>
      <CustomerProfileWorkspace locale={locale}>
        {(picker, badge) => (
          <AppShell
            area="dashboard"
            focused={focused}
            profile={picker}
            profileBadge={badge}
            locale={locale}
            groups={groups}
            navigationUnavailable={
              !navigation || navigation.area !== 'customer' || !navigation.paths.length
            }
            actions={<NotificationBell />}
            floating={
              showAssistant && (
                <Suspense fallback={null}>
                  <KnowledgeAssistantLauncher locale={locale} pathname={pathname} />
                </Suspense>
              )
            }
            banners={
              <>
                <TosBanner locale={locale} />
                <Suspense fallback={null}>
                  <InvitationBanner locale={locale} />
                </Suspense>
                {!pathname.startsWith('/settings/team') && (
                  <Suspense fallback={null}>
                    <OwnershipBanner />
                  </Suspense>
                )}
              </>
            }
          >
            <Suspense fallback={<RouteSkeleton />}>
              <Outlet />
            </Suspense>
          </AppShell>
        )}
      </CustomerProfileWorkspace>
    </Suspense>
  );
}
