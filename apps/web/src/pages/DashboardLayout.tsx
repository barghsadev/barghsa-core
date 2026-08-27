import { Link, Outlet } from '@tanstack/react-router'
import { t, type Locale } from '@barghsa/i18n'
import { ProfileSwitcher } from '../components/ProfileSwitcher.js'
import { TosBanner } from '../components/TosBanner.js'
import { InvitationBanner } from '../components/InvitationBanner.js'
import { NotificationBell } from '../components/NotificationBell.js'

interface DashboardLayoutProps {
  locale?: Locale
}

/**
 * Customer dashboard layout (T-03.03.01).
 *
 * Renders the app shell for authenticated customer pages: a sidebar that
 * hosts the profile switcher at the top plus navigation, and the page
 * content below/next to it. Supports RTL via logical CSS properties.
 *
 * Nav links are intentionally spread across the app's customer areas. When
 * mobile the sidebar collapses to a horizontal strip via flex wrapping.
 */
export function DashboardLayout({ locale = 'fa' }: DashboardLayoutProps) {
  const isRtl = locale === 'fa'

  const navItems: Array<{ to: string; label: string }> = [
    { to: '/dashboard', label: t('dashboard.nav.overview', locale) },
    { to: '/electricity', label: t('dashboard.nav.electricity', locale) },
    { to: '/savings', label: t('dashboard.nav.savings', locale) },
    { to: '/wallet', label: t('dashboard.nav.wallet', locale) },
    { to: '/ai', label: t('dashboard.nav.ai', locale) },
    { to: '/documents', label: t('dashboard.nav.documents', locale) },
    { to: '/videos', label: t('dashboard.nav.videos', locale) },
    { to: '/notifications', label: t('notifications.nav', locale) },
    { to: '/settings', label: t('dashboard.nav.settings', locale) },
  ]

  return (
    <div className="min-h-dvh flex flex-col bg-gray-50" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* TOS re-acceptance banner — shown on top of the dashboard when needed */}
      <TosBanner locale={locale} />

      {/* Invitation banner — shows pending agent invitations */}
      <InvitationBanner locale={locale} />

      {/* App header — brand + notification center bell (T-05.02.03) */}
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3 md:px-6">
        <Link to="/" className="text-lg font-bold text-primary no-underline">
          {t('auth.brand.title', locale)}
        </Link>
        <NotificationBell />
      </header>

      {/* Main layout: sidebar + content */}
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-inset-end border-gray-200 bg-white p-4">
          <div className="space-y-4">
            {/* Profile switcher — top of sidebar */}
            <div className="border-b border-gray-200 pb-4">
              <ProfileSwitcher locale={locale} />
            </div>

            {/* Brand */}
            <Link to="/" className="block text-lg font-bold text-primary no-underline">
              {t('auth.brand.title', locale)}
            </Link>

            {/* Navigation */}
            <nav aria-label={t('dashboard.nav.label', locale)}>
              <ul className="space-y-1">
                {navItems.map((item) => (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      className="block rounded-md px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                      activeProps={{ className: 'bg-primary/10 text-primary font-medium' }}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}