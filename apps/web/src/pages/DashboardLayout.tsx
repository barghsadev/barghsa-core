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
import { ProfileSwitcher } from '../components/ProfileSwitcher.js';
import { TosBanner } from '../components/TosBanner.js';
import { InvitationBanner } from '../components/InvitationBanner.js';
import { OwnershipBanner } from '../components/OwnershipBanner.js';
import { NotificationBell } from '../components/NotificationBell.js';
import { AppShell, type NavigationGroup } from '../components/AppShell.js';
import { KnowledgeAssistantLauncher } from '../components/KnowledgeAssistantLauncher.js';
import { useNavigation } from '../hooks/useNavigation.js';
import { permittedNavigation } from '../lib/navigation-config.js';

export function DashboardLayout({ locale: localeOverride }: { locale?: Locale }) {
  const currentLocale = useLocale();
  const locale = localeOverride ?? currentLocale;
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigation = useNavigation();
  const candidates: NavigationGroup[] = [
    {
      label: shellText('overview', locale),
      items: [{ to: '/app', label: t('dashboard.nav.overview', locale), icon: LayoutDashboard }],
    },
    {
      label: shellText('services', locale),
      items: [
        { to: '/electricity', label: t('dashboard.nav.electricity', locale), icon: Zap },
        { to: '/savings', label: t('dashboard.nav.savings', locale), icon: Sprout },
        { to: '/solar/requests', label: t('dashboard.nav.solarRequests', locale), icon: Sun },
        {
          to: '/consultations',
          label: t('dashboard.nav.consultations', locale),
          icon: MessagesSquare,
        },
        { to: '/wallet', label: t('dashboard.nav.wallet', locale), icon: Wallet },
        { to: '/invoices', label: t('dashboard.nav.invoices', locale), icon: ReceiptText },
        { to: '/contracts', label: t('dashboard.nav.contracts', locale), icon: FileText },
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
  return (
    <AppShell
      area="dashboard"
      locale={locale}
      groups={groups}
      navigationUnavailable={
        !navigation || navigation.area !== 'customer' || !navigation.paths.length
      }
      profile={<ProfileSwitcher locale={locale} />}
      actions={<NotificationBell />}
      banners={
        <>
          <TosBanner locale={locale} />
          <InvitationBanner locale={locale} />
          <OwnershipBanner />
        </>
      }
    >
      <Outlet />
      {pathname !== '/ai' && <KnowledgeAssistantLauncher locale={locale} pathname={pathname} />}
    </AppShell>
  );
}
