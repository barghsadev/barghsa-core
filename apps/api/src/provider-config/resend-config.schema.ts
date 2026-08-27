import { z } from 'zod'

/**
 * Resend provider configuration schema (E-05, T-05.06.03).
 *
 * Transport-specific fields stored (opaque, encrypted at rest elsewhere —
 * T-05.00.05 / T-05.06.05) inside the `email_provider_configs.config`
 * JSONB column for `transport = 'resend'`. The connection tester parses with
 * these defaults before calling the Resend HTTP API.
 */

export const ResendConfigSchema = z.object({
  /** Resend API key (encrypted at rest — never surfaced). */
  api_key: z.string().min(1).max(1024),
  /** Optional human-friendly sender name used with `from_email`. */
  from_name: z.string().max(255).optional(),
  /** Required sender e-mail address; its domain must be verified in Resend. */
  from_email: z.string().email().max(320),
  /** Optional reply-to e-mail address. */
  reply_to: z.string().email().max(320).optional(),
  /**
   * Explicit sending domain to verify. When absent, the domain of
   * `from_email` is checked instead.
   */
  sending_domain: z.string().min(1).max(253).optional(),
})

export type ResendConfig = z.infer<typeof ResendConfigSchema>

export interface ResendConfigParseOk {
  ok: true
  config: ResendConfig
}

export interface ResendConfigParseError {
  ok: false
  error: string
}

export type ResendConfigParseResult = ResendConfigParseOk | ResendConfigParseError

/** Parse an opaque stored config blob into a validated `ResendConfig`. */
export function parseResendConfig(raw: unknown): ResendConfigParseResult {
  const parsed = ResendConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
        return `${path}: ${issue.message}`
      })
      .join('; ')
    return { ok: false, error: details }
  }
  return { ok: true, config: parsed.data }
}