import { withCsrf } from './csrf.js';

export const documentKinds = [
  'standalone',
  'contract',
  'invoice',
  'order',
  'solar_request',
] as const;
export type DocumentKind = (typeof documentKinds)[number];
export const documentStates = [
  'Uploading',
  'PendingScan',
  'Available',
  'SubmittedForReview',
  'Approved',
  'Rejected',
  'Superseded',
  'Quarantined',
  'Removed',
] as const;
export type DocumentState = (typeof documentStates)[number];
export type DocumentAction =
  'submit' | 'approve' | 'reject' | 'request-changes' | 'quarantine' | 'remove';
export interface BusinessDocument {
  id: string;
  profileId: string;
  businessRecordType: DocumentKind;
  businessRecordId: string | null;
  contractVersionId: string | null;
  contractRole: 'original' | 'signed' | 'amendment' | 'superseded' | null;
  category: 'document' | 'image' | 'video' | 'contract';
  state: DocumentState;
  scanState?: 'Uploading' | 'Pending' | 'Available' | 'Quarantined';
  originalName: string;
  detectedMime: string | null;
  sizeBytes: number;
  checksum: string | null;
  uploadedBy: string;
  uploadedByType: 'customer' | 'staff' | 'system';
  supersedesDocumentId: string | null;
  rejectionReason: string | null;
  reviewComment: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export function isQuarantinedDocument(document: Pick<BusinessDocument, 'state' | 'scanState'>) {
  return document.state === 'Quarantined' || document.scanState === 'Quarantined';
}
export interface DocumentDetail extends BusinessDocument {
  history: Array<{
    id: string;
    revision: number;
    state: DocumentState;
    actorId: string;
    reason: string | null;
    createdAt: string;
  }>;
}
export interface DocumentPage {
  documents: BusinessDocument[];
  nextBefore: string | null;
}
export interface DocumentUpload {
  document: BusinessDocument;
  upload:
    | { presignedUrl: string; headers: Record<string, string> }
    | { uploadId: string; partSize: number; partCount: number };
}
export class DocumentRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null
  ) {
    super('Document request failed');
  }
}
export function documentBase(staff: boolean) {
  return staff ? '/api/admin/documents' : '/api/documents';
}
export async function documentRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers: withCsrf(headers),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = typeof data?.error === 'string' ? data.error : data?.error?.code;
    throw new DocumentRequestError(response.status, typeof code === 'string' ? code : null);
  }
  if (!data || typeof data !== 'object') throw new DocumentRequestError(502, null);
  return data as T;
}
/** Only storage URLs returned by the authorized API reach an anchor or preview. */
export function documentUrl(value: unknown): string {
  if (typeof value !== 'string') throw new DocumentRequestError(502, null);
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new DocumentRequestError(502, null);
  return url.href;
}
class StorageUploadError extends Error {
  constructor(readonly status: number) {
    super('Storage upload failed');
  }
}

export type UploadProgress = (loaded: number, total: number) => void;

/** XHR reports actual cross-origin transfer progress; same-origin fetch omits session cookies. */
async function putStorageBytes(
  url: string,
  body: Blob,
  headers: Record<string, string>,
  signal: AbortSignal,
  onProgress?: UploadProgress,
  writeOnce = false
) {
  const target = documentUrl(url);
  if (signal.aborted) throw new DOMException('Upload aborted', 'AbortError');
  onProgress?.(0, body.size);
  if (
    !onProgress ||
    typeof XMLHttpRequest === 'undefined' ||
    new URL(target).origin === window.location.origin
  ) {
    const result = await fetch(target, {
      method: 'PUT',
      credentials: 'omit',
      body,
      headers,
      signal,
    });
    if (!result.ok && !(writeOnce && result.status === 412))
      throw new StorageUploadError(result.status);
    onProgress?.(body.size, body.size);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: unknown) => {
      signal.removeEventListener('abort', abort);
      xhr.onload = xhr.onerror = xhr.onabort = xhr.ontimeout = null;
      xhr.upload.onprogress = null;
      if (error) reject(error);
      else resolve();
    };
    xhr.open('PUT', target);
    xhr.withCredentials = false;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (!signal.aborted) onProgress(Math.min(body.size, Math.max(0, event.loaded)), body.size);
    };
    xhr.onload = () => {
      if (signal.aborted) return finish(new DOMException('Upload aborted', 'AbortError'));
      if ((xhr.status >= 200 && xhr.status < 300) || (writeOnce && xhr.status === 412)) {
        onProgress(body.size, body.size);
        finish();
      } else finish(new StorageUploadError(xhr.status));
    };
    xhr.onerror = xhr.ontimeout = () => finish(new StorageUploadError(0));
    xhr.onabort = () => finish(new DOMException('Upload aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    try {
      xhr.send(body);
    } catch (error) {
      finish(error);
    }
  });
}
export async function putDocumentFile(
  upload: DocumentUpload['upload'],
  file: File,
  signal: AbortSignal,
  onProgress?: UploadProgress
) {
  if ('uploadId' in upload) {
    if (
      !Number.isSafeInteger(upload.partSize) ||
      upload.partSize < 1 ||
      !Number.isSafeInteger(upload.partCount) ||
      upload.partCount !== Math.ceil(file.size / upload.partSize)
    )
      throw new DocumentRequestError(502, null);
    const path = `/api/v1/files/upload/${encodeURIComponent(upload.uploadId)}`;
    const state = await documentRequest<{
      status: string;
      parts: Array<{ partNumber: number; size: number }>;
    }>(`${path}/parts`, { signal });
    if (state.status === 'completed') {
      onProgress?.(file.size, file.size);
      return;
    }
    if (state.status !== 'in_progress') throw new DocumentRequestError(409, null);
    if (!Array.isArray(state.parts)) throw new DocumentRequestError(502, null);
    const completed = new Set<number>();
    let loaded = 0;
    for (let number = 1; number <= upload.partCount; number++) {
      const size = Math.min(file.size, number * upload.partSize) - (number - 1) * upload.partSize;
      if (state.parts.some((part) => part.partNumber === number && part.size === size)) {
        completed.add(number);
        loaded += size;
      }
    }
    onProgress?.(loaded, file.size);
    for (let number = 1; number <= upload.partCount; number++) {
      if (completed.has(number)) continue;
      const start = (number - 1) * upload.partSize,
        end = Math.min(file.size, start + upload.partSize);
      const signed = await documentRequest<{ url: string }>(`${path}/part?partNumber=${number}`, {
        method: 'PUT',
        signal,
      });
      await putStorageBytes(
        signed.url,
        file.slice(start, end),
        {},
        signal,
        onProgress
          ? (partLoaded) => onProgress(Math.min(file.size, loaded + partLoaded), file.size)
          : undefined
      );
      loaded += end - start;
    }
    await documentRequest(`${path}/complete`, { method: 'POST', signal });
    return;
  }
  await putStorageBytes(upload.presignedUrl, file, upload.headers, signal, onProgress, true);
}
