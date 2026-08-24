import { describe, it, expect, vi } from 'vitest';
import {
  ImmutableStorageRecordService,
  ImmutableRecordDeleteError,
  type DbAdapter,
} from './immutable-storage.js';
import { StorageObjectNotFound } from './storage-provider.js';
import type { StorageProvider } from './storage-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMocks(): {
  storage: StorageProvider;
  db: DbAdapter;
  service: ImmutableStorageRecordService;
} {
  const storage: StorageProvider = {
    putObject: vi.fn(),
    getObject: vi.fn(),
    deleteObject: vi.fn(),
    presignedPutUrl: vi.fn(),
    presignedGetUrl: vi.fn(),
    listObjects: vi.fn().mockResolvedValue({ items: [], isTruncated: false, continuationToken: undefined }),
  };

  const db: DbAdapter = {
    createStorageRecord: vi.fn(),
    getStorageRecordStatus: vi.fn(),
    markStorageRecordImmutable: vi.fn(),
    softDeleteStorageRecord: vi.fn(),
    updateStorageRecordMetadata: vi.fn(),
  };

  const service = new ImmutableStorageRecordService(storage, db);

  return { storage, db, service };
}

// ---------------------------------------------------------------------------
// createRecord
// ---------------------------------------------------------------------------

describe('ImmutableStorageRecordService.createRecord', () => {
  it('creates a storage record with all fields', async () => {
    const { db, service } = createMocks();

    await service.createRecord({
      storageKey: 'uploads/abc123.pdf',
      fileName: 'contract.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
      category: 'contract',
      metadata: { signer: 'user123' },
    });

    expect(db.createStorageRecord).toHaveBeenCalledWith({
      storageKey: 'uploads/abc123.pdf',
      fileName: 'contract.pdf',
      contentType: 'application/pdf',
      fileSize: 1024,
      category: 'contract',
      metadata: { signer: 'user123' },
    });
  });

  it('creates a storage record with minimal fields', async () => {
    const { db, service } = createMocks();

    await service.createRecord({ storageKey: 'uploads/minimal.png' });

    expect(db.createStorageRecord).toHaveBeenCalledWith({
      storageKey: 'uploads/minimal.png',
      fileName: null,
      contentType: null,
      fileSize: null,
      category: null,
      metadata: null,
    });
  });

  it('converts undefined metadata to null', async () => {
    const { db, service } = createMocks();

    await service.createRecord({ storageKey: 'uploads/test.txt' });

    expect(db.createStorageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// getRecordStatus
// ---------------------------------------------------------------------------

describe('ImmutableStorageRecordService.getRecordStatus', () => {
  it('returns status when record exists', async () => {
    const { db, service } = createMocks();
    (db.getStorageRecordStatus as ReturnType<typeof vi.fn>).mockResolvedValue('active');

    const result = await service.getRecordStatus('uploads/test.txt');
    expect(result).toBe('active');
  });

  it('returns null when record does not exist', async () => {
    const { db, service } = createMocks();
    (db.getStorageRecordStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await service.getRecordStatus('uploads/missing.txt');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markAsImmutable
// ---------------------------------------------------------------------------

describe('ImmutableStorageRecordService.markAsImmutable', () => {
  it('marks an existing object as immutable', async () => {
    const { storage, db, service } = createMocks();
    (storage.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({ body: 'data', contentType: 'text/plain', contentLength: 4, metadata: {}, etag: undefined });

    await service.markAsImmutable('uploads/contract.pdf', 'admin1');

    expect(storage.getObject).toHaveBeenCalledWith('uploads/contract.pdf');
    expect(db.markStorageRecordImmutable).toHaveBeenCalledWith('uploads/contract.pdf', 'admin1');
  });

  it('marks without signedBy when not provided', async () => {
    const { storage, db, service } = createMocks();
    (storage.getObject as ReturnType<typeof vi.fn>).mockResolvedValue({ body: 'data', contentType: 'text/plain', contentLength: 4, metadata: {}, etag: undefined });

    await service.markAsImmutable('uploads/doc.pdf');

    expect(db.markStorageRecordImmutable).toHaveBeenCalledWith('uploads/doc.pdf', undefined);
  });

  it('throws StorageObjectNotFound when object does not exist in storage', async () => {
    const { storage, db, service } = createMocks();
    (storage.getObject as ReturnType<typeof vi.fn>).mockRejectedValue(new StorageObjectNotFound('uploads/ghost.pdf'));

    await expect(service.markAsImmutable('uploads/ghost.pdf')).rejects.toThrow(StorageObjectNotFound);
    expect(db.markStorageRecordImmutable).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// deleteRecord
// ---------------------------------------------------------------------------

describe('ImmutableStorageRecordService.deleteRecord', () => {
  it('physically deletes an active record', async () => {
    const { storage, db, service } = createMocks();
    (db.getStorageRecordStatus as ReturnType<typeof vi.fn>).mockResolvedValue('active');

    await service.deleteRecord('uploads/test.txt');

    expect(storage.deleteObject).toHaveBeenCalledWith('uploads/test.txt');
    expect(db.softDeleteStorageRecord).toHaveBeenCalledWith('uploads/test.txt');
  });

  it('soft-deletes an immutable record and throws ImmutableRecordDeleteError', async () => {
    const { storage, db, service } = createMocks();
    (db.getStorageRecordStatus as ReturnType<typeof vi.fn>).mockResolvedValue('immutable');

    await expect(service.deleteRecord('uploads/contract.pdf')).rejects.toThrow(ImmutableRecordDeleteError);
    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(db.softDeleteStorageRecord).toHaveBeenCalledWith('uploads/contract.pdf');
  });

  it('physically deletes and creates record when no DB record exists', async () => {
    const { storage, db, service } = createMocks();
    (db.getStorageRecordStatus as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    await service.deleteRecord('uploads/unknown.txt');

    expect(storage.deleteObject).toHaveBeenCalledWith('uploads/unknown.txt');
    expect(db.createStorageRecord).toHaveBeenCalledWith({ storageKey: 'uploads/unknown.txt' });
    expect(db.softDeleteStorageRecord).toHaveBeenCalledWith('uploads/unknown.txt');
  });

  it('is a no-op on an already-removed record', async () => {
    const { storage, db, service } = createMocks();
    (db.getStorageRecordStatus as ReturnType<typeof vi.fn>).mockResolvedValue('removed');

    await service.deleteRecord('uploads/already-removed.txt');

    expect(storage.deleteObject).not.toHaveBeenCalled();
    expect(db.createStorageRecord).not.toHaveBeenCalled();
    expect(db.softDeleteStorageRecord).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateMetadata
// ---------------------------------------------------------------------------

describe('ImmutableStorageRecordService.updateMetadata', () => {
  it('updates metadata for a record', async () => {
    const { db, service } = createMocks();

    await service.updateMetadata('uploads/doc.pdf', { reviewer: 'admin2', approved: true });

    expect(db.updateStorageRecordMetadata).toHaveBeenCalledWith('uploads/doc.pdf', { reviewer: 'admin2', approved: true });
  });
});