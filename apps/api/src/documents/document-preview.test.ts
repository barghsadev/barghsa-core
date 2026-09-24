import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import type { StorageProvider } from '@barghsa/shared/storage';
import { DocumentStorageService } from './document-storage.service.js';
import type { UploadService } from '../upload/upload.service.js';

const pdfRendererAvailable = spawnSync('pdftoppm', ['-v'], { stdio: 'ignore' }).status === 0;

function fixture(source: Buffer) {
  const objects = new Map<string, Buffer>([['sealed/source', source]]);
  let writes = 0;
  const provider = {
    async listObjects(key: string) {
      return {
        items: objects.has(key) ? [{ key, size: objects.get(key)!.length }] : [],
        isTruncated: false,
        continuationToken: undefined,
      };
    },
    async getObject(key: string) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error('missing source');
      return {
        body: ReadableStream.from([bytes]),
        contentType: 'application/octet-stream',
        contentLength: bytes.length,
      };
    },
    async putObject(key: string, bytes: Buffer) {
      writes++;
      objects.set(key, bytes);
    },
    async presignedGetUrl(key: string) {
      return `https://storage.example/${key}`;
    },
  } as unknown as StorageProvider;
  return {
    service: new DocumentStorageService({} as UploadService, provider),
    objects,
    writes: () => writes,
  };
}

async function pdf(): Promise<Buffer> {
  const document = new PDFDocument();
  const chunks: Buffer[] = [];
  document.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) =>
    document.on('end', () => resolve(Buffer.concat(chunks)))
  );
  document.text('Preview first page');
  document.end();
  return done;
}

describe('sealed document previews', () => {
  it('resizes an image, caches the derivative, and changes key with the source', async () => {
    const original = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const { service, objects, writes } = fixture(original);
    const first = await service.preview('doc-1', 'sealed/source', 'image/png');
    expect(first.url).toContain('/previews/doc-1/');
    const image = objects.get(new URL(first.url).pathname.slice(1))!;
    expect((await sharp(image).metadata()).width).toBe(640);
    expect(await service.preview('doc-1', 'sealed/source', 'image/png')).toEqual(first);
    expect(writes()).toBe(1);
    objects.set('sealed/changed', original);
    const changed = await service.preview('doc-1', 'sealed/changed', 'image/png');
    expect(changed.url).not.toBe(first.url);
    expect(writes()).toBe(2);
  });

  it.skipIf(!pdfRendererAvailable)(
    'renders only the first PDF page as a bounded PNG',
    async () => {
      const { service, objects } = fixture(await pdf());
      const result = await service.preview('doc-2', 'sealed/source', 'application/pdf');
      const image = objects.get(new URL(result.url).pathname.slice(1))!;
      const metadata = await sharp(image).metadata();
      expect(metadata.format).toBe('png');
      expect(Math.max(metadata.width!, metadata.height!)).toBeLessThanOrEqual(640);
    },
    15_000
  );

  it('rejects unsupported and oversized sources without writing a preview', async () => {
    const { service, writes } = fixture(Buffer.alloc(15 * 1024 * 1024 + 1));
    await expect(service.preview('doc-3', 'sealed/source', 'text/plain')).rejects.toThrow();
    await expect(service.preview('doc-3', 'sealed/source', 'image/png')).rejects.toThrow(
      'too large'
    );
    expect(writes()).toBe(0);
  });

  it('returns a controlled error for malformed image bytes', async () => {
    const { service, writes } = fixture(Buffer.from('not an image'));
    await expect(service.preview('doc-4', 'sealed/source', 'image/png')).rejects.toThrow(
      'could not be generated'
    );
    expect(writes()).toBe(0);
  });
});
