import type { MultipartPart, StorageProvider } from './storage-provider.js';

export const MULTIPART_PART_SIZE = 5 * 1024 * 1024;

export interface MultipartUploadState {
  id: string;
  providerId?: string;
  status: 'starting' | 'in_progress' | 'completing' | 'completed' | 'aborting' | 'aborted';
  parts?: MultipartPart[];
  lastErrorCode?: string;
}

/** The completion intent contains the exact provider parts authorized by size. */
export function validMultipartParts(parts: MultipartPart[], fileSize: number): boolean {
  const count = Math.ceil(fileSize / MULTIPART_PART_SIZE);
  return (
    Number.isSafeInteger(fileSize) &&
    fileSize > MULTIPART_PART_SIZE &&
    parts.length === count &&
    parts.every(
      (part, index) =>
        part.partNumber === index + 1 &&
        typeof part.etag === 'string' &&
        part.etag.length > 0 &&
        part.size === Math.min(MULTIPART_PART_SIZE, fileSize - index * MULTIPART_PART_SIZE)
    )
  );
}

/** Retry the same upload and part identities after an uncertain provider response. */
export async function finishMultipartUpload(
  storage: StorageProvider,
  key: string,
  providerId: string,
  parts: MultipartPart[] | undefined,
  fileSize: number
): Promise<void> {
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize <= MULTIPART_PART_SIZE ||
    (parts && !validMultipartParts(parts, fileSize)) ||
    !storage.completeMultipartUpload
  )
    throw new Error('Invalid multipart completion intent');
  let failure: unknown = new Error('Completed multipart object is unavailable');
  if (parts) {
    try {
      await storage.completeMultipartUpload(key, providerId, parts);
      return;
    } catch (error) {
      failure = error;
    }
  }
  // A legacy completion may have lost its DB response before storing any parts.
  // Trusted use still requires MIME, byte-integrity, scan and sealing checks.
  const object = await storage.getObject(key).catch(() => null);
  if (!object) throw failure;
  const matches = object.contentLength === fileSize;
  await object.body.cancel();
  if (!matches) throw failure;
}
