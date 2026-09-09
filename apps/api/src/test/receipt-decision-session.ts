import { v5 as uuidv5 } from 'uuid';
import type { Pool } from 'pg';

/** Stable identities keep concurrent direct-service receipt fixtures on real sessions. */
export function receiptDecisionSession(userId: string) {
  return {
    sessionId: uuidv5(`receipt-session:${userId}`, uuidv5.URL),
    csrfToken: uuidv5(`receipt-csrf:${userId}`, uuidv5.URL),
  };
}

export async function seedReceiptDecisionSessions(pool: Pool, userIds: string[]) {
  for (const userId of userIds) {
    const { sessionId, csrfToken } = receiptDecisionSession(userId);
    await pool.query(
      `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
       VALUES ($1,$2,$3,$1,NOW()+INTERVAL '1 hour',NOW()+INTERVAL '30 minutes',NOW())`,
      [sessionId, userId, csrfToken]
    );
  }
}
