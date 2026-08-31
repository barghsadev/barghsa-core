import { describe, expect, it } from 'vitest'
import { formatIrr, roleI18nKey, stateI18nKey } from './customer-invoices.js'

describe('customer invoice helpers (T-04.1.05.04)', () => {
  it('formats IRR amounts without using IEEE floats', () => {
    expect(formatIrr('2000000000000', 'en')).toBe('2,000,000,000,000')
  })

  it('maps roles and states to i18n keys', () => {
    expect(roleI18nKey('replacement')).toBe('invoices.details.role.replacement')
    expect(stateI18nKey('Cancelled')).toBe('invoices.state.Cancelled')
  })
})
