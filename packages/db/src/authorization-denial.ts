import type { Pool } from 'pg';

export interface AuthorizationDenial {
  actorId: string;
  resource: string;
  action: string;
  reason: string;
  correlationId: string | null;
  createdAt: Date;
}

export async function recordAuthorizationDenial(pool: Pool, event: AuthorizationDenial) {
  await pool.query(
    `INSERT INTO authorization_denials(actor_id,resource,action,reason,correlation_id,created_at)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      event.actorId,
      event.resource,
      event.action,
      event.reason,
      event.correlationId,
      event.createdAt,
    ]
  );
}
