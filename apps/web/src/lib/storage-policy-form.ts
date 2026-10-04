import type { UploadPolicyDto } from '@barghsa/shared/admin';
import { MAX_UPLOAD_POLICY_EXTENSIONS } from '@barghsa/shared/admin';

export const storageTextFields = [
  'endpoint',
  'region',
  'bucket',
  'accessKeyId',
  'privateEndpointUrl',
  'publicEndpointUrl',
] as const;
export type StorageConfigView = Record<(typeof storageTextFields)[number], string> & {
  forcePathStyle: boolean;
  hasSecretKey: boolean;
  version: number;
};
export type StorageDraft = Omit<StorageConfigView, 'hasSecretKey' | 'version'> & {
  secretAccessKey: string;
  clearSecret: boolean;
};
export type CleanupPolicyView = { hours: number; version: number };
export type CleanupDraft = { hours: string };
export type UploadLimit = { category: string; allowedExtensions: string[]; maxSizeBytes: number };
export type UploadPolicyDraft = { extensions: string[]; size: string };
export const mib = 1024 * 1024;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
export function validStorageConfig(value: unknown): value is StorageConfigView {
  return (
    record(value) &&
    storageTextFields.every((field) => typeof value[field] === 'string') &&
    typeof value.forcePathStyle === 'boolean' &&
    typeof value.hasSecretKey === 'boolean' &&
    integer(value.version, 0)
  );
}
export function validCleanupPolicy(value: unknown): value is CleanupPolicyView {
  return (
    record(value) && integer(value.version, 0) && integer(value.hours, 1) && value.hours <= 168
  );
}
export const emptyStorageDraft = (): StorageDraft => ({
  endpoint: '',
  region: '',
  bucket: '',
  accessKeyId: '',
  forcePathStyle: false,
  privateEndpointUrl: '',
  publicEndpointUrl: '',
  secretAccessKey: '',
  clearSecret: false,
});
export function storageDraft(config: StorageConfigView): StorageDraft {
  const { hasSecretKey: _masked, version: _version, ...fields } = config;
  return { ...fields, secretAccessKey: '', clearSecret: false };
}
function validOrigin(value: string) {
  if (value.length > 2048) return false;
  if (!value) return true;
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.pathname === '/' || url.pathname === '')
    );
  } catch {
    return false;
  }
}
export function storageInvalidFields(
  draft: StorageDraft,
  saved: StorageConfigView | null
): (keyof StorageDraft)[] {
  const invalid: (keyof StorageDraft)[] = [];
  for (const field of ['endpoint', 'privateEndpointUrl', 'publicEndpointUrl'] as const)
    if (!validOrigin(draft[field])) invalid.push(field);
  if (!draft.region.trim() || draft.region.trim().length > 128) invalid.push('region');
  if (!draft.bucket.trim() || draft.bucket.trim().length > 255) invalid.push('bucket');
  if (draft.accessKeyId.length > 256) invalid.push('accessKeyId');
  if (draft.secretAccessKey.length > 4096) invalid.push('secretAccessKey');
  const hasSecret = !draft.clearSecret && (!!draft.secretAccessKey || !!saved?.hasSecretKey);
  if (!!draft.accessKeyId !== hasSecret) invalid.push('accessKeyId', 'secretAccessKey');
  if (
    saved?.hasSecretKey &&
    !draft.clearSecret &&
    !draft.secretAccessKey &&
    (['endpoint', 'privateEndpointUrl', 'publicEndpointUrl', 'bucket', 'region'] as const).some(
      (field) =>
        (field === 'bucket' || field === 'region' ? draft[field].trim() : draft[field]) !==
        saved[field]
    )
  )
    invalid.push('secretAccessKey');
  return [...new Set(invalid)];
}
export function storageCommand(draft: StorageDraft, version: number) {
  const { clearSecret, secretAccessKey, ...fields } = draft;
  return {
    ...fields,
    region: fields.region.trim(),
    bucket: fields.bucket.trim(),
    version,
    ...(clearSecret ? { secretAccessKey: '' } : secretAccessKey ? { secretAccessKey } : {}),
  };
}
export function matchesStorageReceipt(
  value: unknown,
  command: ReturnType<typeof storageCommand>,
  saved: StorageConfigView
) {
  return (
    validStorageConfig(value) &&
    value.version === command.version + 1 &&
    storageTextFields.every((field) => value[field] === command[field]) &&
    value.forcePathStyle === command.forcePathStyle &&
    value.hasSecretKey ===
      (command.secretAccessKey === undefined ? saved.hasSecretKey : !!command.secretAccessKey)
  );
}
export function cleanupInvalidFields(draft: CleanupDraft): (keyof CleanupDraft)[] {
  const hours = Number(draft.hours);
  return /^\d+$/.test(draft.hours.trim()) &&
    Number.isSafeInteger(hours) &&
    hours >= 1 &&
    hours <= 168
    ? []
    : ['hours'];
}
export const emptyPolicyDraft = (): UploadPolicyDraft => ({ extensions: [], size: '' });
export function policyDraft(limit: UploadLimit, current?: UploadPolicyDto): UploadPolicyDraft {
  return {
    extensions: (current?.allowedExtensions ?? limit.allowedExtensions).filter((ext) =>
      limit.allowedExtensions.includes(ext)
    ),
    size: String(Math.min(current?.maxSizeBytes ?? limit.maxSizeBytes, limit.maxSizeBytes) / mib),
  };
}
export function policyInvalidFields(
  draft: UploadPolicyDraft,
  limit: UploadLimit | null
): (keyof UploadPolicyDraft)[] {
  const invalid: (keyof UploadPolicyDraft)[] = [];
  if (
    !limit ||
    !draft.extensions.length ||
    draft.extensions.length > MAX_UPLOAD_POLICY_EXTENSIONS ||
    new Set(draft.extensions).size !== draft.extensions.length ||
    draft.extensions.some((ext) => !limit.allowedExtensions.includes(ext))
  )
    invalid.push('extensions');
  const bytes = Number(draft.size) * mib;
  if (
    !limit ||
    !draft.size.trim() ||
    !Number.isSafeInteger(bytes) ||
    bytes < 1 ||
    bytes > limit.maxSizeBytes
  )
    invalid.push('size');
  return invalid;
}
