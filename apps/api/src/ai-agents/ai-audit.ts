import { getDbPool, type NewAiAuditRecord } from '@barghsa/db';
import { v7 as uuidv7 } from 'uuid';
import { correlationIdStorage } from '../common/correlation-id.middleware.js';
import { redactAiText, type SensitiveCategory } from './ai-prompt-redaction.js';
import { z } from 'zod';

const auditIdentifier = z.string().uuid();
const inputIdentifierKeys = new Set(['requestId', 'agentId', 'conversationId']);

export type AiAuditEvent = Pick<
  NewAiAuditRecord,
  | 'sessionId'
  | 'userId'
  | 'profileId'
  | 'agentSlot'
  | 'toolName'
  | 'input'
  | 'output'
  | 'authorizationResult'
> &
  Partial<
    Pick<
      NewAiAuditRecord,
      'confirmationRequired' | 'confirmationResult' | 'tokenUsage' | 'latencyMs'
    >
  >;

function sanitize(value: unknown, categories: Set<SensitiveCategory>, depth = 0): unknown {
  if (typeof value === 'string') {
    const result = redactAiText(value);
    result.categories.forEach((category) => categories.add(category));
    return result.text.slice(0, 4000);
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (depth >= 5) return '[TRUNCATED]';
  if (Array.isArray(value))
    return value.slice(0, 30).map((item) => sanitize(item, categories, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, item]) => [key.slice(0, 120), sanitize(item, categories, depth + 1)])
    );
  return null;
}

function safePayload(
  payload: Record<string, unknown>,
  structuredInput = false
): Record<string, unknown> {
  const categories = new Set<SensitiveCategory>();
  const sanitized = Object.fromEntries(
    Object.entries(payload)
      .slice(0, 30)
      .map(([key, value]) => [
        key.slice(0, 120),
        // Typed input IDs must stay usable for audit lookup. Free-form and output
        // content still follows the full sensitive-data redaction policy.
        structuredInput && inputIdentifierKeys.has(key) && auditIdentifier.safeParse(value).success
          ? value
          : sanitize(value, categories, 1),
      ])
  );
  return { ...sanitized, redactionCategories: [...categories] };
}

/** One append-only row per AI request or authorization decision. */
export async function appendAiAudit(event: AiAuditEvent): Promise<void> {
  const correlationId = correlationIdStorage.getStore() ?? uuidv7();
  await getDbPool().query(
    `INSERT INTO ai_audit_log
      (session_id,user_id,profile_id,agent_slot,tool_name,input,output,
       authorization_result,confirmation_required,confirmation_result,
       correlation_id,token_usage,latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      event.sessionId ?? null,
      event.userId ?? null,
      event.profileId ?? null,
      event.agentSlot ?? null,
      event.toolName,
      JSON.stringify(safePayload(event.input, true)),
      JSON.stringify(safePayload(event.output)),
      event.authorizationResult,
      event.confirmationRequired ?? false,
      event.confirmationResult ?? null,
      correlationId,
      event.tokenUsage ? JSON.stringify(event.tokenUsage) : null,
      event.latencyMs ?? null,
    ]
  );
}
