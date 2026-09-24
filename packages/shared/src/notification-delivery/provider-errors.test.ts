import { expect, it } from 'vitest';
import { classifyProviderError, isTransientEmailError } from './email-errors.js';
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
