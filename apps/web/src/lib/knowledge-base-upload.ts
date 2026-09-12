import { withCsrf } from './csrf.js';

const documentTypes: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
  csv: 'text/csv',
};
export const KNOWLEDGE_DOCUMENT_ACCEPT = Object.keys(documentTypes)
  .map((ext) => `.${ext}`)
  .join(',');

async function post(path: string, body: unknown, signal: AbortSignal) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: withCsrf({ Accept: 'application/json', 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('Upload request failed');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Invalid upload response');
  return data as Record<string, unknown>;
}

export async function uploadKnowledgeDocument(file: File, signal: AbortSignal): Promise<string> {
  const contentType = documentTypes[file.name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!contentType || file.size === 0) throw new Error('Unsupported document');
  const details = { fileName: file.name, contentType, fileSize: file.size, category: 'document' };
  const signed = await post(
    '/api/upload/presigned-url',
    {
      ...details,
      metadata: { recordType: 'document' },
    },
    signal
  );
  if (
    typeof signed.key !== 'string' ||
    !/^uploads\/document\/[\w.-]+$/.test(signed.key) ||
    signed.key.includes('..') ||
    typeof signed.presignedUrl !== 'string'
  )
    throw new Error('Invalid upload target');
  const target = new URL(signed.presignedUrl);
  if (!['https:', 'http:'].includes(target.protocol) || target.username || target.password)
    throw new Error('Invalid upload target');
  const put = await fetch(target, {
    method: 'PUT',
    body: file,
    signal,
    credentials: 'omit',
    headers: { 'Content-Type': contentType },
  });
  if (!put.ok) throw new Error('Upload failed');
  const path = `/api/upload/${encodeURIComponent(signed.key)}`;
  const verified = await post(`${path}/verify`, {}, signal);
  if (verified.key !== signed.key || verified.status !== 'confirmed' || verified.exists !== true)
    throw new Error('Document verification failed');
  const recorded = await post(`${path}/record`, { ...details, purpose: 'knowledge_base' }, signal);
  if (recorded.key !== signed.key || recorded.status !== 'recorded')
    throw new Error('Document save unconfirmed');
  return signed.key;
}
