import { describe, it, expect } from 'vitest'
import {
  extractContractTemplatePlaceholders,
  MAX_CONTRACT_TEMPLATE_PLACEHOLDERS,
} from './contract-templates.js'

describe('extractContractTemplatePlaceholders (T-09.12.04)', () => {
  it('extracts simple placeholders from plain text', () => {
    const content = 'Hello {{customerName}}, your bill of {{amount}} is due on {{date}}.'
    expect(extractContractTemplatePlaceholders(content)).toEqual([
      'customerName',
      'amount',
      'date',
    ])
  })

  it('tolerates whitespace inside the braces', () => {
    const content = '{{ customerName }} and {{amount}}'
    expect(extractContractTemplatePlaceholders(content)).toEqual([
      'customerName',
      'amount',
    ])
  })

  it('deduplicates while preserving first-occurrence order', () => {
    const content = '{{date}} then {{amount}} then {{date}} again'
    expect(extractContractTemplatePlaceholders(content)).toEqual(['date', 'amount'])
  })

  it('accepts names with digits and underscore but requires a letter start', () => {
    expect(extractContractTemplatePlaceholders('{{panNo2}} {{_hidden}} {{2fa}}')).toEqual([
      'panNo2',
    ])
  })

  it('returns an empty array for content without placeholders', () => {
    expect(extractContractTemplatePlaceholders('no tokens here {{ broken')).toEqual([])
    expect(extractContractTemplatePlaceholders('')).toEqual([])
  })

  it('keeps the running total to a bound no matter the file size', () => {
    const content = Array.from(
      { length: MAX_CONTRACT_TEMPLATE_PLACEHOLDERS + 50 },
      (_, i) => `{{p${i}}}`,
    ).join(' ')
    const result = extractContractTemplatePlaceholders(content)
    expect(result.length).toBe(MAX_CONTRACT_TEMPLATE_PLACEHOLDERS)
  })
})