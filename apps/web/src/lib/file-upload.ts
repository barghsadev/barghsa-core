export interface FileUploadPolicy {
  formats: Array<{ extension: string; mimeTypes: string[] }>;
  maxSizeBytes: number;
}
export type FileValidationError = {
  code: 'count' | 'empty' | 'type' | 'size' | 'name';
  file?: File;
};
export function readFileUploadPolicy(raw: unknown): FileUploadPolicy | null {
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('formats' in raw) ||
    !Array.isArray(raw.formats) ||
    !('maxSizeBytes' in raw) ||
    !Number.isSafeInteger(raw.maxSizeBytes) ||
    Number(raw.maxSizeBytes) < 1 ||
    Number(raw.maxSizeBytes) > 100 * 1024 * 1024 ||
    raw.formats.length > 50
  )
    return null;
  const formats: FileUploadPolicy['formats'] = [];
  for (const format of raw.formats) {
    if (
      !format ||
      typeof format !== 'object' ||
      typeof format.extension !== 'string' ||
      !/^\.[a-z0-9]{1,10}$/.test(format.extension) ||
      !Array.isArray(format.mimeTypes) ||
      !format.mimeTypes.length ||
      format.mimeTypes.length > 20 ||
      !format.mimeTypes.every(
        (mime: unknown) => typeof mime === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime)
      )
    )
      return null;
    formats.push({ extension: format.extension, mimeTypes: [...format.mimeTypes] });
  }
  return { formats, maxSizeBytes: Number(raw.maxSizeBytes) };
}
export function uploadContentType(file: File, policy: FileUploadPolicy) {
  const format = policy.formats.find(
    (item) => item.extension === file.name.slice(file.name.lastIndexOf('.')).toLowerCase()
  );
  if (!format) return null;
  return file.type
    ? format.mimeTypes.includes(file.type)
      ? file.type
      : null
    : (format.mimeTypes[0] ?? null);
}
export function validateUploadFiles(
  files: readonly File[],
  policy: FileUploadPolicy,
  maxFiles: number
): FileValidationError | null {
  if (files.length > maxFiles || maxFiles < 1) return { code: 'count' };
  for (const file of files) {
    if (!file.name.trim() || file.name.length > 255) return { code: 'name', file };
    if (!Number.isSafeInteger(file.size) || file.size < 1) return { code: 'empty', file };
    if (!uploadContentType(file, policy)) return { code: 'type', file };
    if (file.size > policy.maxSizeBytes) return { code: 'size', file };
  }
  return null;
}
