import { withCsrf } from './csrf.js';
import { DocumentRequestError } from './documents.js';
export const MAX_PDF_PREVIEW_BYTES = 10 * 1024 * 1024;

/** The authenticated renderer returns only a bounded PNG and persists no file. */
export async function selectedPdfPreview(file: File, signal: AbortSignal) {
  if (!file.size || file.size > MAX_PDF_PREVIEW_BYTES) throw new DocumentRequestError(413, null);
  const response = await fetch('/api/upload/preview', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: withCsrf(new Headers({ 'Content-Type': 'application/pdf' })),
    body: new Blob([file], { type: 'application/pdf' }),
    signal,
  });
  if (!response.ok) throw new DocumentRequestError(response.status, null);
  if (response.headers.get('content-type')?.split(';')[0] !== 'image/png')
    throw new DocumentRequestError(502, null);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (
    bytes.length > 5 * 1024 * 1024 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
  )
    throw new DocumentRequestError(502, null);
  return new Blob([bytes], { type: 'image/png' });
}
