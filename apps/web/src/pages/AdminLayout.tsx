import { useState } from 'react';
import { Button } from '@barghsa/ui';
import { Outlet } from '@tanstack/react-router';
import { t } from '@barghsa/i18n';
import { TosBanner } from '../components/TosBanner.js';
import { useLocale } from '../hooks/useLocale.js';

/**
 * Admin layout with sidebar — renders lazy child routes via Outlet.
 */
export default function AdminLayout() {
  const locale = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="flex flex-col h-dvh bg-gray-50" dir={locale === 'fa' ? 'rtl' : 'ltr'}>
      <a href="#admin-content" className="sr-only focus:not-sr-only focus:p-3">
        {t('shell.skipContent', locale)}
      </a>
      <TosBanner locale={locale} />
      <Button
        variant="outline"
        className="m-3 md:hidden"
        aria-expanded={menuOpen}
        aria-controls="admin-navigation"
        onClick={() => setMenuOpen((v) => !v)}
      >
        {t('shell.menu', locale)}
      </Button>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <aside
          id="admin-navigation"
          className={`${menuOpen ? 'block' : 'hidden'} max-h-[45dvh] w-full overflow-y-auto bg-white border-e border-gray-200 p-4 shrink-0 md:block md:max-h-none md:w-64`}
        >
          <nav aria-label={t('admin.nav.label', locale)}>
            <h2 className="text-lg font-semibold mb-4">{t('admin.nav.title', locale)}</h2>
            <ul className="space-y-2">
              <li>
                <a href="/admin/reconciliation" className="text-blue-600 hover:underline">
                  {t('admin.reconciliation.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin" className="text-blue-600 hover:underline">
                  {t('admin.nav.dashboard', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/service-targets" className="text-blue-600 hover:underline">
                  {t('admin.targets.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/staff-teams" className="text-blue-600 hover:underline">
                  {t('admin.teams.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/tickets" className="text-blue-600 hover:underline">
                  {t('tickets.staffTitle', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/users" className="text-blue-600 hover:underline">
                  {t('admin.staff.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/failed-notifications" className="text-blue-600 hover:underline">
                  {t('admin.notifications.deadLetter.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/failed-jobs" className="text-blue-600 hover:underline">
                  {t('admin.jobs.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/upload-policies" className="text-blue-600 hover:underline">
                  {t('admin.uploadPolicies.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/storage" className="text-blue-600 hover:underline">
                  {t('admin.nav.storage', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/verification" className="text-blue-600 hover:underline">
                  {t('admin.nav.verification', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/branding" className="text-blue-600 hover:underline">
                  {t('admin.nav.branding', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/geography" className="text-blue-600 hover:underline">
                  {t('admin.nav.geography', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/tos" className="text-blue-600 hover:underline">
                  {t('admin.nav.tos', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/notifications" className="text-blue-600 hover:underline">
                  {t('admin.nav.notifications', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/invoices" className="text-blue-600 hover:underline">
                  {t('admin.nav.invoices', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/wallet-receipts" className="text-blue-600 hover:underline">
                  {t('admin.walletReceipts.nav', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/approval-requests" className="text-blue-600 hover:underline">
                  {t('admin.approvals.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/providers" className="text-blue-600 hover:underline">
                  {t('admin.nav.providers', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/roles" className="text-blue-600 hover:underline">
                  {t('admin.nav.roles', locale)}
                </a>
              </li>
              <li className="pt-2 mt-2 border-t border-gray-100">
                <span className="text-xs text-gray-400 uppercase tracking-wide">
                  {t('admin.nav.crm', locale)}
                </span>
              </li>
              <li>
                <a href="/admin/crm/corrections" className="text-blue-600 hover:underline">
                  {t('crm.corrections.title', locale)}
                </a>
              </li>
              <li>
                <a href="/admin/crm" className="text-blue-600 hover:underline">
                  {t('admin.nav.crmProfiles', locale)}
                </a>
              </li>
            </ul>
          </nav>
        </aside>
        {/* Main content */}
        <main
          id="admin-content"
          tabIndex={-1}
          className="min-h-0 min-w-0 flex-1 overflow-auto p-4 md:p-8"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
