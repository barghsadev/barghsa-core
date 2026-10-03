import { z } from 'zod';
import { InputFieldException } from '../common/input-field.exception.js';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const modeKeys = [
  'mandatory_green_enabled',
  'mandatoryGreenEnabled',
  'average_power_threshold_kw',
  'averagePowerThresholdKw',
  'mandatory_green_share_percent',
  'mandatoryGreenSharePercent',
];
const modeSchema = z.object({
  Enabled: z.boolean(),
  Threshold: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  Share: z.number().min(0).max(100),
});

/** Match the existing snake/camel alias precedence; leave unowned errors to the service. */
export function assertGreenSettingsFields(body: unknown) {
  if (
    !record(body) ||
    Object.keys(body).some(
      (key) => !['simple_order', 'simpleOrder', 'advanced_order', 'advancedOrder'].includes(key)
    )
  )
    return;
  const modes = [body.simple_order ?? body.simpleOrder, body.advanced_order ?? body.advancedOrder];
  if (
    modes.some((mode) => !record(mode) || Object.keys(mode).some((key) => !modeKeys.includes(key)))
  )
    return;
  const fields: string[] = [];
  for (const [index, mode] of modes.entries()) {
    if (!record(mode)) return;
    const parsed = modeSchema.safeParse({
      Enabled: mode.mandatory_green_enabled ?? mode.mandatoryGreenEnabled,
      Threshold: mode.average_power_threshold_kw ?? mode.averagePowerThresholdKw,
      Share: mode.mandatory_green_share_percent ?? mode.mandatoryGreenSharePercent,
    });
    if (!parsed.success)
      fields.push(
        ...parsed.error.issues.map(
          (issue) => `${index === 0 ? 'simple' : 'advanced'}${String(issue.path[0])}`
        )
      );
  }
  if (fields.length) throw new InputFieldException(fields);
}
