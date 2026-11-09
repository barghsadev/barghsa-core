import { createHash } from 'node:crypto';

export const SESSION_REFERENCE_PATTERN = /^session-ref:([a-f0-9]{64})$/;

/** A stable display and management reference that cannot authenticate a request. */
export function sessionReference(sessionId: string): string {
  return `session-ref:${createHash('sha256').update(sessionId).digest('hex')}`;
}
