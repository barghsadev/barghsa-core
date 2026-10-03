export type TermsDraft = { versionId: string; contentFa: string; contentEn: string };
export type ContractTemplateDraft = {
  name: string;
  description: string;
  status: 'active' | 'inactive';
};
export const emptyTermsDraft = (): TermsDraft => ({ versionId: '', contentFa: '', contentEn: '' });
export const emptyContractTemplateDraft = (): ContractTemplateDraft => ({
  name: '',
  description: '',
  status: 'active',
});
export function termsInvalidFields(draft: TermsDraft): (keyof TermsDraft)[] {
  return (['versionId', 'contentFa', 'contentEn'] as const).filter(
    (field) => !draft[field].trim() || (field === 'versionId' && draft[field].length > 50)
  );
}
export function contractTemplateInvalidFields(
  draft: ContractTemplateDraft
): (keyof ContractTemplateDraft)[] {
  const fields: (keyof ContractTemplateDraft)[] = [];
  if (!draft.name.trim() || draft.name.trim().length > 200) fields.push('name');
  if (draft.description.length > 2000) fields.push('description');
  if (!['active', 'inactive'].includes(draft.status)) fields.push('status');
  return fields;
}
