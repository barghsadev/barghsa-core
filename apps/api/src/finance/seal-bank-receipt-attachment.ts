import { HttpException, ConflictException } from '@nestjs/common';
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
import { reserveStorageCopy } from '../storage/reserve-storage-copy.js';
import {
  pickDetectedContentType,
  sniffContentTypes,
  SNIFF_SAMPLE_BYTES,
} from '../upload/content-type-sniffer.js';
import type { WalletQueryClient } from '../wallet/wallet.service.js';
export interface StorageLockRow {
  status: string;
  metadata: unknown;
  file_size: string | number | bigint | null;
  content_type: string | null;
  category: string | null;
  file_name: string | null;
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
export async function sealBankReceiptAttachment(
  client: WalletQueryClient,
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
  try {
    await reserveStorageCopy(sealedKey, { sourceKey: attachmentKey, uploadedBy: actorId });
  } catch (error) {
    // A failed prior transaction may have left its independently committed cleanup intent.
    if ((error as { code?: string }).code !== '23505') throw error;
  }
  const reservation = await client.query(
    `SELECT storage_key FROM storage_records WHERE storage_key=$1 AND status='removed' AND signed_at IS NULL
       AND metadata->>'provisionalCopy'='true' AND metadata->>'deletionRequested'='true' AND metadata->>'sourceKey'=$2
       AND metadata->>'uploadedBy'=$3 FOR UPDATE`,
    [sealedKey, attachmentKey, actorId]
  );
  if (!reservation.rows.length)
    throw new ConflictException('Receipt copy changed; retry the upload');
  await storage.putObject(sealedKey, read.bytes, detected);

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
  sealed: SealedAttachment
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

  await client.query(
    `INSERT INTO storage_records
         (storage_key, status, metadata, file_size, content_type, category, file_name,
          signed_at, signed_by, updated_at)
       VALUES ($1, 'immutable', $2::jsonb, $3, $4, $5, $6, NOW(), $7, NOW())
       ON CONFLICT (storage_key) DO UPDATE
          SET status = 'immutable',
              metadata = EXCLUDED.metadata,
              file_size = EXCLUDED.file_size,
              content_type = EXCLUDED.content_type,
              category = EXCLUDED.category,
              file_name = EXCLUDED.file_name,
              signed_at = NOW(),
              signed_by = EXCLUDED.signed_by,
              removed_at = NULL,
              updated_at = NOW()`,
    [
      sealed.sealedKey,
      JSON.stringify({
        ...originalMetadata,
        sourceAttachmentKey: originalKey,
        sealedAttachmentKey: sealed.sealedKey,
      }),
      sealed.bytes.byteLength,
      sealed.detectedContentType,
      sealed.category,
      original.file_name,
      actorId,
    ]
  );
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
