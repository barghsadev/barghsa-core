export type TemplateCategory = 'general' | 'contract' | 'invoice';
export type TemplateMetadata = { title: string; description: string; category: TemplateCategory };
export type TemplateFile = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  placeholders: Array<{ name: string; context: string }>;
};
export type TemplateVersion = {
  id: string;
  versionNumber: number;
  changeSummary: string;
  placeholders: string[];
  missingRequired: string[];
  conflicts: Array<{ name: string; files: Array<{ fileName: string; context: string }> }>;
  createdAt: string;
  files: TemplateFile[];
};
export type DocumentTemplate = TemplateMetadata & {
  id: string;
  versionCount: number;
  updatedAt: string;
  versions?: TemplateVersion[];
};
export type TemplateVersionDraft = {
  retainedFileIds: string[];
  files: File[];
  changeSummary: string;
};
export const emptyTemplateMetadata = (): TemplateMetadata => ({
  title: '',
  description: '',
  category: 'general',
});
export const emptyTemplateVersion = (): TemplateVersionDraft => ({
  retainedFileIds: [],
  files: [],
  changeSummary: '',
});
export function metadataErrors(value: TemplateMetadata): (keyof TemplateMetadata)[] {
  const invalid: (keyof TemplateMetadata)[] = [];
  if (!value.title.trim() || value.title.trim().length > 200) invalid.push('title');
  if (value.description.trim().length > 2000) invalid.push('description');
  if (!['general', 'contract', 'invoice'].includes(value.category)) invalid.push('category');
  return invalid;
}
export function versionErrors(
  value: TemplateVersionDraft,
  latest: TemplateFile[]
): (keyof TemplateVersionDraft)[] {
  const invalid: (keyof TemplateVersionDraft)[] = [];
  if (value.changeSummary.trim().length > 500) invalid.push('changeSummary');
  const retained = latest.filter((file) => value.retainedFileIds.includes(file.id));
  if (retained.length !== value.retainedFileIds.length) invalid.push('retainedFileIds');
  const names = [
    ...retained.map((file) => file.originalName),
    ...value.files.map((file) => file.name),
  ].map((name) => name.toLocaleLowerCase('en'));
  if (
    !names.length ||
    names.length > 5 ||
    new Set(names).size !== names.length ||
    value.files.some(
      (file) => !/\.(pdf|docx)$/i.test(file.name) || file.size === 0 || file.size > 10 * 1024 * 1024
    ) ||
    value.files.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024
  )
    invalid.push('files');
  return invalid;
}
const uuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
export function templateReceipt(value: unknown): value is DocumentTemplate {
  if (!value || typeof value !== 'object') return false;
  const row = value as DocumentTemplate;
  return (
    uuid(row.id) &&
    typeof row.title === 'string' &&
    typeof row.description === 'string' &&
    ['general', 'contract', 'invoice'].includes(row.category) &&
    Number.isSafeInteger(row.versionCount) &&
    row.versionCount >= 0 &&
    typeof row.updatedAt === 'string' &&
    Number.isFinite(Date.parse(row.updatedAt))
  );
}
export function metadataReceipt(
  value: unknown,
  draft: TemplateMetadata,
  id: string | null
): value is DocumentTemplate {
  return (
    templateReceipt(value) &&
    (!id || value.id === id) &&
    value.title === draft.title.trim() &&
    value.description === draft.description.trim() &&
    value.category === draft.category
  );
}
export function versionReceipt(
  value: unknown,
  draft: TemplateVersionDraft,
  base: DocumentTemplate
): value is DocumentTemplate {
  if (!templateReceipt(value) || value.id !== base.id || !Array.isArray(value.versions))
    return false;
  const version = value.versions[0];
  const previous = base.versions?.[0];
  if (
    !version ||
    !uuid(version.id) ||
    version.id === previous?.id ||
    version.versionNumber !== (previous?.versionNumber ?? 0) + 1 ||
    value.versionCount !== base.versionCount + 1 ||
    version.changeSummary !== draft.changeSummary.trim() ||
    !Array.isArray(version.files) ||
    version.files.length !== draft.files.length + draft.retainedFileIds.length
  )
    return false;
  const expected = [
    ...(previous?.files ?? [])
      .filter((file) => draft.retainedFileIds.includes(file.id))
      .map((file) => ({ name: file.originalName, size: file.sizeBytes, checksum: file.checksum })),
    ...draft.files.map((file) => ({ name: file.name, size: file.size, checksum: undefined })),
  ];
  return expected.every((file) =>
    version.files.some(
      (saved) =>
        saved !== null &&
        typeof saved === 'object' &&
        uuid(saved.id) &&
        saved.originalName === file.name &&
        Number(saved.sizeBytes) === Number(file.size) &&
        /^[a-f0-9]{64}$/i.test(saved.checksum) &&
        (!file.checksum || file.checksum === saved.checksum)
    )
  );
}
