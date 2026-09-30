import { ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import type { StorageProvider } from '@barghsa/shared/storage';
import { readCappedBytes } from '../storage/read-capped-bytes.js';

/** Cached PNG derivative of an immutable source; no signed URL is sent to inline viewers. */
export async function ensureDocumentPreview(
  storage: StorageProvider,
  documentId: string,
  storageKey: string,
  mime: string
): Promise<string> {
  if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(mime))
    throw new ConflictException('Document has no preview');
  // A sealed source key is immutable. Changing the source changes the cache key;
  // a daily key bounds cache age, while the bucket lifecycle deletes old derivatives.
  const sourceHash = createHash('sha256').update(storageKey).digest('hex');
  const day = Math.floor(Date.now() / 86_400_000);
  const key = `previews/${documentId}/${sourceHash}-${day}.png`;
  const cached = await storage.listObjects(key, 1);
  if (!cached.items.some((item) => item.key === key)) {
    const bytes = await readPreviewObject(storage, storageKey, 15 * 1024 * 1024);
    if (mime === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-')))
      throw new ConflictException('Invalid PDF document');
    let image: Buffer;
    try {
      image =
        mime === 'application/pdf'
          ? await renderPdfFirstPage(bytes)
          : await sharp(bytes, { limitInputPixels: 25_000_000 })
              .rotate()
              .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
              .png()
              .toBuffer();
    } catch {
      throw new ConflictException('Document preview could not be generated');
    }
    await storage.putObject(key, image, 'image/png', { sourceHash });
  }
  return key;
}

export async function readPreviewObject(
  storage: StorageProvider,
  key: string,
  maxBytes: number
): Promise<Buffer> {
  const object = await storage.getObject(key);
  const read = await readCappedBytes(object.body, maxBytes);
  if (read.truncated) throw new ConflictException('Document is too large to preview');
  return Buffer.from(read.bytes);
}

function renderPdfFirstPage(bytes: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      'pdftoppm',
      ['-f', '1', '-l', '1', '-singlefile', '-scale-to', '640', '-png', '-'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );
    const output: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => process.kill('SIGKILL'), 10_000);
    process.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 5 * 1024 * 1024) process.kill('SIGKILL');
      else output.push(chunk);
    });
    process.stderr.resume();
    process.stdin.on('error', () => {
      // The close handler reports renderer failure if the child exited before reading input.
    });
    process.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    process.on('close', (code) => {
      clearTimeout(timeout);
      const image = Buffer.concat(output);
      if (code === 0 && image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
        resolve(image);
      else reject(new ConflictException('PDF preview could not be generated'));
    });
    process.stdin.end(bytes);
  });
}
