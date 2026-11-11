import { expect, it, vi } from 'vitest';
import { finishMultipartUpload, MULTIPART_PART_SIZE } from './multipart-upload.js';
import type { StorageProvider } from './storage-provider.js';

const size = MULTIPART_PART_SIZE + 17;
const parts = [
  { partNumber: 1, size: MULTIPART_PART_SIZE, etag: 'first' },
  { partNumber: 2, size: 17, etag: 'last' },
];

it.each([MULTIPART_PART_SIZE + 1, 100 * 1024 * 1024 - 1, 100 * 1024 * 1024])(
  'completes the exact final part at supported size %s',
  async (fileSize) => {
    const completeMultipartUpload = vi.fn().mockResolvedValue(undefined);
    const receipt = Array.from(
      { length: Math.ceil(fileSize / MULTIPART_PART_SIZE) },
      (_, index) => ({
        partNumber: index + 1,
        etag: `part-${index + 1}`,
        size: Math.min(MULTIPART_PART_SIZE, fileSize - index * MULTIPART_PART_SIZE),
      })
    );
    await finishMultipartUpload(
      { completeMultipartUpload } as unknown as StorageProvider,
      'key',
      'upload',
      receipt,
      fileSize
    );
    expect(completeMultipartUpload).toHaveBeenCalledExactlyOnceWith('key', 'upload', receipt);
  }
);

it('rejects incomplete, oversized and reordered parts before provider completion', async () => {
  const completeMultipartUpload = vi.fn();
  const storage = { completeMultipartUpload } as unknown as StorageProvider;
  for (const invalid of [
    parts.slice(0, 1),
    [...parts].reverse(),
    [parts[0]!, { ...parts[1]!, size: 18 }],
  ])
    await expect(finishMultipartUpload(storage, 'key', 'upload', invalid, size)).rejects.toThrow(
      'Invalid multipart'
    );
  expect(completeMultipartUpload).not.toHaveBeenCalled();
});

for (const length of [size, size - 1]) {
  it(`recovers a lost completion response only when stored length matches (${length})`, async () => {
    const failure = new Error('Response lost');
    const cancel = vi.fn();
    const completeMultipartUpload = vi.fn().mockRejectedValue(failure);
    const storage = {
      completeMultipartUpload,
      getObject: vi.fn().mockResolvedValue({ contentLength: length, body: { cancel } }),
    } as unknown as StorageProvider;
    const completed = finishMultipartUpload(storage, 'key', 'upload', parts, size);
    if (length === size) await expect(completed).resolves.toBeUndefined();
    else await expect(completed).rejects.toBe(failure);
    expect(completeMultipartUpload).toHaveBeenCalledExactlyOnceWith('key', 'upload', parts);
    expect(cancel).toHaveBeenCalledOnce();
  });
}

it('recovers a legacy completed object without issuing a completion with invented parts', async () => {
  const completeMultipartUpload = vi.fn();
  const cancel = vi.fn();
  const storage = {
    completeMultipartUpload,
    getObject: vi.fn().mockResolvedValue({ contentLength: size, body: { cancel } }),
  } as unknown as StorageProvider;
  await finishMultipartUpload(storage, 'key', 'upload', undefined, size);
  expect(completeMultipartUpload).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});

it('rejects invalid legacy reservation sizes before reading or completing storage', async () => {
  const completeMultipartUpload = vi.fn();
  const getObject = vi.fn();
  const storage = { completeMultipartUpload, getObject } as unknown as StorageProvider;
  for (const invalid of [0, MULTIPART_PART_SIZE, Number.NaN, Number.MAX_SAFE_INTEGER + 1])
    await expect(
      finishMultipartUpload(storage, 'key', 'upload', undefined, invalid)
    ).rejects.toThrow('Invalid multipart');
  expect(completeMultipartUpload).not.toHaveBeenCalled();
  expect(getObject).not.toHaveBeenCalled();
});
