import type { SavingOperationStage } from './saving-staff-operation-form.js';
import { staffOrderId } from './staff-order-list-query.js';

export const savingOperations = {
  reject: 'reject',
  'request-confirmation': 'request_confirmation',
  'product-delivery': 'product_delivery',
  'installation-and-document-upload': 'installation_and_document_upload',
  'equipment-handover': 'equipment_handover',
  'process-completion': 'process_completion',
} satisfies Record<string, 'reject' | SavingOperationStage>;

export type SavingOperationRoute = keyof typeof savingOperations;
export const savingOperationPath = '/admin/saving-orders/$orderId/{-$operation}/{-$upgradeId}';

export function savingOperationRoute(value?: string): SavingOperationRoute | undefined {
  return value && Object.hasOwn(savingOperations, value)
    ? (value as SavingOperationRoute)
    : undefined;
}

export type SavingOrderEditor =
  | { kind: 'operation'; operation: SavingOperationRoute }
  | { kind: 'installation-address' | 'hardware' }
  | { kind: 'cancel-upgrade'; upgradeId: string };

export function savingOrderEditor(value?: string, target?: string): SavingOrderEditor | undefined {
  if (value === 'cancel-upgrade') {
    const upgradeId = staffOrderId(target).toLowerCase();
    return upgradeId ? { kind: value, upgradeId } : undefined;
  }
  if (target) return undefined;
  if (value === 'installation-address' || value === 'hardware') return { kind: value };
  const operation = savingOperationRoute(value);
  return operation ? { kind: 'operation', operation } : undefined;
}
