import { expect, it } from 'vitest';
import { templateDetail, templateFile, templateRow } from '../test/document-list-fixtures.js';
import {
  templateDetailReceipt,
  templateReceipt,
  versionReceipt,
  versionErrors,
  type DocumentTemplate,
} from './document-template-form.js';

it('accepts a template summary, an empty history and a populated history with conflicts', () => {
  expect(templateReceipt(templateRow)).toBe(true);
  expect(templateDetailReceipt({ ...templateRow, versionCount: 0, versions: [] })).toBe(true);
  const version = {
    ...templateDetail.versions[0]!,
    placeholders: ['name'],
    missingRequired: ['id'],
    conflicts: [{ name: 'name', files: [{ fileName: 'Terms.pdf', context: 'Client' }] }],
    files: [{ ...templateFile, placeholders: [{ name: 'name', context: 'Client' }] }],
  };
  expect(templateDetailReceipt({ ...templateDetail, versions: [version] })).toBe(true);
});

it('rejects malformed template rows, version metadata and nested render inputs', () => {
  for (const invalid of [
    null,
    { ...templateRow, id: 'wrong' },
    { ...templateRow, title: {} },
    { ...templateRow, description: null },
    { ...templateRow, category: 'missing' },
    { ...templateRow, versionCount: -1 },
    { ...templateRow, updatedAt: 'wrong' },
  ]) {
    expect(templateReceipt(invalid)).toBe(false);
  }
  expect(templateDetailReceipt(templateRow)).toBe(false);
  const version = templateDetail.versions[0]!;
  for (const invalid of [
    null,
    { ...version, id: 'wrong' },
    { ...version, versionNumber: 0 },
    { ...version, changeSummary: null },
    { ...version, createdAt: 'wrong' },
    { ...version, placeholders: [null] },
    { ...version, missingRequired: null },
    { ...version, conflicts: [null] },
    {
      ...version,
      conflicts: [{ name: 'name', files: [{ fileName: 'Terms.pdf', context: null }] }],
    },
    { ...version, files: null },
  ]) {
    expect(templateDetailReceipt({ ...templateDetail, versions: [invalid] })).toBe(false);
  }
  for (const file of [
    null,
    { ...templateFile, id: 'wrong' },
    { ...templateFile, originalName: {} },
    { ...templateFile, mimeType: null },
    { ...templateFile, sizeBytes: -1 },
    { ...templateFile, checksum: null },
    { ...templateFile, placeholders: [{ name: 'name', context: null }] },
  ]) {
    expect(
      templateDetailReceipt({ ...templateDetail, versions: [{ ...version, files: [file] }] })
    ).toBe(false);
  }
});

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
