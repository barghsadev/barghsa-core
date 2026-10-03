import { HttpException } from '@nestjs/common';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  isValidQuantityIncreasePercent,
  isValidContractDuration,
  isValidLeadTimeDays,
} from '@barghsa/shared/admin';
import {
  isValidWalletTopUpLimit,
  readExpectedWalletTopUpLimitVersion,
} from '@barghsa/shared/finance';
import { InputFieldException } from '../common/input-field.exception.js';

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const contractFields = [
  ['maxQuantityIncreasePercent', 'max_quantity_increase_percent', isValidQuantityIncreasePercent],
  ['maxContractDuration', 'max_contract_duration_months', isValidContractDuration],
  ['leadTimeDays', 'lead_time_days', isValidLeadTimeDays],
] as const;

/** Only expose public form field identifiers, preserving existing alias precedence. */
export function assertContractLimitFields(body: unknown) {
  if (
    !record(body) ||
    Object.keys(body).some(
      (key) => !contractFields.some(([camel, snake]) => key === camel || key === snake)
    )
  )
    throw new HttpException({ error: ErrorCodes.VALIDATION_INPUT_INVALID.code }, 400);
  const fields = contractFields
    .filter(([camel, snake, valid]) => !valid(body[snake] ?? body[camel]))
    .map(([camel]) => camel);
  if (fields.length) throw new InputFieldException(fields);
}

export function assertWalletLimitFields(body: unknown) {
  if (
    !record(body) ||
    Object.keys(body).some(
      (key) => !['limit_irr', 'limitIrR', 'expected_version', 'expectedVersion'].includes(key)
    ) ||
    !readExpectedWalletTopUpLimitVersion(body).ok
  )
    return;
  if (!isValidWalletTopUpLimit(body.limit_irr ?? body.limitIrR))
    throw new InputFieldException(['limitIrR']);
}
