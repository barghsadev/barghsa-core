import { useEffect, useId, useRef, useState } from 'react';
import { useAccountUser } from './useAccountUser.js';
import { useProfileContextRevision } from '../lib/profile-context.js';
import { queryKeys } from '../lib/query-keys.js';
import { useServerDetailQuery } from './useServerQuery.js';

export type MaintenanceCapability =
  'electricity_checkout' | 'saving_orders' | 'solar_requests' | 'wallet_topup' | 'ai_chat';

export interface PublicMaintenanceSetting {
  capability: MaintenanceCapability;
  active: boolean;
  reason: { fa: string; en: string } | null;
  estimatedUntil: string | null;
}

export function useMaintenance(capability: MaintenanceCapability): PublicMaintenanceSetting | null {
  const reader = useId();
  const accountId = useAccountUser();
  const profileRevision = useProfileContextRevision();
  const ownerId = accountId?.trim() ? accountId : reader;
  const key = JSON.stringify([ownerId, accountId, profileRevision, capability]);
  const [accepted, setAccepted] = useState<{
    key: string;
    setting: PublicMaintenanceSetting | null;
  } | null>(null);
  const readOwner = useRef({ capability, revision: 0 });
  if (readOwner.current.capability !== capability)
    readOwner.current = { capability, revision: readOwner.current.revision + 1 };
  const query = useServerDetailQuery<PublicMaintenanceSetting | null>({
    queryKey: queryKeys.catalogue.detail(
      { context: 'account', ownerId, accountId, revision: profileRevision },
      JSON.stringify([
        'maintenance',
        capability,
        readOwner.current.revision === 0 ? 0 : [reader, readOwner.current.revision],
      ])
    ),
    manual: true,
    read: async (signal) => {
      const response = await fetch('/api/maintenance', { signal });
      if (!response.ok) throw new Error('maintenance');
      const { capabilities } = (await response.json()) as {
        capabilities: PublicMaintenanceSetting[];
      };
      return capabilities.find((item) => item.capability === capability) ?? null;
    },
  });
  useEffect(() => {
    if (query.isSuccess && !query.isFetching) setAccepted({ key, setting: query.data });
  }, [key, query.isSuccess, query.isFetching, query.data]);
  // This advisory read never substitutes for the server's authoritative write gate.
  return query.isSuccess && !query.isFetching
    ? query.data
    : accepted?.key === key
      ? accepted.setting
      : null;
}
