import { describe, it, expect } from 'vitest'
import {
  sniffContentTypes,
  pickDetectedContentType,
  SNIFF_SAMPLE_BYTES,
} from './content-type-sniffer.js'

/** Build a Uint8Array from a string (ASCII) or hex bytes. */
function bytes(ascii: string): Uint8Array {
  return new TextEncoder().encode(ascii)
}

function hex(parts: Array<number | string>): Uint8Array {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'number') out.push(part)
    else for (const ch of part) out.push(ch.charCodeAt(0))
  }
  return new Uint8Array(out)
}

function pick(fileBytes: Uint8Array, allowed: string[]): string | null {
  return pickDetectedContentType(sniffContentTypes(fileBytes), allowed)
}

describe('sniffContentTypes (T-09.12.05)', () => {
  it('detects PDF', () => {
    expect(sniffContentTypes(bytes('%PDF-1.7\n...'))).toEqual(['application/pdf'])
  })

  it('detects JPEG', () => {
    expect(sniffContentTypes(hex([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual(['image/jpeg'])
  })

  it('detects PNG', () => {
    expect(sniffContentTypes(hex([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toEqual(
      ['image/png'],
    )
  })

  it('detects GIF (87a and 89a)', () => {
    expect(sniffContentTypes(bytes('GIF87a...'))).toEqual(['image/gif'])
    expect(sniffContentTypes(bytes('GIF89a...'))).toEqual(['image/gif'])
  })

  it('detects WEBP', () => {
    expect(sniffContentTypes(bytes('RIFFxxxxWEBPVP8 '))).toEqual(['image/webp'])
  })

  it('detects AVIF from the ftyp brand', () => {
    expect(sniffContentTypes(bytes('\x00\x00\x00\x20ftypavif\x00\x00\x00\x00'))).toEqual([
      'image/avif',
    ])
  })

  it('detects MP4 vs QuickTime from the ftyp brand', () => {
    expect(sniffContentTypes(bytes('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00'))).toEqual([
      'video/mp4',
    ])
    expect(sniffContentTypes(bytes('\x00\x00\x00\x18ftypqt  \x00\x00\x00\x00'))).toEqual([
      'video/quicktime',
    ])
  })

  it('detects WebM vs Matroska from EBML', () => {
    const webm = [0x1a, 0x45, 0xdf, 0xa3] as number[]
    expect(sniffContentTypes(hex([...webm, ...'webm...']))).toEqual(['video/webm'])
    expect(sniffContentTypes(hex([...webm, ...'random-mkv-body']))).toEqual(['video/x-matroska'])
  })

  it('detects ZIP containers (office OpenXML candidates included)', () => {
    expect(sniffContentTypes(bytes('PK\x03\x04rest...'))).toEqual([
      'application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ])
  })

  it('detects OLE2 legacy office documents', () => {
    expect(sniffContentTypes(hex([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toEqual([
      'application/msword',
      'application/vnd.ms-excel',
    ])
  })

  it('detects gzip and tar', () => {
    expect(sniffContentTypes(hex([0x1f, 0x8b, 0x08, 0x00]))).toEqual(['application/gzip'])
    const tar = new Uint8Array(262)
    bytes('ustar').forEach((b, i) => (tar[257 + i] = b))
    expect(sniffContentTypes(tar)).toEqual(['application/x-tar'])
  })

  it('detects JSON, SVG, XML, and plain text', () => {
    expect(sniffContentTypes(bytes('{"a":1}'))).toEqual(['application/json'])
    expect(sniffContentTypes(bytes('  [1,2,3]'))).toEqual(['application/json'])
    expect(sniffContentTypes(bytes('<svg xmlns="http://www.w3.org/2000/svg">'))).toEqual([
      'image/svg+xml',
    ])
    expect(sniffContentTypes(bytes('<?xml version="1.0"?><root/>'))).toEqual([
      'application/xml',
      'text/xml',
    ])
    expect(sniffContentTypes(bytes('invoice number,amount\n1,200\n'))).toEqual(['text/plain'])
  })

  it('does not classify binary junk as text', () => {
    expect(sniffContentTypes(hex([0x00, 0x01, 0x02, 0xff, 0xfe]))).toEqual([])
  })

  it('returns no candidates for empty input', () => {
    expect(sniffContentTypes(new Uint8Array(0))).toEqual([])
  })
})

describe('pickDetectedContentType (T-09.12.05)', () => {
  const documentAllowed = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ]

  it('picks the allowed candidate for a docx zip', () => {
    expect(pick(bytes('PK\x03\x04...'), documentAllowed)).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  })

  it('picks pdf for a pdf', () => {
    expect(pick(bytes('%PDF-1.7'), documentAllowed)).toBe('application/pdf')
  })

  it('returns null when no candidate is permitted (e.g. exe-like bytes)', () => {
    expect(pick(hex([0x4d, 0x5a, 0x90, 0x00, 0x03]), documentAllowed)).toBeNull()
  })

  it('returns null when the real bytes are a permitted-extension but wrong type', () => {
    // a .pdf-named upload whose real bytes are a PNG
    expect(pick(hex([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), documentAllowed)).toBeNull()
    // a .jpg-named upload whose real bytes are a ZIP
    expect(pick(bytes('PK\x03\x04...'), documentAllowed)).not.toBeNull()
  })

  it('image category allows jpeg/png/webp/gif/svg/avif and rejects zip', () => {
    const imageAllowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/avif']
    expect(pick(hex([0xff, 0xd8, 0xff, 0xe0]), imageAllowed)).toBe('image/jpeg')
    expect(pick(bytes('RIFFxxxxWEBPVP8 '), imageAllowed)).toBe('image/webp')
    expect(pick(bytes('PK\x03\x04...'), imageAllowed)).toBeNull()
  })

  it('video category allows mp4/webm/quicktime and rejects image bytes', () => {
    const videoAllowed = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska']
    expect(pick(bytes('\x00\x00\x00\x18ftypisom\x00\x00\x00\x00'), videoAllowed)).toBe('video/mp4')
    expect(pick(bytes('\x00\x00\x00\x18ftypqt  \x00\x00\x00\x00'), videoAllowed)).toBe('video/quicktime')
    expect(pick(hex([0xff, 0xd8, 0xff, 0xe0]), videoAllowed)).toBeNull()
  })

  it('exposes the sample byte bound', () => {
    expect(SNIFF_SAMPLE_BYTES).toBe(4096)
  })
})