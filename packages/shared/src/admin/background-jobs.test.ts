import { expect, it } from 'vitest';
import {
  backgroundJobLabel,
  isBackgroundJobStatus,
  isBackgroundJobType,
} from './background-jobs.js';

it('accepts refund retry monitoring and preserves labels for unknown historical job types', () => {
  expect(isBackgroundJobType('contract_completion')).toBe(true);
  expect(backgroundJobLabel('contract_completion')).toBe('Contract term completion');
  expect(isBackgroundJobType('contract_activation')).toBe(true);
  expect(backgroundJobLabel('contract_activation')).toBe('Contract activation');
  expect(isBackgroundJobType('electricity_increase_activation')).toBe(true);
  expect(backgroundJobLabel('electricity_increase_activation')).toBe(
    'Electricity increase activation'
  );
  expect(isBackgroundJobType('refund_retry')).toBe(true);
  expect(backgroundJobLabel('refund_retry')).toBe('Wallet refund retries');
  expect(isBackgroundJobType('retired_job')).toBe(false);
  expect(backgroundJobLabel('retired_job')).toBe('retired_job');
  expect(isBackgroundJobType(null)).toBe(false);
  expect(isBackgroundJobStatus('failed')).toBe(true);
  expect(isBackgroundJobStatus('completed')).toBe(false);
  expect(isBackgroundJobStatus(null)).toBe(false);
});
