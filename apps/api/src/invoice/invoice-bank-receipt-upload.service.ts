import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common'
import { getDbPool } from '@barghsa/db'
import { ErrorCodes } from '@barghsa/shared/errors'
import {
  canCustomerSubmitInvoiceBankReceipt,
  evaluateBankReceiptStorageMetadata,
  evaluateInvoiceBankReceiptStoredFile,
  INVOICE_BANK_RECEIPT_ALLOWED_MIME_BY_CATEGORY,
  invoiceBankReceiptDetailsMatch,
  invoiceBankReceiptLookupKeys,
  invoiceBankReceiptMaxBytes,
  parseInvoiceBankReceiptSubmission,
  parsePositiveByteCount,
  sealedInvoiceBankReceiptAttachmentKey,
  type BankReceiptStorageRejection,
  type BankReceiptTopUpDetails,
  type InvoiceBankReceiptFileCategory,
} from '@barghsa/shared/finance'
import { StorageObjectNotFound, type StorageProvider } from '@barghsa/shared/storage'
import {
  bankReceiptAttachmentAdvisoryLockKeys,
  claimBankReceiptAttachment,
} from '../finance/claim-bank-receipt-attachment.js'
import { STORAGE_PROVIDER } from '../storage/storage.constants.js'
import {
  pickDetectedContentType,
  sniffContentTypes,
  SNIFF_SAMPLE_BYTES,
} from '../upload/content-type-sniffer.js'
import { CustomerInvoiceDetailsService } from './customer-invoice-details.service.js'

const PG_UNIQUE_VIOLATION = '23505'
const BANK_RECEIPTS_ATTACHMENT_CONSTRAINT = 'uq_bank_receipts_attachment_key'

const STORAGE_REJECTION_MESSAGE: Record<BankReceiptStorageRejection, string> = {
  missing: 'Bank receipt attachment has not been verified',
  unverified: 'Bank receipt attachment has not been verified',
  wrong_owner: 'Bank receipt attachment does not belong to this account',
  wrong_purpose: 'Bank receipt attachment was not uploaded as a bank receipt',
}

const FILE_REJECTION_MESSAGE = {
  type: 'Bank receipt file must be a PDF, JPEG, PNG, or WebP',
  size: 'Bank receipt file exceeds the allowed size for its type',
  empty: 'Bank receipt file is missing or empty',
  size_unverified: 'Bank receipt file size could not be verified from storage',
  size_mismatch: 'Bank receipt file size does not match the uploaded object',
} as const

export interface SubmitInvoiceBankReceiptInput {
  userId: string
  invoiceId: string
  amount: unknown
  paymentDate: unknown
  payerReference: unknown
  attachmentKey: unknown
  customerNote?: unknown
}

export interface SubmitInvoiceBankReceiptResult {
  receiptId: string
  invoiceId: string
  profileId: string
  amount: bigint
  state: 'Submitted'
  paymentDate: string
  payerReference: string
  attachmentKey: string
  customerNote: string | null
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: unknown[]; rowCount?: number | null }>
}

interface BankReceiptRow {
  id: string
  invoice_id: string
  profile_id: string
  amount: string | number | bigint
  payment_date: string
  payer_reference: string
  attachment_key: string
  customer_note: string | null
  state: string
}

interface InvoiceLockRow {
  id: string
  profile_id: string
  state: string
  adjustment_kind: string | null
}

interface StorageLockRow {
  status: string
  metadata: unknown
  file_size: string | number | bigint | null
  content_type: string | null
  category: string | null
  file_name: string | null
}

interface SealedAttachment {
  sealedKey: string
  bytes: Uint8Array
  detectedContentType: string
  category: InvoiceBankReceiptFileCategory
}

/**
 * Customer invoice bank-receipt upload (T-04.3.01.02 / S-04.3.01).
 *
 * Order of operations:
 *   1. Validate amount (positive int8 IRR), payment date, payer
 *      reference, attachment key, and optional note.
 *   2. Resolve the caller's active profile (same isolation as invoice
 *      details). Missing invoices, other profiles, and drafts 404.
 *   3. Lock the attachment (shared namespace with wallet top-up) and
 *      require verified owner+purpose provenance.
 *   4. Claim the customer upload key as `invoice_receipt`. A wallet
 *      top-up claim is rejected; same-flow retries continue.
 *   5. Reuse an existing Submitted row keyed by the upload or sealed
 *      copy. Do not re-copy after a receipt exists — the original PUT
 *      URL may have been reused.
 *   6. Otherwise read the object bytes, magic-byte sniff them, copy
 *      that buffer to a server-only `receipts/submitted/` key the
 *      client cannot overwrite, freeze both records, and insert a
 *      `Submitted` row that references the sealed key.
 *
 * Invoice state and wallet credit are deferred to later tasks.
 */
@Injectable()
export class InvoiceBankReceiptUploadService {
  private readonly logger = new Logger(InvoiceBankReceiptUploadService.name)

  constructor(
    private readonly customerInvoices: CustomerInvoiceDetailsService,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null = null,
  ) {}

  async submit(input: SubmitInvoiceBankReceiptInput): Promise<SubmitInvoiceBankReceiptResult> {
    const parsed = parseInvoiceBankReceiptSubmission({
      amount: input.amount,
      paymentDate: input.paymentDate,
      payerReference: input.payerReference,
      attachmentKey: input.attachmentKey,
      customerNote: input.customerNote,
    })
    if (!parsed.ok) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, parsed.message)
    }

    const profileId = await this.customerInvoices.resolveActiveProfileId(input.userId)
    if (!profileId) {
      throw httpError(ErrorCodes.NOT_FOUND_RESOURCE, 'No active profile', 404)
    }

    const pool = getDbPool()
    const attachmentLockKeys = bankReceiptAttachmentAdvisoryLockKeys(
      parsed.receipt.attachmentKey,
    )
    const client = await pool.connect()
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', attachmentLockKeys)
      try {
        const row = await this.insertOrReuseSubmitted(
          client,
          input.userId,
          profileId,
          input.invoiceId,
          parsed.amountIrR,
          parsed.receipt,
        )
        this.logger.log(
          `Invoice bank receipt ${row.id} submitted for invoice ${row.invoice_id}`,
        )
        return mapReceipt(row)
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', attachmentLockKeys)
      }
    } finally {
      client.release()
    }
  }

  private async insertOrReuseSubmitted(
    client: QueryClient,
    actorId: string,
    profileId: string,
    invoiceId: string,
    amountIrR: bigint,
    receipt: BankReceiptTopUpDetails,
  ): Promise<BankReceiptRow> {
    const lookupKeys = invoiceBankReceiptLookupKeys(receipt.attachmentKey)
    try {
      await client.query('BEGIN')

      const invoice = await this.lockInvoice(client, invoiceId, profileId)
      const storageRow = await this.lockAttachmentProvenance(
        client,
        receipt.attachmentKey,
        actorId,
        profileId,
      )
      await claimBankReceiptAttachment(client, receipt.attachmentKey, 'invoice_receipt')

      const existing = await this.findReceiptByKeys(client, lookupKeys)
      if (existing) {
        assertReusableSubmitted(existing, invoiceId, profileId, amountIrR, receipt)
        await client.query('COMMIT')
        return existing
      }

      const sealed = await this.sealAttachmentBytes(receipt.attachmentKey, storageRow)
      await this.persistSealedStorageRecords(client, actorId, receipt.attachmentKey, storageRow, sealed)

      const inserted = await client.query(
        `INSERT INTO bank_receipts
           (invoice_id, profile_id, amount, payment_date, payer_reference,
            attachment_key, customer_note, state)
         VALUES ($1, $2, $3::bigint, $4::date, $5, $6, $7, 'Submitted')
         RETURNING id, invoice_id, profile_id, amount,
                   to_char(payment_date, 'YYYY-MM-DD') AS payment_date, payer_reference,
                   attachment_key, customer_note, state`,
        [
          invoice.id,
          invoice.profile_id,
          amountIrR.toString(),
          receipt.paymentDate,
          receipt.payerReference,
          sealed.sealedKey,
          receipt.customerNote,
        ],
      )

      await client.query('COMMIT')
      return inserted.rows[0] as BankReceiptRow
    } catch (error) {
      await client.query('ROLLBACK')
      if (isPgUniqueViolation(error, BANK_RECEIPTS_ATTACHMENT_CONSTRAINT)) {
        const committed = await this.findReceiptByKeys(client, lookupKeys, false)
        if (!committed) {
          throw new ConflictException('This bank receipt attachment has already been submitted')
        }
        assertReusableSubmitted(committed, invoiceId, profileId, amountIrR, receipt)
        return committed
      }
      throw error
    }
  }

  private async findReceiptByKeys(
    client: QueryClient,
    lookupKeys: string[],
    forUpdate = true,
  ): Promise<BankReceiptRow | null> {
    const result = await client.query(
      `SELECT id, invoice_id, profile_id, amount, to_char(payment_date, 'YYYY-MM-DD') AS payment_date,
              payer_reference, attachment_key, customer_note, state
         FROM bank_receipts
        WHERE attachment_key = ANY($1::text[])${forUpdate ? ' FOR UPDATE' : ''}`,
      [lookupKeys],
    )
    return result.rows.length > 0 ? (result.rows[0] as BankReceiptRow) : null
  }

  private async lockInvoice(
    client: QueryClient,
    invoiceId: string,
    profileId: string,
  ): Promise<InvoiceLockRow> {
    const result = await client.query(
      `SELECT id, profile_id, state, adjustment_kind
         FROM invoices
        WHERE id = $1 AND profile_id = $2 AND state <> 'Draft'
        FOR UPDATE`,
      [invoiceId, profileId],
    )
    if (result.rows.length === 0) {
      throw httpError(
        ErrorCodes.NOT_FOUND_RESOURCE,
        `Invoice not found: ${invoiceId}`,
        404,
      )
    }
    const invoice = result.rows[0] as InvoiceLockRow
    if (
      !canCustomerSubmitInvoiceBankReceipt({
        state: invoice.state,
        adjustmentKind: invoice.adjustment_kind,
      })
    ) {
      throw httpError(
        ErrorCodes.CONFLICT_STATE,
        invoice.adjustment_kind === 'credit'
          ? `Invoice ${invoiceId} is a credit note and cannot receive a bank receipt`
          : `Invoice in state '${invoice.state}' cannot receive a bank receipt`,
        409,
      )
    }
    return invoice
  }

  private async lockAttachmentProvenance(
    client: QueryClient,
    attachmentKey: string,
    actorId: string,
    profileId: string,
  ): Promise<StorageLockRow> {
    const result = await client.query(
      `SELECT status, metadata, file_size, content_type, category, file_name
         FROM storage_records
        WHERE storage_key = $1
        FOR UPDATE`,
      [attachmentKey],
    )
    if (result.rows.length === 0) {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment has not been uploaded and recorded',
      )
    }
    const row = result.rows[0] as StorageLockRow
    if (row.status === 'removed') {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment is no longer available',
      )
    }
    if (row.status !== 'active' && row.status !== 'immutable') {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment is no longer available',
      )
    }

    const provenance = evaluateBankReceiptStorageMetadata(row.metadata, actorId, profileId)
    if (!provenance.ok) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, STORAGE_REJECTION_MESSAGE[provenance.reason])
    }
    return row
  }

  private async sealAttachmentBytes(
    attachmentKey: string,
    row: StorageLockRow,
  ): Promise<SealedAttachment> {
    const sealedKey = sealedInvoiceBankReceiptAttachmentKey(attachmentKey)
    if (sealedKey === null) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.type)
    }

    const keyCategory: InvoiceBankReceiptFileCategory = attachmentKey.startsWith(
      'uploads/image/',
    )
      ? 'image'
      : 'document'
    const cap = invoiceBankReceiptMaxBytes(keyCategory)

    const read = await this.readObjectBytesCapped(attachmentKey, cap)
    if (read === null) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size_unverified)
    }
    if (read.bytes.byteLength === 0) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.empty)
    }
    if (read.truncated) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size)
    }

    const sample = read.bytes.subarray(0, Math.min(read.bytes.byteLength, SNIFF_SAMPLE_BYTES))
    const detected = pickDetectedContentType(
      sniffContentTypes(sample),
      INVOICE_BANK_RECEIPT_ALLOWED_MIME_BY_CATEGORY[keyCategory],
    )
    if (detected === null) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.type)
    }

    const file = evaluateInvoiceBankReceiptStoredFile({
      attachmentKey,
      fileSize: read.bytes.byteLength,
      contentType: detected,
      category: row.category,
      fileName: row.file_name,
    })
    if (!file.ok) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE[file.reason])
    }

    const recordedFileSize = row.file_size == null ? null : parsePositiveByteCount(row.file_size)
    if (row.file_size != null && recordedFileSize !== read.bytes.byteLength) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size_mismatch)
    }

    if (!this.storage) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, FILE_REJECTION_MESSAGE.size_unverified)
    }
    await this.storage.putObject(sealedKey, read.bytes, detected)

    return {
      sealedKey,
      bytes: read.bytes,
      detectedContentType: detected,
      category: keyCategory,
    }
  }

  private async persistSealedStorageRecords(
    client: QueryClient,
    actorId: string,
    originalKey: string,
    original: StorageLockRow,
    sealed: SealedAttachment,
  ): Promise<void> {
    const originalMetadata = metadataRecord(original.metadata)
    originalMetadata.sealedAttachmentKey = sealed.sealedKey

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
      ],
    )
    if ((updated.rowCount ?? 0) < 1) {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment could not be locked for review',
      )
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
      ],
    )
  }

  private async readObjectBytesCapped(
    attachmentKey: string,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array; truncated: boolean } | null> {
    if (!this.storage) return null
    try {
      const object = await this.storage.getObject(attachmentKey)
      return await readCappedBytes(object.body, maxBytes)
    } catch (error) {
      if (error instanceof StorageObjectNotFound) return null
      throw error
    }
  }
}

function assertReusableSubmitted(
  existing: BankReceiptRow,
  invoiceId: string,
  profileId: string,
  amountIrR: bigint,
  receipt: BankReceiptTopUpDetails,
): void {
  const sameReceipt =
    existing.invoice_id === invoiceId &&
    existing.profile_id === profileId &&
    existing.state === 'Submitted' &&
    invoiceBankReceiptDetailsMatch(
      {
        amount: existing.amount,
        paymentDate: existing.payment_date,
        payerReference: existing.payer_reference,
        attachmentKey: existing.attachment_key,
        customerNote: existing.customer_note,
      },
      amountIrR,
      receipt,
    )
  if (!sameReceipt) {
    throw new ConflictException('This bank receipt attachment has already been submitted')
  }
}

function mapReceipt(row: BankReceiptRow): SubmitInvoiceBankReceiptResult {
  if (row.state !== 'Submitted') {
    throw new ConflictException('This bank receipt attachment has already been submitted')
  }
  return {
    receiptId: row.id,
    invoiceId: row.invoice_id,
    profileId: row.profile_id,
    amount: BigInt(row.amount),
    state: 'Submitted',
    paymentDate: row.payment_date,
    payerReference: row.payer_reference,
    attachmentKey: row.attachment_key,
    customerNote: row.customer_note,
  }
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false
  const pgError = error as { code?: string; constraint?: string }
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false
  return constraint === undefined || pgError.constraint === constraint
}

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus,
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode)
}

function metadataRecord(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) }
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) }
      }
    } catch {
      return {}
    }
  }
  return {}
}

async function readCappedBytes(
  body: unknown,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const web = asWebReadableStream(body)
  if (web) return readWebStreamCapped(web, maxBytes)
  if (isAsyncIterable(body)) return readAsyncIterableCapped(body, maxBytes)
  throw new TypeError('Storage object body is not readable')
}

function asWebReadableStream(body: unknown): ReadableStream<Uint8Array> | null {
  if (body && typeof body === 'object') {
    const candidate = body as {
      getReader?: unknown
      transformToWebStream?: () => ReadableStream<Uint8Array>
    }
    if (typeof candidate.getReader === 'function') {
      return body as ReadableStream<Uint8Array>
    }
    if (typeof candidate.transformToWebStream === 'function') {
      return candidate.transformToWebStream()
    }
  }
  return null
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array | Buffer | string> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  )
}

async function readWebStreamCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      chunks.push(value)
      total += value.byteLength
      if (total > maxBytes) {
        truncated = true
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return { bytes: concatBytes(chunks, truncated ? maxBytes + 1 : total), truncated }
}

async function readAsyncIterableCapped(
  body: AsyncIterable<Uint8Array | Buffer | string>,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for await (const chunk of body) {
    const bytes = toUint8Array(chunk)
    chunks.push(bytes)
    total += bytes.byteLength
    if (total > maxBytes) {
      truncated = true
      break
    }
  }
  return { bytes: concatBytes(chunks, truncated ? maxBytes + 1 : total), truncated }
}

function toUint8Array(chunk: Uint8Array | Buffer | string): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk)
  return chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)
}

function concatBytes(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, total - offset)
    if (take <= 0) break
    out.set(chunk.subarray(0, take), offset)
    offset += take
    if (offset >= total) break
  }
  return out
}
