import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage';
export function pdfBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(new TextEncoder().encode('%PDF-1.4\n'));
  return bytes;
}

function bytesBody(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.byteLength > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

export function memoryStorage(objects: Map<string, Uint8Array>): StorageProvider {
  return {
    putObject: async (key, body) => {
      if (body instanceof Uint8Array) objects.set(key, body);
    },
    getObject: async (key) => {
      const bytes = objects.get(key);
      if (!bytes) throw new StorageObjectNotFound(key);
      return {
        body: bytesBody(bytes),
        contentType: 'application/pdf',
        contentLength: bytes.byteLength,
        metadata: {},
        etag: undefined,
      };
    },
    deleteObject: async () => {},
    presignedPutUrl: async () => '',
    presignedGetUrl: async () => '',
    listObjects: async () => ({ items: [], isTruncated: false, continuationToken: undefined }),
  };
}
