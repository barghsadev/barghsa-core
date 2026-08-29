import { describe, it, expect } from 'vitest'
import {
  isUploadPolicyCategory,
  isValidPolicyExtension,
  normalizePolicyExtensions,
  uploadPolicyWindowStatus,
  UPLOAD_POLICY_CATEGORIES,
  MAX_UPLOAD_POLICY_EXTENSIONS,
  GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES,
  MIN_UPLOAD_POLICY_SIZE_BYTES,
} from './upload-policies.js'

describe('upload policy categories (T-09.12.05)', () => {
  it('exposes the canonical admin category set (documents, images, videos)', () => {
    expect(UPLOAD_POLICY_CATEGORIES).toEqual(['document', 'image', 'video'])
  })

  it('recognizes only canonical categories', () => {
    expect(isUploadPolicyCategory('document')).toBe(true)
    expect(isUploadPolicyCategory('image')).toBe(true)
    expect(isUploadPolicyCategory('video')).toBe(true)
    expect(isUploadPolicyCategory('contract')).toBe(false)
    expect(isUploadPolicyCategory('general')).toBe(false)
    expect(isUploadPolicyCategory('')).toBe(false)
    expect(isUploadPolicyCategory(42)).toBe(false)
  })
})

describe('extension whitelist validation (T-09.12.05)', () => {
  it('accepts lowercase dotted extension tokens', () => {
    expect(isValidPolicyExtension('.pdf')).toBe(true)
    expect(isValidPolicyExtension('.docx')).toBe(true)
    expect(isValidPolicyExtension('.mp4')).toBe(true)
    expect(isValidPolicyExtension('.jpeg')).toBe(true)
  })

  it('rejects uppercase, dotless, empty, and overlong tokens', () => {
    expect(isValidPolicyExtension('.PDF')).toBe(false)
    expect(isValidPolicyExtension('pdf')).toBe(false)
    expect(isValidPolicyExtension('.')).toBe(false)
    expect(isValidPolicyExtension('')).toBe(false)
    expect(isValidPolicyExtension('.this-extension-is-way-too-long')).toBe(false)
    expect(isValidPolicyExtension('.a/b')).toBe(false)
    expect(isValidPolicyExtension('..pdf')).toBe(false)
    expect(isValidPolicyExtension((undefined as unknown) as string)).toBe(false)
  })

  it('normalizes: trims, lowercases, drops invalid tokens, dedupes in order', () => {
    expect(normalizePolicyExtensions(['.PDF', ' .png ', 'png', '.docx', '.PDF'])).toEqual([
      '.pdf',
      '.png',
      '.docx',
    ])
  })

  it('normalize keeps valid order of first occurrence', () => {
    expect(normalizePolicyExtensions(['.txt', '.pdf', '.txt'])).toEqual(['.txt', '.pdf'])
  })

  it('caps the distinct extension count at the shared bound', () => {
    expect(MAX_UPLOAD_POLICY_EXTENSIONS).toBe(50)
  })
})

describe('size bounds (T-09.12.05)', () => {
  it('exposes the deployment-safe hard cap', () => {
    expect(MIN_UPLOAD_POLICY_SIZE_BYTES).toBe(1)
    expect(GLOBAL_MAX_UPLOAD_POLICY_SIZE_BYTES).toBe(100 * 1024 * 1024)
  })
})

describe('uploadPolicyWindowStatus (T-09.12.05)', () => {
  const at = new Date('2026-08-28T12:00:00.000Z')

  it('marks an open past-dated window as current', () => {
    expect(uploadPolicyWindowStatus('2026-01-01T00:00:00.000Z', null, at)).toBe('current')
  })

  it('marks a future-dated window as scheduled', () => {
    expect(uploadPolicyWindowStatus('2026-09-01T00:00:00.000Z', null, at)).toBe('scheduled')
  })

  it('marks an ended window as expired', () => {
    expect(
      uploadPolicyWindowStatus('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z', at),
    ).toBe('expired')
  })
})
