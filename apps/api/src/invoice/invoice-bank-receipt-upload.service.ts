import {
  sealBankReceiptAttachment,
  persistSealedBankReceipt,
  type StorageLockRow,
} from '../finance/seal-bank-receipt-attachment.js';
import {
  auditReceiptSubmission,
  lockReceiptSubmissionActor,
  type ReceiptSubmissionActor,
} from '../finance/receipt-submission-actor.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  canCustomerSubmitInvoiceBankReceipt,
  evaluateBankReceiptStorageMetadata,
  invoiceBankReceiptDetailsMatch,
  invoiceBankReceiptLookupKeys,
  parseInvoiceBankReceiptSubmission,
  type BankReceiptStorageRejection,
  type BankReceiptTopUpDetails,
} from '@barghsa/shared/finance';
import { type StorageProvider } from '@barghsa/shared/storage';
import {
  bankReceiptAttachmentAdvisoryLockKeys,
  claimBankReceiptAttachment,
} from '../finance/claim-bank-receipt-attachment.js';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import { CustomerInvoiceDetailsService } from './customer-invoice-details.service.js';

const PG_UNIQUE_VIOLATION = '23505';
const BANK_RECEIPTS_ATTACHMENT_CONSTRAINT = 'uq_bank_receipts_attachment_key';

const STORAGE_REJECTION_MESSAGE: Record<BankReceiptStorageRejection, string> = {
  missing: 'Bank receipt attachment has not been verified',
  unverified: 'Bank receipt attachment has not been verified',
  wrong_owner: 'Bank receipt attachment does not belong to this account',
  wrong_purpose: 'Bank receipt attachment was not uploaded as a bank receipt',
};

export interface SubmitInvoiceBankReceiptInput extends ReceiptSubmissionActor {
  invoiceId: string;
  amount: unknown;
  paymentDate: unknown;
  payerReference: unknown;
  attachmentKey: unknown;
  customerNote?: unknown;
}

export interface SubmitInvoiceBankReceiptResult {
  receiptId: string;
  invoiceId: string;
  profileId: string;
  amount: bigint;
  state: 'Submitted';
  paymentDate: string;
  payerReference: string;
  attachmentKey: string;
  customerNote: string | null;
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

interface BankReceiptRow {
  id: string;
  invoice_id: string;
  profile_id: string;
  amount: string | number | bigint;
  payment_date: string;
  payer_reference: string;
  attachment_key: string;
  customer_note: string | null;
  state: string;
}

interface InvoiceLockRow {
  id: string;
  profile_id: string;
  state: string;
  adjustment_kind: string | null;
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
  private readonly logger = new Logger(InvoiceBankReceiptUploadService.name);

  constructor(
    private readonly customerInvoices: CustomerInvoiceDetailsService,
    @Optional()
    @Inject(STORAGE_PROVIDER)
    private readonly storage: StorageProvider | null = null
  ) {}

  async submit(input: SubmitInvoiceBankReceiptInput): Promise<SubmitInvoiceBankReceiptResult> {
    const parsed = parseInvoiceBankReceiptSubmission({
      amount: input.amount,
      paymentDate: input.paymentDate,
      payerReference: input.payerReference,
      attachmentKey: input.attachmentKey,
      customerNote: input.customerNote,
    });
    if (!parsed.ok) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_INVALID, parsed.message);
    }

    const profileId = await this.customerInvoices.resolveActiveProfileId(
      input.userId,
      'bank-receipts:submit'
    );
    if (!profileId) {
      throw httpError(ErrorCodes.NOT_FOUND_RESOURCE, 'No active profile', 404);
    }

    const pool = getDbPool({ session: true });
    const attachmentLockKeys = bankReceiptAttachmentAdvisoryLockKeys(parsed.receipt.attachmentKey);
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1, $2)', attachmentLockKeys);
      try {
        const row = await this.insertOrReuseSubmitted(
          client,
          input,
          profileId,
          input.invoiceId,
          parsed.amountIrR,
          parsed.receipt
        );
        this.logger.log(`Invoice bank receipt ${row.id} submitted for invoice ${row.invoice_id}`);
        return mapReceipt(row);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', attachmentLockKeys);
      }
    } finally {
      client.release();
    }
  }

  private async insertOrReuseSubmitted(
    client: QueryClient,
    actor: ReceiptSubmissionActor,
    profileId: string,
    invoiceId: string,
    amountIrR: bigint,
    receipt: BankReceiptTopUpDetails
  ): Promise<BankReceiptRow> {
    const lookupKeys = invoiceBankReceiptLookupKeys(receipt.attachmentKey);
    try {
      await client.query('BEGIN');
      await lockReceiptSubmissionActor(client, actor, profileId);
      const invoice = await this.lockInvoice(client, invoiceId, profileId);
      const storageRow = await this.lockAttachmentProvenance(
        client,
        receipt.attachmentKey,
        actor.userId,
        profileId
      );
      await claimBankReceiptAttachment(client, receipt.attachmentKey, 'invoice_receipt');

      const existing = await this.findReceiptByKeys(client, lookupKeys);
      if (existing) {
        assertReusableSubmitted(existing, invoiceId, profileId, amountIrR, receipt);
        await requireCurrentSession(client, actor);
        await client.query('COMMIT');
        return existing;
      }

      const sealed = await sealBankReceiptAttachment(
        client,
        this.storage,
        actor.userId,
        receipt.attachmentKey,
        storageRow
      );
      await persistSealedBankReceipt(
        client,
        actor.userId,
        receipt.attachmentKey,
        storageRow,
        sealed
      );

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
        ]
      );

      await auditReceiptSubmission(
        client,
        actor,
        profileId,
        String(inserted.rows[0]!.id),
        'invoice'
      );
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return inserted.rows[0] as unknown as BankReceiptRow;
    } catch (error) {
      await client.query('ROLLBACK');
      if (isPgUniqueViolation(error, BANK_RECEIPTS_ATTACHMENT_CONSTRAINT)) {
        await client.query('BEGIN');
        try {
          await lockReceiptSubmissionActor(client, actor, profileId);
          await this.lockInvoice(client, invoiceId, profileId);
          const committed = await this.findReceiptByKeys(client, lookupKeys);
          if (!committed)
            throw new ConflictException('This bank receipt attachment has already been submitted');
          assertReusableSubmitted(committed, invoiceId, profileId, amountIrR, receipt);
          await requireCurrentSession(client, actor);
          await client.query('COMMIT');
          return committed;
        } catch (retryError) {
          await client.query('ROLLBACK');
          throw retryError;
        }
      }
      throw error;
    }
  }

  private async findReceiptByKeys(
    client: QueryClient,
    lookupKeys: string[],
    forUpdate = true
  ): Promise<BankReceiptRow | null> {
    const result = await client.query(
      `SELECT id, invoice_id, profile_id, amount, to_char(payment_date, 'YYYY-MM-DD') AS payment_date,
              payer_reference, attachment_key, customer_note, state
         FROM bank_receipts
        WHERE attachment_key = ANY($1::text[])${forUpdate ? ' FOR UPDATE' : ''}`,
      [lookupKeys]
    );
    return result.rows.length > 0 ? (result.rows[0] as unknown as BankReceiptRow) : null;
  }

  private async lockInvoice(
    client: QueryClient,
    invoiceId: string,
    profileId: string
  ): Promise<InvoiceLockRow> {
    const result = await client.query(
      `SELECT id, profile_id, state, adjustment_kind
         FROM invoices
        WHERE id = $1 AND profile_id = $2 AND state <> 'Draft'
        FOR UPDATE`,
      [invoiceId, profileId]
    );
    if (result.rows.length === 0) {
      throw httpError(ErrorCodes.NOT_FOUND_RESOURCE, `Invoice not found: ${invoiceId}`, 404);
    }
    const invoice = result.rows[0] as unknown as InvoiceLockRow;
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
        409
      );
    }
    return invoice;
  }

  private async lockAttachmentProvenance(
    client: QueryClient,
    attachmentKey: string,
    actorId: string,
    profileId: string
  ): Promise<StorageLockRow> {
    const result = await client.query(
      `SELECT status, metadata, file_size, content_type, category, file_name
         FROM storage_records
        WHERE storage_key = $1
        FOR UPDATE`,
      [attachmentKey]
    );
    if (result.rows.length === 0) {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment has not been uploaded and recorded'
      );
    }
    const row = result.rows[0] as unknown as StorageLockRow;
    if (row.status === 'removed') {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment is no longer available'
      );
    }
    if (row.status !== 'active' && row.status !== 'immutable') {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment is no longer available'
      );
    }

    const provenance = evaluateBankReceiptStorageMetadata(row.metadata, actorId, profileId);
    if (!provenance.ok) {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        STORAGE_REJECTION_MESSAGE[provenance.reason]
      );
    }
    return row;
  }
}

function assertReusableSubmitted(
  existing: BankReceiptRow,
  invoiceId: string,
  profileId: string,
  amountIrR: bigint,
  receipt: BankReceiptTopUpDetails
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
      receipt
    );
  if (!sameReceipt) {
    throw new ConflictException('This bank receipt attachment has already been submitted');
  }
}

function mapReceipt(row: BankReceiptRow): SubmitInvoiceBankReceiptResult {
  if (row.state !== 'Submitted') {
    throw new ConflictException('This bank receipt attachment has already been submitted');
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
  };
}

function isPgUniqueViolation(error: unknown, constraint?: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code !== PG_UNIQUE_VIOLATION) return false;
  return constraint === undefined || pgError.constraint === constraint;
}

function httpError(
  def: { code: string; httpStatus: number },
  message: string,
  statusCode = def.httpStatus
): never {
  throw new HttpException({ statusCode, error: def.code, message }, statusCode);
}
