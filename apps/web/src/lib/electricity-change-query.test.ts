import { expect, it } from 'vitest';
import { electricityIncreaseSearch, electricityPriceSearch } from './electricity-change-query.js';
import { changeContractId, changeCursor } from '../test/electricity-change-fixtures.js';

it('retains only public increase scope and price selection', () => {
  expect(
    electricityIncreaseSearch({
      status: 'expired',
      cursor: changeCursor,
      reason: 'private',
      effectiveFrom: 'private',
      password: 'private',
    })
  ).toEqual({ status: 'expired', cursor: changeCursor });
  expect(
    electricityPriceSearch({
      contractId: changeContractId,
      reason: 'private',
      percentage: 'private',
      contractualBasis: 'private',
      cursor: changeCursor,
    })
  ).toEqual({ contractId: changeContractId });
});
it.each([undefined, null, [], {}, 'other', ' expired', 'EXPIRED'])(
  'defaults invalid increase status %j',
  (status) => {
    expect(electricityIncreaseSearch({ status }).status).toBeUndefined();
  }
);
it.each(['private', ' ' + changeContractId, [changeContractId], {}, 12])(
  'refuses invalid public identifiers %j',
  (value) => {
    expect(electricityIncreaseSearch({ cursor: value }).cursor).toBeUndefined();
    expect(electricityPriceSearch({ contractId: value }).contractId).toBeUndefined();
  }
);
