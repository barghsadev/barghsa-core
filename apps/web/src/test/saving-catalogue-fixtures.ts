import { catalogueId, hardwareId } from './catalogue-fixtures.js';
export const agreementId = '86000000-0000-4000-8000-000000000001';
export const savingAgreement = {
  id: agreementId,
  plan_id: catalogueId,
  title: 'Saved terms',
  body: 'Saved agreement text.',
  status: 'draft' as const,
  effective_from: null,
};
export const savingAgreementConfig = { planId: catalogueId, agreements: [savingAgreement] };
export const savingInventory = {
  hardwareId,
  stockTracking: true,
  stockCount: 10,
  reservedCount: 2,
  reservationMinutes: 30,
};
