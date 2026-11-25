import {
  AUTHORIZATION_AUDIT_ACTION,
  AUTHORIZATION_AUDIT_ACTOR,
  isAuthorizationAuditDay,
} from '@barghsa/shared/admin';

export const authorizationAuditFilterKeys = ['actor', 'action', 'from', 'through'] as const;

export interface AuthorizationAuditFilters {
  actor?: string;
  action?: string;
  from?: string;
  through?: string;
}

export function authorizationAuditSearch(raw: Record<string, unknown>): AuthorizationAuditFilters {
  const { actor, action, from, through } = raw;
  const start = isAuthorizationAuditDay(from) ? from : undefined;
  const lastDay = isAuthorizationAuditDay(through) && (!start || through >= start);
  return {
    ...(typeof actor === 'string' && AUTHORIZATION_AUDIT_ACTOR.test(actor) ? { actor } : {}),
    ...(typeof action === 'string' && AUTHORIZATION_AUDIT_ACTION.test(action) ? { action } : {}),
    ...(start ? { from: start } : {}),
    ...(lastDay ? { through } : {}),
  };
}
