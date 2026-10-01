export const templateId = '11111111-1111-4111-8111-111111111111';
export const contractTemplate = {
  id: templateId,
  name: 'Supply agreement',
  description: 'Electricity terms',
  status: 'active' as const,
  createdBy: 'staff',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  versionCount: 0,
  latestVersion: null,
};
export const templateVersion = {
  versionNumber: 1,
  storageKey: 'contract-templates/fixed',
  fileName: 'terms.txt',
  contentType: 'text/plain',
  fileSize: 14,
  placeholders: ['customer'],
  createdBy: 'staff',
  createdAt: '2026-09-01T00:00:00Z',
};
export const contractTemplateDetail = { ...contractTemplate, versions: [] };
export const electricityLimits = {
  maxQuantityIncreasePercent: 20,
  maxContractDuration: 24,
  leadTimeDays: 0,
};
