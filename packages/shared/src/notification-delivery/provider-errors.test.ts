import { expect, it } from 'vitest';
import {
  classifyProviderError,
  isTransientEmailError,
  requiresProviderConfigurationFix,
} from './email-errors.js';
import { DeliveryRejected } from './execution.js';

it('classifies HTTP, SMTP and explicit rejection outcomes for retry decisions', () => {
  expect(classifyProviderError({ httpStatus: 503 })).toBe('transient');
  expect(classifyProviderError({ httpStatus: 429 })).toBe('transient');
  expect(classifyProviderError({ httpStatus: 401 })).toBe('permanent');
  expect(classifyProviderError({ responseCode: 421 })).toBe('transient');
  expect(classifyProviderError({ responseCode: 550 })).toBe('permanent');
  expect(classifyProviderError(new DeliveryRejected('Recipient refused'))).toBe('permanent');
  expect(classifyProviderError(new Error('Unknown provider result'))).toBe('unknown');
  expect(isTransientEmailError({ httpStatus: 503 })).toBe(true);
});

it('pauses confirmed configuration faults without promoting recipient or unknown failures', () => {
  for (const error of [
    { httpStatus: 401 },
    { httpStatus: 403, providerErrorName: 'suspended_api_key' },
    { httpStatus: 400, smsirStatus: 123 },
    ...[10, 11, 12, 13, 14, 101, 113, 119].map((smsirStatus) => ({ httpStatus: 400, smsirStatus })),
    { responseCode: 535, code: 'EAUTH' },
    { responseCode: 550, command: 'MAIL FROM' },
  ])
    expect(requiresProviderConfigurationFix(error)).toBe(true);
  for (const error of [
    { httpStatus: 403, providerErrorName: 'validation_error' },
    { responseCode: 550, command: 'RCPT TO' },
    { responseCode: 421, command: 'MAIL FROM' },
    { httpStatus: 503, smsirStatus: 123 },
    ...[102, 104, 114, 115, 117].map((smsirStatus) => ({ httpStatus: 400, smsirStatus })),
    new DeliveryRejected('Recipient refused'),
    new Error('invalid credentials'),
  ])
    expect(requiresProviderConfigurationFix(error)).toBe(false);
});
