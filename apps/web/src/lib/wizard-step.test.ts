import { expect, it } from 'vitest';
import { wizardStepSearch } from './wizard-step.js';

it('reads only a bounded whole step number and excludes private fields', () => {
  expect(wizardStepSearch({ step: '3', nationalId: 'private' }, 3)).toEqual({ step: 3 });
  expect(wizardStepSearch({ step: 5 }, 5)).toEqual({ step: 5 });
  expect(wizardStepSearch({ step: 5 }, 3)).toEqual({ step: 1 });
});
it.each([
  undefined,
  null,
  '',
  '0',
  0,
  -1,
  '2.5',
  2.5,
  '1e0',
  ' 2 ',
  '01',
  '2x',
  [],
  {},
  Infinity,
  '999999999999999999999999',
])('ignores invalid step %j', (step) => {
  expect(wizardStepSearch({ step }, 5)).toEqual({ step: 1 });
});
