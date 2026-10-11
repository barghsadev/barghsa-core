import type { Pool } from 'pg';
import { enqueueOutbox } from '../notifications/outbox-writer.js';

const purposeLabels: Record<string, string> = {
  login: 'ورود / Sign-in',
  registration: 'ثبت‌نام / Registration',
  password_reset: 'بازیابی رمز عبور / Password reset',
  change_username: 'تغییر نام کاربری / Username change',
  add_email: 'افزودن ایمیل / Add email',
  add_mobile: 'افزودن تلفن همراه / Add mobile',
  step_up: 'تأیید امنیتی / Security verification',
  account_recovery: 'بازیابی حساب / Account recovery',
};

/** Independent of provider delivery: a failed notice transaction never resends an OTP. */
export async function publishAuthDeliveryNotice(pool: Pool): Promise<'idle' | 'published'> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (
      await client.query<{
        id: string;
        notice_user_id: string;
        purpose: string;
        channel: 'email' | 'sms';
        sent_at: Date;
        correlation_id: string | null;
      }>(
        `SELECT d.id,d.notice_user_id,c.purpose,d.sent_at,d.correlation_id,
          CASE WHEN c.destination LIKE '%@%' THEN 'email' ELSE 'sms' END AS channel
         FROM auth_delivery_outbox d JOIN otp_challenges c ON c.challenge_id=d.challenge_id
         WHERE d.status='sent' AND d.kind='otp' AND d.inbox_notice_pending
           AND d.notice_user_id IS NOT NULL AND d.sent_at IS NOT NULL
         ORDER BY d.sent_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT 1`
      )
    ).rows[0];
    if (!row) {
      await client.query('COMMIT');
      return 'idle';
    }
    // NOWAIT avoids lock inversion with registration's user-then-delivery writes.
    const recipient = await client.query(
      `SELECT user_id FROM users WHERE user_id=$1 AND disabled_at IS NULL
       AND activation_token IS NULL FOR SHARE NOWAIT`,
      [row.notice_user_id]
    );
    if (recipient.rowCount === 1) {
      const payload = {
        purpose: purposeLabels[row.purpose] ?? 'تأیید حساب / Account verification',
        channel: row.channel === 'email' ? 'ایمیل / Email' : 'پیامک / SMS',
        sentAt: row.sent_at.toISOString(),
      };
      const occurrence = `auth.otp_sent:${row.id}:${row.notice_user_id}`;
      await enqueueOutbox(client, {
        profileId: null,
        userId: row.notice_user_id,
        eventKey: 'auth.otp_sent',
        payload,
        channels: ['in_app'],
        idempotencyKey: occurrence,
        correlationId: row.correlation_id,
      });
      const saved = await client.query(
        `SELECT ob.id FROM notification_outbox ob
         WHERE ob.idempotency_key=$1 AND ob.user_id=$2 AND ob.profile_id IS NULL
           AND ob.event_key='auth.otp_sent' AND ob.payload=$3::jsonb AND ob.channels=ARRAY['in_app']
           AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='in_app')`,
        [occurrence, row.notice_user_id, payload]
      );
      if (saved.rowCount !== 1) throw new Error('Auth delivery notice intent was not stored');
    }
    await client.query('UPDATE auth_delivery_outbox SET inbox_notice_pending=false WHERE id=$1', [
      row.id,
    ]);
    await client.query('COMMIT');
    return 'published';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
