import { Outlet } from '@tanstack/react-router';
import {
  LayoutDashboard,
  Zap,
  Sprout,
  Wallet,
  ReceiptText,
  LifeBuoy,
  Bell,
  Users,
  Settings,
} from 'lucide-react';
import { t, type Locale } from '@barghsa/i18n/app';
import { shellText } from '@barghsa/i18n/shell';
import { useLocale } from '../hooks/useLocale.js';
import { ProfileSwitcher } from '../components/ProfileSwitcher.js';
import { TosBanner } from '../components/TosBanner.js';
import { InvitationBanner } from '../components/InvitationBanner.js';
import { OwnershipBanner } from '../components/OwnershipBanner.js';
import { NotificationBell } from '../components/NotificationBell.js';
import { AppShell, type NavigationGroup } from '../components/AppShell.js';

export function DashboardLayout({ locale: localeOverride }: { locale?: Locale }) {
  const currentLocale = useLocale();
  const locale = localeOverride ?? currentLocale;
  const groups: NavigationGroup[] = [
    {
      label: shellText('overview', locale),
      items: [
        { to: '/dashboard', label: t('dashboard.nav.overview', locale), icon: LayoutDashboard },
      ],
    },
    {
      label: shellText('services', locale),
      items: [
        { to: '/electricity', label: t('dashboard.nav.electricity', locale), icon: Zap },
        { to: '/savings', label: t('dashboard.nav.savings', locale), icon: Sprout },
        { to: '/wallet', label: t('dashboard.nav.wallet', locale), icon: Wallet },
        { to: '/invoices', label: t('dashboard.nav.invoices', locale), icon: ReceiptText },
        { to: '/tickets', label: t('tickets.title', locale), icon: LifeBuoy },
      ],
    },
    {
      label: shellText('account', locale),
      items: [
        { to: '/notifications', label: t('notifications.nav', locale), icon: Bell },
        { to: '/settings/team', label: t('team.title', locale), icon: Users },
        { to: '/settings', label: t('dashboard.nav.settings', locale), icon: Settings },
      ],
    },
  ];
  return (
    <AppShell
      area="dashboard"
      locale={locale}
      groups={groups}
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
    </AppShell>
  );
}
