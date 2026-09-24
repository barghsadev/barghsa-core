import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { tMaintenance } from '@barghsa/i18n/maintenance';
import { useLocale } from '../hooks/useLocale.js';
import type { PublicMaintenanceSetting } from '../hooks/useMaintenance.js';

export function AdminMaintenanceSummary() {
  const locale = useLocale();
  const [active, setActive] = useState<PublicMaintenanceSetting[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      try {
        const response = await fetch('/api/maintenance', { signal: controller.signal });
        if (!response.ok) return;
        const result = (await response.json()) as { capabilities: PublicMaintenanceSetting[] };
        if (!controller.signal.aborted && Array.isArray(result.capabilities))
          setActive(result.capabilities.filter((setting) => setting.active));
      } catch {
        // Dashboard alerts remain available if maintenance status cannot be read.
      }
    }
    void refresh();
    const interval = setInterval(() => void refresh(), 30_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  if (active.length === 0) return null;
  return (
    <section className="mb-6 rounded-lg border border-warning/30 bg-warning-soft p-4" role="status">
      <h2 className="font-semibold">{tMaintenance('adminTitle', locale)}</h2>
      <ul className="mt-2 flex flex-wrap gap-2 text-sm">
        {active.map((setting) => (
          <li key={setting.capability} className="rounded-full border border-warning/40 px-3 py-1">
            {tMaintenance(setting.capability, locale)}: {tMaintenance('active', locale)}
          </li>
        ))}
      </ul>
      <Link
        to="/admin/maintenance"
        className="mt-3 inline-block text-sm font-medium text-primary underline"
      >
        {tMaintenance('manage', locale)}
      </Link>
    </section>
  );
}
