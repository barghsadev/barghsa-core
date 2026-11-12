import { HttpException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ErrorCodes } from '@barghsa/shared/errors';
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage';
import {
  evaluateInvoiceBankReceiptStoredFile,
  INVOICE_BANK_RECEIPT_ALLOWED_MIME_BY_CATEGORY,
  invoiceBankReceiptMaxBytes,
  parsePositiveByteCount,
  sealedInvoiceBankReceiptAttachmentKey,
  type InvoiceBankReceiptFileCategory,
} from '@barghsa/shared/finance';
import { readCappedBytes } from '../storage/read-capped-bytes.js';
import { reserveStorageCopy, writeReservedStorageCopy } from '../storage/reserve-storage-copy.js';
import type { PoolClient } from 'pg';
import {
  pickDetectedContentType,
  sniffContentTypes,
  SNIFF_SAMPLE_BYTES,
} from '../upload/content-type-sniffer.js';
import { requireCleanUpload } from '../upload/require-clean-upload.js';
import type { WalletQueryClient } from '../wallet/wallet.service.js';
import type { ReceiptAttachmentBinding } from './receipt-attachment-access.js';
export interface StorageLockRow {
  status: string;
  metadata: unknown;
  file_size: string | number | bigint | null;
  content_type: string | null;
  category: string | null;
  file_name: string | null;
}
export interface ReceiptSourceSnapshot extends StorageLockRow {
  storage_id: string;
  storage_revision: string;
}
interface SealedAttachment {
  sealedKey: string;
  bytes: Uint8Array;
  detectedContentType: string;
  category: InvoiceBankReceiptFileCategory;
}
const FILE_REJECTION_MESSAGE = {
  type: 'Bank receipt file must be a PDF, JPEG, PNG, or WebP',
  size: 'Bank receipt file exceeds the allowed size for its type',
  empty: 'Bank receipt file is missing or empty',
  size_unverified: 'Bank receipt file size could not be verified from storage',
  size_mismatch: 'Bank receipt file size does not match the uploaded object',
} as const;
export async function prepareBankReceiptAttachment(
  directClient: PoolClient,
  storage: StorageProvider | null,
  actorId: string,
  attachmentKey: string,
  row: StorageLockRow
): Promise<SealedAttachment> {
  const sealedKey = sealedInvoiceBankReceiptAttachmentKey(attachmentKey);
  if (sealedKey === null) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.type);
  }

  const keyCategory: InvoiceBankReceiptFileCategory = attachmentKey.startsWith('uploads/image/')
    ? 'image'
    : 'document';
  const cap = invoiceBankReceiptMaxBytes(keyCategory);

  const read = await readObjectBytesCapped(storage, attachmentKey, cap);
  if (read === null) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size_unverified);
  }
  if (read.bytes.byteLength === 0) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.empty);
  }
  if (read.truncated) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size);
  }

  const sample = read.bytes.subarray(0, Math.min(read.bytes.byteLength, SNIFF_SAMPLE_BYTES));
  const detected = pickDetectedContentType(
    sniffContentTypes(sample),
    INVOICE_BANK_RECEIPT_ALLOWED_MIME_BY_CATEGORY[keyCategory]
  );
  if (detected === null) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.type);
  }

  const file = evaluateInvoiceBankReceiptStoredFile({
    attachmentKey,
    fileSize: read.bytes.byteLength,
    contentType: detected,
    category: row.category,
    fileName: row.file_name,
  });
  if (!file.ok) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE[file.reason]);
  }

  const recordedFileSize = row.file_size == null ? null : parsePositiveByteCount(row.file_size);
  if (row.file_size != null && recordedFileSize !== read.bytes.byteLength) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size_mismatch);
  }

  if (!storage) {
    throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size_unverified);
  }
  requireCleanUpload(row.metadata, createHash('sha256').update(read.bytes).digest('hex'));
  const metadata = { sourceKey: attachmentKey, uploadedBy: actorId };
  try {
    await reserveStorageCopy(sealedKey, metadata);
  } catch (error) {
    // A failed prior transaction may have left its independently committed cleanup intent.
    if ((error as { code?: string }).code !== '23505') throw error;
  }
  const ready = await writeReservedStorageCopy(
    sealedKey,
    metadata,
    () => storage.putObject(sealedKey, read.bytes, detected),
    directClient
  );
  if (!ready) throw new ConflictException('Receipt copy changed; retry the upload');

  return {
    sealedKey,
    bytes: read.bytes,
    detectedContentType: detected,
    category: keyCategory,
  };
}
export async function persistSealedBankReceipt(
  client: WalletQueryClient,
  actorId: string,
  originalKey: string,
  original: StorageLockRow,
  sealed: SealedAttachment,
  binding: ReceiptAttachmentBinding
): Promise<void> {
  const originalMetadata = metadataRecord(original.metadata);
  originalMetadata.sealedAttachmentKey = sealed.sealedKey;

  const updated = await client.query(
    `UPDATE storage_records
          SET status = 'immutable',
              file_size = $3,
              content_type = $4,
              metadata = $5::jsonb,
              signed_at = NOW(),
              signed_by = $2,
              updated_at = NOW()
        WHERE storage_key = $1
          AND status IN ('active', 'immutable')`,
    [
      originalKey,
      actorId,
      sealed.bytes.byteLength,
      sealed.detectedContentType,
      JSON.stringify(originalMetadata),
    ]
  );
  if ((updated.rowCount ?? 0) < 1) {
    throw httpError(
      ErrorCodes.VALIDATION_INPUT_INVALID,
      'Bank receipt attachment could not be locked for review'
    );
  }

  const published = await client.query(
    `UPDATE storage_records
        SET status='immutable', metadata=$2::jsonb, file_size=$3, content_type=$4,
            category=$5, file_name=$6, signed_at=NOW(), signed_by=$7, removed_at=NULL, updated_at=NOW()
      WHERE storage_key=$1 AND status='removed' AND signed_at IS NULL AND cleanup_operation IS NULL
        AND metadata @> $8::jsonb RETURNING storage_key`,
    [
      sealed.sealedKey,
      JSON.stringify({
        ...originalMetadata,
        sourceAttachmentKey: originalKey,
        sealedAttachmentKey: sealed.sealedKey,
        receiptBinding: binding,
      }),
      sealed.bytes.byteLength,
      sealed.detectedContentType,
      sealed.category,
      original.file_name,
      actorId,
      JSON.stringify({
        sourceKey: originalKey,
        uploadedBy: actorId,
        provisionalCopy: true,
        deletionRequested: true,
      }),
    ]
  );
  if ((published.rowCount ?? 0) !== 1)
    throw new ConflictException('Receipt copy changed; retry the upload');
}
async function readObjectBytesCapped(
  storage: StorageProvider | null,
  attachmentKey: string,
  maxBytes: number
): Promise<{ bytes: Uint8Array; truncated: boolean } | null> {
  if (!storage) return null;
  try {
    const object = await storage.getObject(attachmentKey);
    return await readCappedBytes(object.body, maxBytes);
  } catch (error) {
    if (error instanceof StorageObjectNotFound) return null;
    throw error;
  }
}
function metadataRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      return {};
    }
  }
  return {};
}
function httpError(def: { code: string; httpStatus: number }, message: string): never {
  throw new HttpException({ statusCode: def.httpStatus, error: def.code, message }, def.httpStatus);
}
