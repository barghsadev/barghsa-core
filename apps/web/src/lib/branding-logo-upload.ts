import { withCsrf } from './csrf.js';

export function isConversationPhoto(file: File): boolean {
  return (
    file.size > 0 &&
    file.size <= 2 * 1024 * 1024 &&
    /\.(png|jpe?g|webp)$/i.test(file.name) &&
    (!file.type || ['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
  );
}

export async function uploadConversationPhoto(file: File, signal: AbortSignal): Promise<string> {
  if (!isConversationPhoto(file)) throw new Error('INVALID_PHOTO');
  return uploadBrandingLogo(file, signal, 'conversation_avatar');
}

export async function uploadBrandingLogo(
  file: File,
  signal: AbortSignal,
  purpose: 'branding_logo' | 'conversation_avatar' = 'branding_logo'
): Promise<string> {
  const type =
    file.type ||
    (/\.png$/i.test(file.name)
      ? 'image/png'
      : /\.jpe?g$/i.test(file.name)
        ? 'image/jpeg'
        : /\.webp$/i.test(file.name)
          ? 'image/webp'
          : '');
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(type) ||
    file.size < 1 ||
    file.size > 2 * 1024 * 1024
  )
    throw new Error('INVALID_LOGO');
  const details = {
    fileName: file.name,
    contentType: type,
    fileSize: file.size,
    category: 'image',
  };
  const post = (url: string, body?: unknown) =>
    fetch(url, {
      method: 'POST',
      signal,
      headers: withCsrf({ 'Content-Type': 'application/json' }),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const response = await post('/api/upload/presigned-url', {
    ...details,
    purpose,
  });
  if (purpose === 'conversation_avatar' && [401, 403].includes(response.status))
    throw new Error('denied');
  if (!response.ok) throw new Error('UPLOAD_FAILED');
  const upload: unknown = await response.json();
  if (
    !upload ||
    typeof upload !== 'object' ||
    !('key' in upload) ||
    typeof upload.key !== 'string' ||
    !('presignedUrl' in upload) ||
    typeof upload.presignedUrl !== 'string'
  )
    throw new Error('UPLOAD_FAILED');
  const put = await fetch(upload.presignedUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': type, 'If-None-Match': '*' },
    signal,
  });
  if (!put.ok) throw new Error('UPLOAD_FAILED');
  const key = encodeURIComponent(upload.key);
  const verified = await post(`/api/upload/${key}/verify`);
  if (purpose === 'conversation_avatar' && [401, 403].includes(verified.status))
    throw new Error('denied');
  if (!verified.ok) throw new Error('UPLOAD_FAILED');
  const check: unknown = await verified.json();
  if (!check || typeof check !== 'object' || !('status' in check) || check.status !== 'confirmed')
    throw new Error('UPLOAD_FAILED');
  const record = await post(`/api/upload/${key}/record`, { ...details, purpose });
  if (purpose === 'conversation_avatar' && [401, 403].includes(record.status))
    throw new Error('denied');
  if (!record.ok) throw new Error('UPLOAD_FAILED');
  return upload.key;
}
