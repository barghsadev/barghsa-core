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
export async function putDocumentFile(
  upload: DocumentUpload['upload'],
  file: File,
  signal: AbortSignal
) {
  if ('uploadId' in upload) {
    const path = `/api/v1/files/upload/${encodeURIComponent(upload.uploadId)}`;
    const state = await documentRequest<{
      status: string;
      parts: Array<{ partNumber: number; size: number }>;
    }>(`${path}/parts`, { signal });
    if (state.status === 'completed') return;
    if (state.status !== 'in_progress') throw new DocumentRequestError(409, null);
    for (let number = 1; number <= upload.partCount; number++) {
      const start = (number - 1) * upload.partSize;
      const end = Math.min(file.size, start + upload.partSize);
      if (state.parts.some((part) => part.partNumber === number && part.size === end - start))
        continue;
      const signed = await documentRequest<{ url: string }>(`${path}/part?partNumber=${number}`, {
        method: 'PUT',
        signal,
      });
      const part = await fetch(documentUrl(signed.url), {
        method: 'PUT',
        credentials: 'omit',
        body: file.slice(start, end),
        signal,
      });
      if (!part.ok) throw new DocumentRequestError(part.status, null);
    }
    await documentRequest(`${path}/complete`, { method: 'POST', signal });
    return;
  }
  const response = await fetch(documentUrl(upload.presignedUrl), {
    method: 'PUT',
    credentials: 'omit',
    headers: upload.headers,
    body: file,
    signal,
  });
  // The write-once upload may already have succeeded before its response was lost.
  // Confirmation still performs server-side inspection of the owned stored bytes.
  if (!response.ok && response.status !== 412)
    throw new DocumentRequestError(response.status, null);
}
