import { describe, it, expect } from 'vitest'
import { createDbPool } from './index'

describe('@barghsa/db', () => {
  it('export createDbPool is a function', () => {
    expect(typeof createDbPool).toBe('function')
  })
})