import { z } from 'zod';
import { UPLOAD_CATEGORIES } from './upload.config.js';

/**
 * Schema for a presigned upload URL request.
 */
export const PresignedUrlRequestSchema = z
  .object({
    /**
     * Original file name (used to detect extension).
     */
    fileName: z.string().min(1).max(255),
    /**
     * MIME type declared by the client.
     */
    contentType: z.string().min(1).max(128),
    /**
     * File size in bytes.
     */
    fileSize: z.number().int().positive().max(50 * 1024 * 1024),
    /**
     * Upload category — determines allowed types and max size.
     */
    category: z.enum(UPLOAD_CATEGORIES as [string, ...string[]]).optional(),
    /**
     * Optional metadata for business-record association.
     */
    metadata: z
      .object({
        recordType: z.string().max(64).optional(),
        recordId: z.string().max(64).optional(),
        description: z.string().max(512).optional(),
      })
      .optional(),
  })
  .strict();

export type PresignedUrlRequest = z.infer<typeof PresignedUrlRequestSchema>;

/**
 * Response for a successful presigned URL generation.
 */
export interface PresignedUrlResponse {
  /** The S3 object key (logical, without configurable prefix). */
  key: string;
  /** The presigned URL the browser can PUT to. */
  presignedUrl: string;
  /** URL expiry in seconds. */
  expiresIn: number;
}

/**
 * Response for an upload verification.
 *
 * The category is re-derived server-side from the object key
 * (`uploads/<category>/<uuid><ext>`, bound at presign time) — see
 * `UploadController.verifyUpload`. Detection always runs:
 * - `confirmed` — object exists and detected content type is allowed;
 * - `type_mismatch` — object exists but its real bytes are not a
 *   permitted content type for the category (or carry no detectable
 *   signature — fail closed);
 * - `not_found` — object does not exist.
 *
 * `pending_scan` is retained for backward compatibility with legacy
 * callers; this endpoint no longer produces it (a client cannot opt out
 * of content-type detection).
 */
export interface VerifyUploadResponse {
  key: string;
  exists: boolean;
  status: 'pending_scan' | 'confirmed' | 'type_mismatch' | 'not_found';
  /** Detected content type (magic bytes) when detection ran, else null. */
  detectedContentType?: string | null;
  /** Allowed MIME types for the category, echoed on a type mismatch. */
  allowedMimeTypes?: string[];
}