import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { withCopyTransaction } from '../storage/storage-copy-transaction.js';
import { privateLogId } from '@barghsa/shared/log-privacy';
import { InputFieldException } from '../common/input-field.exception.js';
import {
  prepareBankReceiptAttachment,
  persistSealedBankReceipt,
  type StorageLockRow,
  type ReceiptSourceSnapshot,
} from '../finance/seal-bank-receipt-attachment.js';
import type { StorageProvider } from '@barghsa/shared/storage';
import { STORAGE_PROVIDER } from '../storage/storage.constants.js';
import {
  auditReceiptSubmission,
  lockReceiptSubmissionActor,
  type ReceiptSubmissionActor,
} from '../finance/receipt-submission-actor.js';
import { requireCurrentSession } from '../session/session-step-up.js';
import { observePaymentKeyConflict } from '../metrics/payment-idempotency-metrics.js';
import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  Inject,
  Optional,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import {
  BANK_RECEIPT_TOPUP_DESCRIPTION,
  bankReceiptTopUpMetadata,
  evaluateBankReceiptStorageMetadata,
  parseBankReceiptTopUpSubmission,
  parseBankReceiptTopUpReview,
  receiptDetailsMatch,
  invoiceBankReceiptLookupKeys,
  type BankReceiptTopUpReview,
  type BankReceiptStorageRejection,
  type BankReceiptTopUpDetails,
} from '@barghsa/shared/finance';
import {
  bankReceiptAttachmentAdvisoryLockKeys,
  claimBankReceiptAttachment,
  checkBankReceiptAttachmentClaim,
} from '../finance/claim-bank-receipt-attachment.js';
import { WalletService, type TransactionRow } from './wallet.service.js';
import {
  checkProfileFinancialRateLimit,
  enforceProfileFinancialRateLimit,
} from '../finance/profile-financial-rate-limit.js';
import { ReviewSnapshotService } from '../finance/review-snapshot.service.js';

const PG_UNIQUE_VIOLATION = '23505';
const WALLET_TX_IDEMPOTENCY_CONSTRAINT = 'idx_wallet_tx_idempotency';
const WALLET_TX_RECEIPT_ATTACHMENT_CONSTRAINT = 'uq_wallet_tx_receipt_attachment';

const STORAGE_REJECTION_MESSAGE: Record<BankReceiptStorageRejection, string> = {
  missing: 'Bank receipt attachment has not been verified',
  unverified: 'Bank receipt attachment has not been verified',
  wrong_owner: 'Bank receipt attachment does not belong to this account',
  wrong_purpose: 'Bank receipt attachment was not uploaded as a bank receipt',
};

export interface SubmitBankReceiptTopUpInput extends Omit<ReceiptSubmissionActor, 'userId'> {
  profileId: string;
  amount: unknown;
  paymentDate: unknown;
  payerReference: unknown;
  attachmentKey: unknown;
  customerNote?: unknown;
  bankName?: unknown;
  idempotencyKey: string;
  actorId: string;
  /** Required by the customer HTTP route; internal callers may submit accepted receipts. */
  expectedReviewHash?: string;
}

export interface SubmitBankReceiptTopUpResult {
  transactionId: string;
  amount: bigint;
  state: 'Pending';
  paymentDate: string;
  payerReference: string;
  attachmentKey: string;
}

interface QueryClient {
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/**
 * Bank-receipt wallet top-up submission (T-04.2.02.03 / S-04.2.02).
 *
 * Under the shared attachment and idempotency locks, validate current authority,
 * provenance and review, then read and copy the bytes between transactions.
 * The final transaction rechecks the source and atomically creates any missing
 * wallet, claims the attachment and records a Pending ledger row and audit.
 * A matching retry keeps its first committed copy.
 *
 * Wallet credit is deferred to staff confirmation (T-04.2.02.04).
 * Rejected submissions never increase posted or reserved balance.
 */
@Injectable()
export class BankReceiptTopUpService {
  private readonly logger = new Logger(BankReceiptTopUpService.name);
  private readonly reviews = new ReviewSnapshotService();

  constructor(
    private readonly walletService: WalletService,
    @Optional() @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider | null = null
  ) {}

  private financialReview(
    profileId: string,
    amountIrR: bigint,
    receipt: BankReceiptTopUpDetails,
    storageRow: StorageLockRow
  ): BankReceiptTopUpReview {
    return this.reviews.create(
      {
        action: 'wallet.bank-receipt-topup-submission',
        profileId,
        resourceId: profileId,
      },
      {
        profileId,
        amountIrR: amountIrR.toString(),
        paymentDate: receipt.paymentDate,
        payerReference: receipt.payerReference,
        attachmentKey: receipt.attachmentKey,
        fileName: storageRow.file_name || receipt.attachmentKey.split('/').at(-1)!,
        fileSizeBytes: storageRow.file_size == null ? null : String(storageRow.file_size),
        customerNote: receipt.customerNote,
        ...(receipt.bankName ? { bankName: receipt.bankName } : {}),
        stateAfterSubmission: 'Pending' as const,
        creditRule: 'after_finance_confirmation' as const,
      }
    );
  }

  async review(input: SubmitBankReceiptTopUpInput): Promise<BankReceiptTopUpReview> {
    const key = input.idempotencyKey.trim();
    if (!key) throw httpError(ErrorCodes.VALIDATION_INPUT_MISSING, 'Idempotency key is required');
    const parsed = parseBankReceiptTopUpSubmission(input);
    if (!parsed.ok) throw new InputFieldException([parsed.field]);
    const pool = getDbPool({ session: true });
    const client = await pool.connect();
    const actor: ReceiptSubmissionActor = {
      userId: input.actorId,
      sessionId: input.sessionId,
      csrfToken: input.csrfToken,
      ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    };
    try {
      await client.query('BEGIN');
      await lockReceiptSubmissionActor(client, actor, input.profileId);
      const storageRow = await this.lockAttachmentProvenance(
        client,
        parsed.receipt.attachmentKey,
        actor.userId,
        input.profileId
      );
      const existing = (
        await client.query('SELECT * FROM wallet_transactions WHERE idempotency_key=$1 FOR SHARE', [
          key,
        ])
      ).rows[0];
      let review: BankReceiptTopUpReview;
      if (existing) {
        assertMatchingPendingBankReceipt(
          existing as Parameters<typeof assertMatchingPendingBankReceipt>[0],
          input.profileId,
          parsed.amountIrR,
          parsed.receipt
        );
        const stored = parseBankReceiptTopUpReview(
          (existing.metadata as { financialReview?: unknown } | null)?.financialReview
        );
        if (stored) {
          if (
            stored.data.profileId !== input.profileId ||
            stored.data.amountIrR !== parsed.amountIrR.toString() ||
            stored.data.paymentDate !== parsed.receipt.paymentDate ||
            stored.data.payerReference !== parsed.receipt.payerReference ||
            stored.data.attachmentKey !== parsed.receipt.attachmentKey ||
            stored.data.customerNote !== parsed.receipt.customerNote ||
            (stored.data.bankName ?? null) !== (parsed.receipt.bankName ?? null)
          )
            throw new ConflictException('Stored receipt review requires reconciliation');
          this.reviews.assertConfirmed(stored, stored.hash);
          review = stored;
        } else if ((existing.metadata as { financialReview?: unknown } | null)?.financialReview) {
          throw new ConflictException('Stored receipt review requires reconciliation');
        } else {
          review = this.financialReview(
            input.profileId,
            parsed.amountIrR,
            parsed.receipt,
            storageRow
          );
        }
      } else {
        review = this.financialReview(
          input.profileId,
          parsed.amountIrR,
          parsed.receipt,
          storageRow
        );
      }
      await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return review;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private assertStoredReview(
    row: TransactionRow,
    profileId: string,
    expectedReviewHash: string | undefined
  ): void {
    if (!expectedReviewHash) return;
    const metadata = row.metadata as { financialReview?: unknown } | null;
    if (!metadata?.financialReview) return; // Accepted before review snapshots were introduced.
    this.reviews.assertStored(metadata, expectedReviewHash, {
      action: 'wallet.bank-receipt-topup-submission',
      profileId,
      resourceId: profileId,
    });
  }

  async submit(input: SubmitBankReceiptTopUpInput): Promise<SubmitBankReceiptTopUpResult> {
    const idempotencyKey = input.idempotencyKey.trim();
    if (!idempotencyKey) {
      throw httpError(ErrorCodes.VALIDATION_INPUT_MISSING, 'Idempotency key is required');
    }

    const parsed = parseBankReceiptTopUpSubmission({
      amount: input.amount,
      paymentDate: input.paymentDate,
      payerReference: input.payerReference,
      attachmentKey: input.attachmentKey,
      customerNote: input.customerNote,
      bankName: input.bankName,
    });
    if (!parsed.ok) {
      throw new InputFieldException([parsed.field]);
    }

    const pool = getDbPool({ session: true });
    const attachmentLockKeys = bankReceiptAttachmentAdvisoryLockKeys(parsed.receipt.attachmentKey);
    const idempotencyLockKeys = bankReceiptTopUpAdvisoryLockKeys(idempotencyKey);
    const client = await pool.connect();
    let discard = false;
    try {
      // Attachment first, then idempotency, so concurrent different-key
      // submissions of the same file cannot deadlock.
      await client.query('SELECT pg_advisory_lock($1, $2)', attachmentLockKeys);
      try {
        await client.query('SELECT pg_advisory_lock($1, $2)', idempotencyLockKeys);
        try {
          const pending = await this.insertOrReusePending(
            client,
            input.profileId,
            parsed.amountIrR,
            idempotencyKey,
            parsed.receipt,
            input.expectedReviewHash,
            {
              userId: input.actorId,
              sessionId: input.sessionId,
              csrfToken: input.csrfToken,
              ...(input.correlationId ? { correlationId: input.correlationId } : {}),
            }
          );
          this.logger.log(
            `Bank receipt top-up ${pending.id} pending for wallet ${privateLogId('profile', pending.walletId)}`
          );
          return {
            transactionId: pending.id,
            amount: pending.amount,
            state: 'Pending',
            paymentDate: parsed.receipt.paymentDate,
            payerReference: parsed.receipt.payerReference,
            attachmentKey: (pending.metadata as { receipt: BankReceiptTopUpDetails }).receipt
              .attachmentKey,
          };
        } finally {
          await client.query('SELECT pg_advisory_unlock($1, $2)', idempotencyLockKeys);
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1, $2)', attachmentLockKeys);
      }
    } catch (error) {
      discard = true;
      throw error;
    } finally {
      client.release(discard);
    }
  }

  /** Lock and validate source provenance. New submissions freeze both source and sealed copy. */
  private async lockAttachmentProvenance(
    client: QueryClient,
    attachmentKey: string,
    actorId: string,
    profileId: string
  ): Promise<ReceiptSourceSnapshot> {
    const result = await client.query(
      `SELECT status, metadata, file_size, content_type, category, file_name, id AS storage_id, xmin::text AS storage_revision FROM storage_records WHERE storage_key = $1 FOR UPDATE`,
      [attachmentKey]
    );
    if (result.rows.length === 0) {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment has not been uploaded and recorded'
      );
    }
    const row = result.rows[0] as unknown as ReceiptSourceSnapshot;
    if (row.status === 'removed') {
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

    if (row.status === 'immutable') {
      return row;
    }
    if (row.status !== 'active') {
      throw httpError(
        ErrorCodes.VALIDATION_INPUT_INVALID,
        'Bank receipt attachment is no longer available'
      );
    }

    return row;
  }

  private async insertOrReusePending(
    client: PoolClient,
    profileId: string,
    amountIrR: bigint,
    idempotencyKey: string,
    receipt: BankReceiptTopUpDetails,
    expectedReviewHash: string | undefined,
    actor: ReceiptSubmissionActor
  ): Promise<TransactionRow> {
    const findPending = async (walletId: string) => {
      const idem = await client.query(
        'SELECT * FROM wallet_transactions WHERE idempotency_key = $1 FOR UPDATE',
        [idempotencyKey]
      );
      const existing = idem.rows[0];
      if (!existing) return null;
      assertMatchingPendingBankReceipt(
        existing as Parameters<typeof assertMatchingPendingBankReceipt>[0],
        walletId,
        amountIrR,
        receipt
      );
      const pending = mapTransaction(existing as Parameters<typeof mapTransaction>[0]);
      this.assertStoredReview(pending, profileId, expectedReviewHash);
      return pending;
    };
    const inspect = async (publishing: boolean) => {
      await lockReceiptSubmissionActor(client, actor, profileId);
      let canonicalWalletId = profileId.toLowerCase();
      if (publishing) {
        await this.walletService.createWallet(profileId, client);
        const wallet = (
          await client.query<{ profile_id: string }>(
            'SELECT profile_id FROM wallets WHERE profile_id = $1 FOR UPDATE',
            [profileId]
          )
        ).rows[0];
        if (!wallet) throw new NotFoundException(`Wallet not found: ${profileId}`);
        canonicalWalletId = wallet.profile_id;
      }
      const storageRow = await this.lockAttachmentProvenance(
        client,
        receipt.attachmentKey,
        actor.userId,
        profileId
      );
      if (publishing)
        await claimBankReceiptAttachment(client, receipt.attachmentKey, 'wallet_topup');
      else await checkBankReceiptAttachmentClaim(client, receipt.attachmentKey, 'wallet_topup');

      const existing = await findPending(canonicalWalletId);
      if (existing) {
        if (!publishing)
          await claimBankReceiptAttachment(client, receipt.attachmentKey, 'wallet_topup');
        await requireCurrentSession(client, actor);
        return { existing };
      }
      const attachmentResult = await client.query(
        'SELECT * FROM wallet_transactions WHERE receipt_attachment_key = ANY($1::text[]) FOR UPDATE',
        [invoiceBankReceiptLookupKeys(receipt.attachmentKey)]
      );
      if (attachmentResult.rows.length)
        throw new ConflictException('This bank receipt attachment has already been submitted');
      const review = this.financialReview(profileId, amountIrR, receipt, storageRow);
      if (expectedReviewHash) this.reviews.assertConfirmed(review, expectedReviewHash);
      if (!publishing) await checkProfileFinancialRateLimit(client, 'top-up', canonicalWalletId);
      await requireCurrentSession(client, actor);
      return { canonicalWalletId, storageRow, review };
    };
    try {
      const initial = await withCopyTransaction(() => inspect(false), client);
      if (initial.existing) return initial.existing;
      const sealed = await prepareBankReceiptAttachment(
        client,
        this.storage,
        actor.userId,
        receipt.attachmentKey,
        initial.storageRow
      );
      return await withCopyTransaction(async () => {
        const current = await inspect(true);
        if (current.existing) return current.existing;
        const { canonicalWalletId, storageRow, review } = current;
        if (
          storageRow.storage_id !== initial.storageRow.storage_id ||
          storageRow.storage_revision !== initial.storageRow.storage_revision
        )
          throw new ConflictException('Bank receipt upload changed; review it again');
        this.reviews.assertConfirmed(review, initial.review.hash);
        await enforceProfileFinancialRateLimit(client, 'top-up', canonicalWalletId);
        const receiptId = uuidv7();
        await persistSealedBankReceipt(
          client,
          actor.userId,
          receipt.attachmentKey,
          storageRow,
          sealed,
          { receiptId, profileId: canonicalWalletId, flow: 'wallet' }
        );
        const sealedReceipt = { ...receipt, attachmentKey: sealed.sealedKey };

        const txResult = await client.query(
          `INSERT INTO wallet_transactions
             (wallet_id, type, amount, state, idempotency_key, description, metadata, receipt_attachment_key, id)
           VALUES ($1, 'topup', $2::bigint, 'Pending', $3, $4, $5::jsonb, $6, $7::uuid)
           RETURNING *`,
          [
            canonicalWalletId,
            amountIrR.toString(),
            idempotencyKey,
            BANK_RECEIPT_TOPUP_DESCRIPTION,
            JSON.stringify({
              ...bankReceiptTopUpMetadata(sealedReceipt),
              ...(expectedReviewHash ? { financialReview: review } : {}),
            }),
            sealed.sealedKey,
            receiptId,
          ]
        );

        await auditReceiptSubmission(
          client,
          actor,
          profileId,
          String(txResult.rows[0]!.id),
          'wallet',
          expectedReviewHash ? review : undefined
        );
        await requireCurrentSession(client, actor);
        return mapTransaction(txResult.rows[0] as Parameters<typeof mapTransaction>[0]);
      }, client);
    } catch (error) {
      if (isPgUniqueViolation(error, WALLET_TX_IDEMPOTENCY_CONSTRAINT)) {
        return withCopyTransaction(async () => {
          await lockReceiptSubmissionActor(client, actor, profileId);
          await this.lockAttachmentProvenance(
            client,
            receipt.attachmentKey,
            actor.userId,
            profileId
          );
          await claimBankReceiptAttachment(client, receipt.attachmentKey, 'wallet_topup');
          const pending = await findPending(profileId.toLowerCase());
          if (!pending) throw new ConflictException('Idempotency key already used');
          await requireCurrentSession(client, actor);
          return pending;
        }, client);
      }
      if (isPgUniqueViolation(error, WALLET_TX_RECEIPT_ATTACHMENT_CONSTRAINT))
        throw new ConflictException('This bank receipt attachment has already been submitted');
      throw error;
    }
  }
}

export function bankReceiptTopUpAdvisoryLockKeys(idempotencyKey: string): [number, number] {
  const digest = createHash('sha256')
    .update(`wallet-bank-receipt-topup:${idempotencyKey}`)
    .digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export { bankReceiptAttachmentAdvisoryLockKeys };

function assertMatchingPendingBankReceipt(
  existing: {
    wallet_id: string;
    type: string;
    amount: string | number | bigint;
    state: string;
    metadata?: unknown;
    receipt_attachment_key?: string;
  },
  canonicalWalletId: string,
  amountIrR: bigint,
  receipt: BankReceiptTopUpDetails
): void {
  if (existing.wallet_id !== canonicalWalletId) {
    observePaymentKeyConflict('bank_receipt_topup');
    throw new ConflictException('Idempotency key already used for a different wallet');
  }
  const matchesPayment =
    existing.type === 'topup' &&
    BigInt(existing.amount) === amountIrR &&
    invoiceBankReceiptLookupKeys(receipt.attachmentKey).some(
      (attachmentKey) =>
        existing.receipt_attachment_key === attachmentKey &&
        receiptDetailsMatch(existing.metadata, { ...receipt, attachmentKey })
    );
  if (!matchesPayment) observePaymentKeyConflict('bank_receipt_topup');
  if (!matchesPayment || existing.state !== 'Pending') {
    throw new ConflictException('Idempotency key already used for a different wallet operation');
  }
}

function mapTransaction(row: {
  id: string;
  wallet_id: string;
  type: string;
  amount: string | number | bigint;
  state: string;
  idempotency_key: string;
  ref_id?: string | null;
  description?: string | null;
  metadata?: unknown;
  reverses_transaction_id?: string | null;
  created_at: Date;
  updated_at: Date;
}): TransactionRow {
  return {
    id: row.id,
    walletId: row.wallet_id,
    type: row.type,
    amount: BigInt(row.amount),
    state: row.state,
    idempotencyKey: row.idempotency_key,
    refId: row.ref_id ?? null,
    description: row.description ?? null,
    metadata: row.metadata ?? null,
    reversesTransactionId: row.reverses_transaction_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
