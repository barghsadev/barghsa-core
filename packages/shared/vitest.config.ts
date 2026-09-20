import { createVitestConfig } from '../tsconfig/vitest.base.config';

export default createVitestConfig({ test: { include: ['src/**/*.{test,spec}.ts'] } });
