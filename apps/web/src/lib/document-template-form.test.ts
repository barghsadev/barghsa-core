import { expect, it } from 'vitest';
import { templateDetail, templateFile } from '../test/document-list-fixtures.js';
import { versionReceipt, versionErrors, type DocumentTemplate } from './document-template-form.js';

it('rejects missing, malformed and unrelated file receipts without clearing a captured publication', () => {
  const base = templateDetail as DocumentTemplate;
  const draft = { retainedFileIds: [templateFile.id], files: [], changeSummary: 'Retained terms' };
  const receipt = {
    ...base,
    versionCount: 2,
    versions: [
      {
        ...base.versions![0],
        id: '99999999-9999-4999-8999-999999999999',
        versionNumber: 2,
        changeSummary: draft.changeSummary,
        files: [templateFile],
      },
    ],
  };
  expect(versionReceipt(receipt, draft, base)).toBe(true);
  for (const file of [null, {}, { ...templateFile, checksum: 'a'.repeat(64) }])
    expect(
      versionReceipt(
        { ...receipt, versions: [{ ...receipt.versions[0], files: [file] }] },
        draft,
        base
      )
    ).toBe(false);
  expect(versionReceipt({ ...receipt, versionCount: 3 }, draft, base)).toBe(false);
});

it('enforces combined limits and current retained membership before upload confirmation', () => {
  const files = Array.from({ length: 5 }, (_, i) => new File(['pdf'], `file-${i}.pdf`));
  const draft = { retainedFileIds: [templateFile.id], files, changeSummary: '' };
  expect(versionErrors(draft, [templateFile])).toContain('files');
  expect(
    versionErrors({ ...draft, files: [], retainedFileIds: ['obsolete'] }, [templateFile])
  ).toContain('retainedFileIds');
  expect(
    versionErrors({ ...draft, files: [new File(['pdf'], 'TERMS.PDF')] }, [templateFile])
  ).toContain('files');
  expect(
    versionErrors({ ...draft, files: [new File(['text'], 'text.txt')] }, [templateFile])
  ).toContain('files');
});
