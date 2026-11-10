import { describe, expect, it } from 'vitest';
import { isTransactionUuid } from './bank-receipt-confirmation.js';

describe('staff bank-receipt confirmation helpers (T-04.2.02.04)', () => {
  it('accepts a UUID transaction id', () => {
    expect(isTransactionUuid('cccccccc-cccc-7ccc-8ccc-cccccccccccc')).toBe(true);
    expect(isTransactionUuid('not-a-uuid')).toBe(false);
  });
});
