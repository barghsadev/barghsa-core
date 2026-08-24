import { createVitestConfig } from '../tsconfig/vitest.base.config'

export default createVitestConfig({
  test: {
    environment: 'jsdom',
  },
})