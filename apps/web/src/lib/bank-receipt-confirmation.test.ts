import { describe, expect, it } from 'vitest'
import {
  isImageAttachment,
  isPdfAttachment,
  isTransactionUuid,
} from './bank-receipt-confirmation.js'

describe('staff bank-receipt confirmation helpers (T-04.2.02.04)', () => {
  it('accepts a UUID transaction id', () => {
    expect(isTransactionUuid('cccccccc-cccc-7ccc-8ccc-cccccccccccc')).toBe(true)
    expect(isTransactionUuid('not-a-uuid')).toBe(false)
  })

  it('classifies receipt attachment previews', () => {
    expect(isImageAttachment('uploads/image/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg')).toBe(true)
    expect(isPdfAttachment('uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')).toBe(true)
    expect(isImageAttachment('uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf')).toBe(false)
    expect(isPdfAttachment(null)).toBe(false)
  })
})
