import { createVitestConfig } from '../../packages/tsconfig/vitest.base.config'

export default createVitestConfig({
  test: {
    environment: 'jsdom',
  },
})