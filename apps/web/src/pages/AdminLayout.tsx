import { Outlet } from '@tanstack/react-router';
import {
  Activity,
  BadgeCheck,
  Bell,
  BellOff,
  Bot,
  ContactRound,
  Cpu,
  FileCheck,
  FilePenLine,
  FileText,
  GitCompareArrows,
  HardDrive,
  KeyRound,
  Layers,
  LayoutDashboard,
  Library,
  LifeBuoy,
  MapPin,
  Package,
  Palette,
  Percent,
  Plug,
  ReceiptText,
  ShieldCheck,
  SlidersHorizontal,
  TicketPercent,
  Timer,
  Upload,
  Users,
  UsersRound,
  Wallet,
  Zap,
} from 'lucide-react';
import { t } from '@barghsa/i18n/admin-ui';
import { shellText } from '@barghsa/i18n/shell';
import { TosBanner } from '../components/TosBanner.js';
import { useLocale } from '../hooks/useLocale.js';
import { AppShell, type NavigationGroup } from '../components/AppShell.js';

export default function AdminLayout() {
  const locale = useLocale();
  const groups: NavigationGroup[] = [
    {
      label: shellText('overview', locale),
      items: [{ to: '/admin', label: t('admin.nav.dashboard', locale), icon: LayoutDashboard }],
    },
    {
      label: shellText('operations', locale),
      items: [
        { to: '/admin/tickets', label: t('tickets.staffTitle', locale), icon: LifeBuoy },
        {
          to: '/admin/reconciliation',
          label: t('admin.reconciliation.title', locale),
          icon: GitCompareArrows,
        },
        { to: '/admin/service-targets', label: t('admin.targets.title', locale), icon: Timer },
        { to: '/admin/staff-teams', label: t('admin.teams.title', locale), icon: Users },
        {
          to: '/admin/failed-notifications',
          label: t('admin.notifications.deadLetter.title', locale),
          icon: BellOff,
        },
        { to: '/admin/failed-jobs', label: t('admin.jobs.title', locale), icon: Activity },
      ],
    },
    {
      label: shellText('finance', locale),
      items: [
        { to: '/admin/catalogue', label: t('admin.catalogue.title', locale), icon: Package },
        { to: '/admin/invoices', label: t('admin.nav.invoices', locale), icon: ReceiptText },
        {
          to: '/admin/wallet-receipts',
          label: t('admin.walletReceipts.nav', locale),
          icon: Wallet,
        },
        {
          to: '/admin/approval-requests',
          label: t('admin.approvals.title', locale),
          icon: BadgeCheck,
        },
        { to: '/admin/gift-codes', label: t('admin.gifts.title', locale), icon: TicketPercent },
        { to: '/admin/vat', label: t('admin.vat.title', locale), icon: Percent },
        {
          to: '/admin/contract-templates',
          label: t('admin.templates.title', locale),
          icon: FileText,
        },
        {
          to: '/admin/contract-limits',
          label: t('admin.contractLimits.title', locale),
          icon: SlidersHorizontal,
        },
        { to: '/admin/electricity-rules', label: t('admin.green.title', locale), icon: Zap },
      ],
    },
    {
      label: shellText('intelligence', locale),
      items: [
        { to: '/admin/agents', label: t('admin.agents.title', locale), icon: Bot },
        { to: '/admin/ai-models', label: t('admin.aiModels.title', locale), icon: Cpu },
        { to: '/admin/knowledge-bases', label: t('admin.kb.title', locale), icon: Library },
        { to: '/admin/policies', label: t('admin.policies.title', locale), icon: ShieldCheck },
        { to: '/admin/agent-slots', label: t('admin.slots.title', locale), icon: Layers },
      ],
    },
    {
      label: shellText('customers', locale),
      items: [
        { to: '/admin/crm', label: t('admin.nav.crmProfiles', locale), icon: ContactRound },
        {
          to: '/admin/crm/corrections',
          label: t('crm.corrections.title', locale),
          icon: FilePenLine,
        },
        { to: '/admin/users', label: t('admin.staff.title', locale), icon: UsersRound },
        { to: '/admin/roles', label: t('admin.nav.roles', locale), icon: KeyRound },
      ],
    },
    {
      label: shellText('configuration', locale),
      items: [
        { to: '/admin/branding', label: t('admin.nav.branding', locale), icon: Palette },
        { to: '/admin/geography', label: t('admin.nav.geography', locale), icon: MapPin },
        { to: '/admin/tos', label: t('admin.nav.tos', locale), icon: FileCheck },
        {
          to: '/admin/verification',
          label: t('admin.nav.verification', locale),
          icon: ShieldCheck,
        },
        { to: '/admin/notifications', label: t('admin.nav.notifications', locale), icon: Bell },
        { to: '/admin/providers', label: t('admin.nav.providers', locale), icon: Plug },
        {
          to: '/admin/upload-policies',
          label: t('admin.uploadPolicies.title', locale),
          icon: Upload,
        },
        { to: '/admin/storage', label: t('admin.nav.storage', locale), icon: HardDrive },
      ],
    },
  ];
  return (
    <AppShell area="admin" locale={locale} groups={groups} banners={<TosBanner locale={locale} />}>
      <Outlet />
    </AppShell>
  );
}
