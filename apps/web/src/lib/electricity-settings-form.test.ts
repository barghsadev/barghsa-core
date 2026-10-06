import { expect, it } from 'vitest';
import { boundedCatalogueInteger } from './catalogue-form.js';
import {
  greenSettingsSchema,
  retentionSettingsSchema,
  templateSettingsSchema,
} from './catalogue-form-schemas.js';
import {
  greenValues,
  greenBody,
  validGreenConfig,
  validGreenSafety,
  matchesGreenReceipt,
  validRetention,
  validTemplateSetting,
  templateBasis,
  matchesTemplateReceipt,
} from './electricity-settings-form.js';
import {
  greenConfig,
  greenSafety,
  templateSetting,
  templateId,
  inactiveTemplateId,
} from '../test/electricity-settings-fixtures.js';
const messages = {
  simpleEnabled: 'enabled',
  simpleThreshold: 'threshold',
  simpleShare: 'share',
  advancedEnabled: 'enabled',
  advancedThreshold: 'threshold',
  advancedShare: 'share',
};
it.each([' ۰۰۰ ', '١٧٥٠', '9007199254740991'])('accepts exact localized thresholds %s', (value) => {
  expect(boundedCatalogueInteger(value, 0, Number.MAX_SAFE_INTEGER)).not.toBeNull();
});
it.each(['', '-1', '1.5', '1e3', '9007199254740992'])(
  'rejects invalid thresholds %s without rounding',
  (value) => {
    expect(boundedCatalogueInteger(value, 0, Number.MAX_SAFE_INTEGER)).toBeNull();
  }
);
it('reports thresholds and shares separately, and zero share does not activate a blocked rule', () => {
  const safety = { ...greenSafety, simpleOrder: { blocked: true, reasons: ['inactive'] } };
  const schema = greenSettingsSchema(messages, boundedCatalogueInteger, safety);
  const draft = { ...greenValues(greenConfig), simpleThreshold: '-1', advancedShare: 101 };
  const invalid = schema.safeParse(draft);
  expect(invalid.success).toBe(false);
  if (!invalid.success)
    expect(invalid.error.issues.map((issue) => issue.path)).toEqual([
      ['simpleThreshold'],
      ['simpleEnabled'],
      ['advancedShare'],
    ]);
  expect(schema.safeParse({ ...greenValues(greenConfig), simpleShare: 0 }).success).toBe(true);
  expect(schema.safeParse({ ...greenValues(greenConfig), simpleEnabled: false }).success).toBe(
    true
  );
});
it('retention is a whole localized value and template selection must remain eligible', () => {
  const ttl = retentionSettingsSchema({ days: 'days' }, boundedCatalogueInteger);
  expect(ttl.safeParse({ days: ' ٣٦٥ ' }).success).toBe(true);
  for (const days of ['0', '366', '1.5']) expect(ttl.safeParse({ days }).success).toBe(false);
  const template = templateSettingsSchema({ versionId: 'template' }, templateSetting.options);
  for (const versionId of [null, templateId])
    expect(template.safeParse({ versionId }).success).toBe(true);
  for (const versionId of [inactiveTemplateId, 'unknown'])
    expect(template.safeParse({ versionId }).success).toBe(false);
});
it('rejects malformed reads and verifies all captured save values', () => {
  expect(
    validGreenSafety({
      ...greenSafety,
      simpleOrder: { blocked: true, reasons: ['limits_incompatible'] },
    })
  ).toBe(true);
  expect(validGreenConfig(greenConfig)).toBe(true);
  expect(
    validGreenConfig({
      ...greenConfig,
      simpleOrder: { ...greenConfig.simpleOrder, averagePowerThresholdKw: 1.5 },
    })
  ).toBe(false);
  expect(validGreenSafety({ ...greenSafety, simpleOrder: { blocked: true, reasons: [] } })).toBe(
    false
  );
  expect(
    validGreenSafety({ ...greenSafety, simpleOrder: { blocked: false, reasons: ['secret'] } })
  ).toBe(false);
  expect(validRetention({ days: 366 })).toBe(false);
  const body = greenBody({ ...greenValues(greenConfig), simpleThreshold: ' ۱۷۵۰ ' });
  expect(body.simpleOrder.averagePowerThresholdKw).toBe(1750);
  expect(matchesGreenReceipt(body, body)).toBe(true);
  expect(matchesGreenReceipt(greenConfig, body)).toBe(false);
  expect(
    validTemplateSetting({
      ...templateSetting,
      options: [...templateSetting.options, templateSetting.options[0]],
    })
  ).toBe(false);
  expect(validTemplateSetting({ ...templateSetting, selectedVersionId: 'missing' })).toBe(false);
  expect(
    matchesTemplateReceipt(
      { ...templateSetting, selectedVersionId: templateId },
      { versionId: templateId }
    )
  ).toBe(true);
  expect(
    matchesTemplateReceipt(
      { ...templateSetting, selectedVersionId: inactiveTemplateId },
      { versionId: inactiveTemplateId }
    )
  ).toBe(false);
  expect(matchesTemplateReceipt(templateSetting, { versionId: templateId })).toBe(false);
  expect(
    templateBasis({
      ...templateSetting,
      options: [...templateSetting.options].reverse().map(({ id, ...rest }) => ({ ...rest, id })),
    })
  ).toBe(templateBasis(templateSetting));
});
