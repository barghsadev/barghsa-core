import { describe, it, expect, vi } from 'vitest'
import { ConflictException } from '@nestjs/common'
import {
  bankReceiptAttachmentAdvisoryLockKeys,
  claimBankReceiptAttachment,
} from './claim-bank-receipt-attachment.js'

const ATTACHMENT = 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf'

describe('bankReceiptAttachmentAdvisoryLockKeys (T-04.3.01.02)', () => {
  it('derives a stable lock pair so wallet and invoice serialize on the same key', () => {
    const wallet = bankReceiptAttachmentAdvisoryLockKeys(ATTACHMENT)
    const invoice = bankReceiptAttachmentAdvisoryLockKeys(ATTACHMENT)
    expect(wallet).toEqual(invoice)
    expect(wallet).toHaveLength(2)
    expect(Number.isInteger(wallet[0])).toBe(true)
    expect(Number.isInteger(wallet[1])).toBe(true)
  })

  it('does not collide lock pairs across different attachment keys', () => {
    const other = 'uploads/document/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.pdf'
    expect(bankReceiptAttachmentAdvisoryLockKeys(ATTACHMENT)).not.toEqual(
      bankReceiptAttachmentAdvisoryLockKeys(other),
    )
  })
})

describe('claimBankReceiptAttachment (T-04.3.01.02)', () => {
  it('inserts then accepts a same-flow claim', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('INSERT INTO bank_receipt_attachment_claims')) {
        return { rows: [] }
      }
      if (sql.includes('FROM bank_receipt_attachment_claims')) {
        return { rows: [{ claim_type: 'invoice_receipt' }] }
      }
      return { rows: [] }
    })

    await expect(
      claimBankReceiptAttachment({ query }, 'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf', 'invoice_receipt'),
    ).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledTimes(2)
  })

  it('rejects a claim owned by the other flow', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM bank_receipt_attachment_claims')) {
        return { rows: [{ claim_type: 'wallet_topup' }] }
      }
      return { rows: [] }
    })

    await expect(
      claimBankReceiptAttachment(
        { query },
        'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
        'invoice_receipt',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('fails closed when the claim row cannot be read back', async () => {
    const query = vi.fn(async () => ({ rows: [] }))
    await expect(
      claimBankReceiptAttachment(
        { query },
        'uploads/document/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf',
        'wallet_topup',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})
