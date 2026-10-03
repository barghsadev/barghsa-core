import { HttpException } from '@nestjs/common';
import {
  SERVICE_RESPONSE_TARGET_TYPES,
  isValidServiceResponseTargetHours,
  isValidEscalationChannels,
} from '@barghsa/shared/admin';
import { ErrorCodes } from '@barghsa/shared/errors';
import { InputFieldException } from '../common/input-field.exception.js';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const generic = () => new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
/** Optional/null settings remain compatible; only public hour field IDs leave the server. */
export function assertServiceSettingsFields(body: unknown, kind: 'targets' | 'escalation') {
  if (
    !record(body) ||
    Object.keys(body).some((key) => !SERVICE_RESPONSE_TARGET_TYPES.some((type) => type === key))
  )
    throw generic();
  const fields: string[] = [];
  for (const type of SERVICE_RESPONSE_TARGET_TYPES) {
    const value = body[type],
      prefix = type === 'ticket' ? 'ticket' : 'verificationCase';
    if (value === undefined || value === null) continue;
    if (kind === 'targets') {
      if (!isValidServiceResponseTargetHours(value)) fields.push(`${prefix}Hours`);
    } else {
      if (!record(value)) throw generic();
      for (const tier of ['level2', 'level3'] as const) {
        const level = value[tier];
        if (!record(level)) throw generic();
        if (level.channels !== undefined && !isValidEscalationChannels(level.channels))
          throw generic();
        if (
          level.delayHours !== undefined &&
          level.delayHours !== null &&
          !isValidServiceResponseTargetHours(level.delayHours)
        )
          fields.push(`${prefix}${tier === 'level2' ? 'Level2' : 'Level3'}Hours`);
      }
    }
  }
  if (fields.length) throw new InputFieldException(fields);
}
