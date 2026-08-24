/**
 * Upload configuration — allowed file types, size limits, and category mappings.
 * Configurable via environment variables with sensible defaults.
 */

// ---------------------------------------------------------------------------
// Allowed MIME types and extensions by category
// ---------------------------------------------------------------------------

interface UploadCategoryConfig {
  readonly allowedMimeTypes: ReadonlyArray<string>;
  readonly allowedExtensions: ReadonlyArray<string>;
  /** Maximum file size in bytes */
  readonly maxSizeBytes: number;
}

const MB = 1024 * 1024;

const DEFAULT_CATEGORIES: Record<string, UploadCategoryConfig> = {
  document: {
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain',
      'text/csv',
    ],
    allowedExtensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'],
    maxSizeBytes: 10 * MB,
  },
  image: {
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'image/avif',
    ],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.avif'],
    maxSizeBytes: 20 * MB,
  },
  contract: {
    allowedMimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    allowedExtensions: ['.pdf', '.doc', '.docx'],
    maxSizeBytes: 25 * MB,
  },
  general: {
    allowedMimeTypes: [
      'application/octet-stream',
      'application/json',
      'application/xml',
      'text/xml',
      'application/zip',
      'application/x-zip-compressed',
      'application/gzip',
      'application/x-tar',
      'application/pdf',
      'text/plain',
      'text/csv',
    ],
    allowedExtensions: [],
    maxSizeBytes: 50 * MB,
  },
};

// ---------------------------------------------------------------------------
// Category lookup helpers
// ---------------------------------------------------------------------------

export function getCategoryConfig(category?: string): UploadCategoryConfig {
  if (category && category in DEFAULT_CATEGORIES) {
    return DEFAULT_CATEGORIES[category]!;
  }
  return DEFAULT_CATEGORIES['general']!;
}

export function getMaxSizeBytes(category?: string): number {
  return getCategoryConfig(category).maxSizeBytes;
}

export function isAllowedMimeType(
  mimeType: string,
  category?: string,
): boolean {
  const cfg = getCategoryConfig(category);
  return cfg.allowedMimeTypes.includes(mimeType);
}

export function isAllowedExtension(
  fileName: string,
  category?: string,
): boolean {
  const ext = extractExtension(fileName);
  const cfg = getCategoryConfig(category);
  return cfg.allowedExtensions.length === 0 || cfg.allowedExtensions.includes(ext);
}

function extractExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return '';
  return fileName.slice(dot).toLowerCase();
}

export function getCategoryDescriptions(): Record<string, { readonly allowedExtensions: string; readonly maxSize: string }> {
  const result: Record<string, { allowedExtensions: string; maxSize: string }> = {};
  for (const [cat, cfg] of Object.entries(DEFAULT_CATEGORIES)) {
    result[cat] = {
      allowedExtensions:
        cfg.allowedExtensions.length > 0
          ? cfg.allowedExtensions.join(', ')
          : 'any',
      maxSize: `${cfg.maxSizeBytes / MB} MB`,
    };
  }
  return result;
}

/**
 * All categories for validation responses.
 */
export const UPLOAD_CATEGORIES = Object.freeze(Object.keys(DEFAULT_CATEGORIES));

// ---------------------------------------------------------------------------
// Environment overrides
// ---------------------------------------------------------------------------

/**
 * Resolve the default category for a given record type.
 * E.g. 'invoice' → 'document', 'contract' → 'contract', etc.
 */
export function resolveCategory(recordType?: string): string {
  if (!recordType) return 'general';
  const lower = recordType.toLowerCase();
  if (lower === 'contract' || lower === 'tos' || lower === 'agreement') {
    return 'contract';
  }
  if (lower === 'invoice' || lower === 'receipt' || lower === 'document') {
    return 'document';
  }
  if (lower === 'avatar' || lower === 'photo' || lower === 'image') {
    return 'image';
  }
  return 'general';
}