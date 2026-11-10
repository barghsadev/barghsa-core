import config from './vitest.config';

export default {
  ...config,
  test: { ...config.test, include: ['performance/weekly.perf.ts'], maxWorkers: 1 },
};
