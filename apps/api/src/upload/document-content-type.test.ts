import { afterEach, expect, it, vi } from 'vitest';
import { detectDocumentContentType } from './document-content-type.js';

afterEach(() => vi.useRealTimers());

it('bounds concurrent inspection and frees capacity after parsing', async () => {
  const first = detectDocumentContentType(new Uint8Array());
  const second = detectDocumentContentType(new Uint8Array());
  await expect(detectDocumentContentType(new Uint8Array())).rejects.toThrow('inspection is busy');
  await expect(Promise.all([first, second])).resolves.toEqual([null, null]);
  await expect(detectDocumentContentType(new Uint8Array())).resolves.toBeNull();
});

it('terminates inspection at its deadline and permits a subsequent retry', async () => {
  vi.useFakeTimers();
  const inspection = expect(detectDocumentContentType(new Uint8Array())).rejects.toThrow(
    'inspection is unavailable'
  );
  await vi.advanceTimersByTimeAsync(3000);
  await inspection;
  vi.useRealTimers();
  await expect(detectDocumentContentType(new Uint8Array())).resolves.toBeNull();
});
