import { useEffect, useState } from 'react';

export type MaintenanceCapability =
  'electricity_checkout' | 'saving_orders' | 'solar_requests' | 'wallet_topup' | 'ai_chat';

export interface PublicMaintenanceSetting {
  capability: MaintenanceCapability;
  active: boolean;
  reason: { fa: string; en: string } | null;
  estimatedUntil: string | null;
}

export function useMaintenance(capability: MaintenanceCapability): PublicMaintenanceSetting | null {
  const [setting, setSetting] = useState<PublicMaintenanceSetting | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/maintenance', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('maintenance');
        return response.json() as Promise<{ capabilities: PublicMaintenanceSetting[] }>;
      })
      .then(({ capabilities }) => {
        if (!controller.signal.aborted)
          setSetting(capabilities.find((item) => item.capability === capability) ?? null);
      })
      .catch(() => {
        // The write gate remains authoritative if this advisory read is unavailable.
      });
    return () => controller.abort();
  }, [capability]);
  return setting;
}
