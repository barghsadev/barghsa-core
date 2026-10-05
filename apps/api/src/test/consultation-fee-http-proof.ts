import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/** Generic successful wrapper audits remain expected; financial/domain effects occur once. */
export async function consultationFeeEffects(
  pool: Pool,
  requestId: string,
  resolutionReplay = false
) {
  return (
    await pool.query(
      `SELECT to_jsonb(r) AS request,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM invoices i WHERE consultation_id=$1) AS invoices,
      (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM consultation_request_events e WHERE request_id=$1::uuid) AS events,
      (SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM refunds f JOIN invoices i ON i.id=f.invoice_id WHERE i.consultation_id=$1) AS refunds,
      (SELECT jsonb_agg(to_jsonb(j) ORDER BY j.refund_id) FROM refund_retry_jobs j JOIN refunds f ON f.id=j.refund_id JOIN invoices i ON i.id=f.invoice_id WHERE i.consultation_id=$1) AS refund_jobs,
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM audit_log a WHERE NOT (event='consultation.request.changed' AND
        (COALESCE(metadata::jsonb->>'action','') IN ('fee_set','paid_fee_adjusted') OR
          ($2::boolean AND COALESCE(metadata::jsonb->>'action','') IN ('paid_cancel','paid_reject','refund_recovered'))))) AS financial_audits,
      (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM in_app_notifications n) AS notices
     FROM consultation_requests r WHERE id=$1::uuid`,
      [requestId, resolutionReplay]
    )
  ).rows[0];
}

export async function consultationReplayActor(pool: Pool, userId: string, roleId: string) {
  await pool.query(
    "INSERT INTO users(user_id,username,password_hash,is_staff) VALUES($1,$2,'test-only',true)",
    [userId, `${userId}@consultation-replay.test`]
  );
  await pool.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)', [userId, roleId]);
  const session = randomUUID(),
    csrf = randomUUID();
  await pool.query(
    `INSERT INTO sessions(session_id,user_id,csrf_token,family_id,expires_at,idle_deadline,step_up_verified_at)
    VALUES($1,$2,$3,$4,NOW()+INTERVAL '1 day',NOW()+INTERVAL '30 minutes',NOW())`,
    [session, userId, csrf, randomUUID()]
  );
  return {
    Cookie: `barghsa_session=${session}`,
    'X-CSRF-Token': csrf,
    'Content-Type': 'application/json',
  };
}

export async function waitForCapturedConsultationDeadline(validUntil: string) {
  await new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, new Date(validUntil).getTime() - Date.now() + 25))
  );
}
