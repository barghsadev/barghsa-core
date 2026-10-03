import type { GreenSafety, TemplateSetting } from '../lib/electricity-settings-form.js';
export const greenConfig = {
  simpleOrder: {
    mandatoryGreenEnabled: true,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
  advancedOrder: {
    mandatoryGreenEnabled: false,
    averagePowerThresholdKw: 1000,
    mandatoryGreenSharePercent: 4,
  },
};
export const greenSafety: GreenSafety = {
  simpleOrder: { blocked: false, reasons: [] },
  advancedOrder: { blocked: false, reasons: [] },
};
export const templateId = '11111111-1111-4111-8111-111111111111';
export const inactiveTemplateId = '22222222-2222-4222-8222-222222222222';
export const templateSetting: TemplateSetting = {
  selectedVersionId: null,
  options: [
    { id: templateId, name: 'Supply agreement', versionNumber: 1, active: true, supported: true },
    {
      id: inactiveTemplateId,
      name: 'Retired agreement',
      versionNumber: 2,
      active: false,
      supported: true,
    },
  ],
};
