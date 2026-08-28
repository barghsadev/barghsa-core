import { z } from 'zod'
import type { PolicyType } from './ai-policies.service.js'

const stringList = (field: string) =>
  z
    .array(z.string().min(1).max(200))
    .min(1, `At least one ${field} is required`)
    .max(200)

/**
 * Structured guardrail documents, validated per policy kind. These match
 * the shapes the consumer (AI agents, T-09.11.04) will interpret.
 *
 * Shared between the controller (create/update payload validation) and the
 * service (authoritative cross-validation on update, where the stored
 * policy_type is known) so both enforce the same per-kind contract.
 */
export const rulesSchemas: Record<PolicyType, z.ZodType> = {
  allowed_topics: z.object({
    topics: stringList('topic'),
  }),
  disallowed_actions: z.object({
    actions: stringList('action'),
  }),
  data_access_scope: z.object({
    scopes: stringList('scope'),
  }),
  response_style: z.object({
    tone: z.string().min(1, 'tone is required').max(200),
    language: z.string().max(50).optional(),
    maxLength: z.number().int().positive().max(100000).optional(),
  }),
}

/** Flattened zod issues for client-facing validation detail. */
export function rulesErrorDetails(issues: z.ZodIssue[]): Array<{ path: string; message: string }> {
  return issues.map((issue) => ({
    path: `rules.${issue.path.join('.')}`,
    message: issue.message,
  }))
}
