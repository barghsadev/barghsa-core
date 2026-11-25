export const maintenanceCapabilities = [
  'electricity_checkout',
  'saving_orders',
  'solar_requests',
  'wallet_topup',
  'ai_chat',
] as const;

export type MaintenanceCapability = (typeof maintenanceCapabilities)[number];

export function isMaintenanceCapability(value: unknown): value is MaintenanceCapability {
  return (
    typeof value === 'string' && maintenanceCapabilities.some((capability) => capability === value)
  );
}
