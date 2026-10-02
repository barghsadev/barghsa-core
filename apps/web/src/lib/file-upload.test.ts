import { expect, it } from 'vitest';
import { readFileUploadPolicy, uploadContentType, validateUploadFiles } from './file-upload.js';
const policy = {
  formats: [{ extension: '.pdf', mimeTypes: ['application/pdf'] }],
  maxSizeBytes: 10,
};
it.each(
  [
    null,
    {},
    { formats: [], maxSizeBytes: Infinity },
    { formats: [{ extension: '.PDF', mimeTypes: ['application/pdf'] }], maxSizeBytes: 10 },
    { formats: [{ extension: '.pdf', mimeTypes: ['text/*'] }], maxSizeBytes: 10 },
    { formats: [], maxSizeBytes: 104857601 },
  ].map((value) => [value])
)('rejects malformed server constraints %#', (value) => {
  expect(readFileUploadPolicy(value)).toBeNull();
});
it('accepts a valid restrictive policy, including an empty format set', () => {
  expect(readFileUploadPolicy(policy)).toEqual(policy);
  expect(readFileUploadPolicy({ formats: [], maxSizeBytes: 1 })).toEqual({
    formats: [],
    maxSizeBytes: 1,
  });
});
it('validates case-insensitive filename extensions and MIME together, inferring only an absent MIME', () => {
  expect(
    uploadContentType(new File(['pdf'], 'proof.PDF', { type: 'application/pdf' }), policy)
  ).toBe('application/pdf');
  expect(uploadContentType(new File(['pdf'], 'proof.pdf'), policy)).toBe('application/pdf');
  expect(
    uploadContentType(new File(['pdf'], 'proof.pdf', { type: 'text/plain' }), policy)
  ).toBeNull();
  expect(
    uploadContentType(new File(['pdf'], 'proof.exe', { type: 'application/pdf' }), policy)
  ).toBeNull();
});
it.each([
  [new File([], 'empty.pdf'), 'empty'],
  [new File(['12345678901'], 'large.pdf', { type: 'application/pdf' }), 'size'],
  [new File(['pdf'], 'proof.exe', { type: 'application/pdf' }), 'type'],
  [new File(['pdf'], 'x'.repeat(256)), 'name'],
])('identifies the specific invalid file %#', (file, code) =>
  expect(validateUploadFiles([file], policy, 1)).toMatchObject({ code, file })
);
it('enforces the file count without silently taking the first file', () => {
  const file = new File(['pdf'], 'proof.pdf', { type: 'application/pdf' });
  expect(validateUploadFiles([file, file], policy, 1)).toEqual({ code: 'count' });
  expect(validateUploadFiles([file, file], policy, 2)).toBeNull();
});
