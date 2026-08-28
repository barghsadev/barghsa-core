/**
 * Magic-byte content-type sniffer (T-09.12.05).
 *
 * The upload API is presigned-URL based: the browser PUTs the file
 * straight to object storage, so the API never sees the body at
 * presigned-url time. This sniffer closes that gap on the **verify**
 * seam: after the client confirms the upload, the API reads the FIRST
 * bytes of the stored object and detects the actual content type from
 * its magic bytes, comparing it against the allowed MIME set of the
 * effective upload policy ("validate both extension and detected
 * content type at upload").
 *
 * `sniffContentTypes` returns ALL candidate MIME types for the bytes
 * (unambiguous signatures yield one candidate; container formats such
 * as ZIP/OLE2/EBML can be several). `pickDetectedContentType` returns
 * the candidate that is allowed by the policy, or null when none is —
 * an upload whose real bytes match no permitted type is rejected as a
 * content-type mismatch even when its extension and claimed MIME were
 * accepted at presign time.
 *
 * Detection is signature-based (no dependency on the client-claimed
 * `Content-Type` header, which is spoofable). Only the first
 * `SNIFF_SAMPLE_BYTES` are inspected by the caller.
 */

/** How many leading bytes the caller should sample from the object. */
export const SNIFF_SAMPLE_BYTES = 4096

function bytesAt(bytes: Uint8Array, offset: number, signature: string): boolean {
  if (offset + signature.length > bytes.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature.charCodeAt(i)) return false
  }
  return true
}

function hasAscii(bytes: Uint8Array, needle: string, withinBytes: number): boolean {
  const limit = Math.min(bytes.length, withinBytes)
  if (limit < needle.length) return false
  for (let i = 0; i <= limit - needle.length; i++) {
    let match = true
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) {
        match = false
        break
      }
    }
    if (match) return true
  }
  return false
}

/** First non-whitespace code unit, or -1 when all leading bytes are whitespace. */
function firstNonWhitespaceByte(bytes: Uint8Array): number {
  const limit = Math.min(bytes.length, SNIFF_SAMPLE_BYTES)
  for (let i = 0; i < limit; i++) {
    const b = bytes[i]!
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return b
  }
  return -1
}

/** True when the sampled bytes contain a 0x00 (binary marker). */
function hasNulByte(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, SNIFF_SAMPLE_BYTES)
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true
  }
  return false
}

/**
 * Detect candidate MIME types from leading bytes of a file.
 *
 * Returns an array because some signatures are ambiguous (a ZIP can be a
 * .docx, .xlsx, or a plain archive; OLE2 is .doc or .xls; EBML is .webm
 * or .mkv). The caller intersects candidates with the policy's allowed
 * MIME set. Unknown bytes return an empty array.
 */
export function sniffContentTypes(bytes: Uint8Array): string[] {
  if (bytes.length === 0) return []

  if (bytes.length >= 5 && bytesAt(bytes, 0, '%PDF-')) return ['application/pdf']

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return ['image/jpeg']
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return ['image/png']
  }

  if (bytes.length >= 6 && (bytesAt(bytes, 0, 'GIF87a') || bytesAt(bytes, 0, 'GIF89a'))) {
    return ['image/gif']
  }

  // RIFF container: WEBP at bytes 8..12.
  if (bytes.length >= 12 && bytesAt(bytes, 0, 'RIFF') && bytesAt(bytes, 8, 'WEBP')) {
    return ['image/webp']
  }

  // ISO BMFF container (mp4/mov/avif): 'ftyp' brand at bytes 4..12.
  if (bytes.length >= 12 && bytesAt(bytes, 4, 'ftyp')) {
    const brand = String.fromCharCode(bytes[8]!, bytes[9]!, bytes[10]!, bytes[11]!)
    if (brand === 'avif' || brand === 'avis') return ['image/avif']
    if (brand === 'qt  ') return ['video/quicktime']
    return ['video/mp4']
  }

  // EBML container: webm (contains 'webm' marker) vs mkv.
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return hasAscii(bytes, 'webm', SNIFF_SAMPLE_BYTES) ? ['video/webm'] : ['video/x-matroska']
  }

  // ZIP container: office OpenXML documents and plain archives.
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
    return [
      'application/zip',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]
  }

  // OLE2 container: legacy .doc/.xls.
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return ['application/msword', 'application/vnd.ms-excel']
  }

  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return ['application/gzip']

  if (bytes.length >= 262 && bytesAt(bytes, 257, 'ustar')) return ['application/x-tar']

  // Textual files: JSON, SVG/XML, then a conservative utf-8-ish text probe.
  const first = firstNonWhitespaceByte(bytes)
  if (!hasNulByte(bytes)) {
    if (first === 0x7b || first === 0x5b) return ['application/json']
    if (hasAscii(bytes, '<svg', SNIFF_SAMPLE_BYTES)) return ['image/svg+xml']
    if (hasAscii(bytes, '<?xml', SNIFF_SAMPLE_BYTES)) return ['application/xml', 'text/xml']
    if (hasAscii(bytes, '<html', SNIFF_SAMPLE_BYTES)) return ['text/html']
    // Printable-text probe: reject control bytes outside tab/LF/CR so a
    // random binary blob is not classified as text.
    const limit = Math.min(bytes.length, SNIFF_SAMPLE_BYTES)
    let textual = true
    for (let i = 0; i < limit; i++) {
      const b = bytes[i]!
      if (b < 0x09 || (b > 0x0d && b < 0x20)) {
        textual = false
        break
      }
    }
    if (textual) return ['text/plain']
  }

  return []
}

/**
 * Pick the candidate detected content type that is allowed by the
 * effective policy's MIME set. Returns null when no candidate matches —
 * the upload's real bytes do not match any permitted type for the
 * category.
 */
export function pickDetectedContentType(
  candidates: readonly string[],
  allowedMimeTypes: readonly string[],
): string | null {
  for (const candidate of candidates) {
    if (allowedMimeTypes.includes(candidate)) return candidate
  }
  return null
}