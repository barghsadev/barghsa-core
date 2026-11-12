import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/finance/invoice-adjustment.test.ts',
      'src/finance/invoice-overpayment.test.ts',
      'src/finance/wallet-reconciliation.test.ts',
    ],
  },
});
