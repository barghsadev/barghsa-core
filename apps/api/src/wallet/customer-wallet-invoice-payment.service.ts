import { HttpException, Injectable } from '@nestjs/common';
import { getDbPool } from '@barghsa/db';
import { ErrorCodes } from '@barghsa/shared/errors';
import { remainingForWalletPayment, walletAvailableBalance } from '@barghsa/shared/finance';
import type { PoolClient } from 'pg';
import type { ValidatedSession } from '../session/session.service.js';
import { requireCurrentSession, requireSessionStepUp } from '../session/session-step-up.js';
import { activeProfileSql } from '../profiles/profile-context.js';
import { lockFinancialSubmissionActor } from '../finance/financial-submission-actor.js';
import { lockWalletProfile } from './profile-lock.js';
import { PayInvoiceWithWalletService } from './pay-invoice-with-wallet.service.js';

type Actor = Pick<ValidatedSession, 'userId' | 'sessionId' | 'csrfToken'>;

@Injectable()
export class CustomerWalletInvoicePaymentService {
  constructor(private readonly payments: PayInvoiceWithWalletService) {}

  /** Keep profile, account and session authority until the financial transaction finishes. */
  private async authorized<T>(
    actor: Actor,
    write: boolean,
    run: (client: PoolClient, profileId: string) => Promise<T>
  ) {
    const client = await getDbPool().connect();
    try {
      await client.query('BEGIN');
      const profile = (await client.query(activeProfileSql('wallet:move-funds'), [actor.userId]))
        .rows[0];
      if (!profile) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      await lockWalletProfile(client, 'profile', profile.id);
      await lockFinancialSubmissionActor(client, actor, profile.id, 'wallet:move-funds');
      const current = (await client.query(activeProfileSql('wallet:move-funds'), [actor.userId]))
        .rows[0];
      if (current?.id !== profile.id)
        throw new HttpException({ error: ErrorCodes.CONFLICT_STATE.code }, 409);
      if (write) await requireSessionStepUp(client, actor);
      const result = await run(client, profile.id);
      if (write) await requireSessionStepUp(client, actor);
      else await requireCurrentSession(client, actor);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  context(actor: Actor, invoiceId: string) {
    return this.authorized(actor, false, async (client, profileId) => {
      const wallet = (
        await client.query(
          'SELECT posted_balance,reserved_balance FROM wallets WHERE profile_id=$1 FOR SHARE',
          [profileId]
        )
      ).rows[0];
      const invoice = (
        await client.query(
          `SELECT state,total_amount,paid_amount,adjustment_kind,payable_from<=clock_timestamp() AS payable
         FROM invoices WHERE id=$1 AND profile_id=$2 AND state<>'Draft' FOR SHARE`,
          [invoiceId, profileId]
        )
      ).rows[0];
      if (!invoice) throw new HttpException({ error: ErrorCodes.NOT_FOUND_RESOURCE.code }, 404);
      const remaining = remainingForWalletPayment({
        totalAmount: BigInt(invoice.total_amount),
        paidAmount: BigInt(invoice.paid_amount),
        state: invoice.state,
        adjustmentKind: invoice.adjustment_kind,
      });
      const available = wallet
        ? walletAvailableBalance(BigInt(wallet.posted_balance), BigInt(wallet.reserved_balance))
        : 0n;
      return {
        invoiceId,
        profileId,
        remainingAmount: remaining.toString(),
        availableBalance: available.toString(),
        canPay: invoice.payable === true && remaining > 0n && available >= remaining,
      };
    });
  }

  pay(
    actor: Actor,
    invoiceId: string,
    idempotencyKey: string,
    expectedRemainingAmount: bigint,
    ip: string,
    correlationId?: string
  ) {
    return this.authorized(actor, true, async (client, profileId) => {
      const result = await this.payments.payInvoiceWithWallet(
        invoiceId,
        profileId,
        idempotencyKey,
        {
          client,
          expectedRemainingAmount,
          actorUserId: actor.userId,
          ip,
          ...(correlationId ? { correlationId } : {}),
        }
      );
      return {
        invoiceId: result.invoiceId,
        profileId: result.profileId,
        idempotencyKey,
        state: result.toState,
        amount: result.remainingPaid.toString(),
        walletTransactionId: result.walletTransaction.id,
        auditId: result.auditId,
      };
    });
  }
}
