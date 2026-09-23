import { getDbPool } from '@barghsa/db';
import { expireSavingInventory } from '@barghsa/db/saving-inventory';

export const SAVING_INVENTORY_EXPIRY_INTERVAL_MS = 60_000;
export const SAVING_INVENTORY_EXPIRY_JOB_TYPE = 'saving_inventory_expiry';

export function runSavingInventoryExpiry() {
  return expireSavingInventory(getDbPool());
}
