import { Link } from '@tanstack/react-router';
import { Wrench } from 'lucide-react';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { useLocale } from '../hooks/useLocale.js';
import type { PublicMaintenanceSetting } from '../hooks/useMaintenance.js';
import { staffDashboardReader, useStaffDashboardData } from '../hooks/useStaffDashboardData.js';
import { DashboardWidget } from './dashboard/DashboardWidget.js';

const capabilities = [
  'electricity_checkout',
  'saving_orders',
  'solar_requests',
  'wallet_topup',
  'ai_chat',
];
const readMaintenance = staffDashboardReader<PublicMaintenanceSetting[]>((value) => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('capabilities' in value) ||
    !Array.isArray(value.capabilities)
  )
    throw new Error('Invalid maintenance status');
  if (
    !value.capabilities.every(
      (setting) =>
        setting &&
        typeof setting === 'object' &&
        capabilities.includes(setting.capability) &&
        typeof setting.active === 'boolean'
    )
  )
    throw new Error('Invalid maintenance capability');
  return value.capabilities.filter((setting) => setting.active) as PublicMaintenanceSetting[];
});

export function AdminMaintenanceSummary() {
  const locale = useLocale();
  const resource = useStaffDashboardData('/api/maintenance', readMaintenance);
  if (!resource) return null;
  return (
    <DashboardWidget
      title={tMaintenance('adminTitle', locale)}
      icon={Wrench}
      locale={locale}
      resource={resource}
      empty={(active) => active.length === 0}
      emptyMessage={tMaintenance('noActive', locale)}
      viewAll={
        <Link to="/admin/maintenance" className="text-sm font-medium text-primary underline">
          {tMaintenance('manage', locale)}
        </Link>
      }
    >
      {(active) => (
        <section role="status" className="rounded-md border border-warning/30 bg-warning-soft p-3">
          <ul className="space-y-3 text-sm">
            {active.map((setting) => (
              <li key={setting.capability}>
                {tMaintenance(setting.capability, locale)}: {tMaintenance('active', locale)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </DashboardWidget>
  );
}
