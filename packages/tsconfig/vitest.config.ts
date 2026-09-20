import { createVitestConfig } from './vitest.base.config';

export default createVitestConfig({
  test: {
    include: ['*.test.ts'],
    coverage: { include: ['vitest.base.config.ts'] },
  },
});
