import { z } from 'zod'

/**
 * SMTP provider configuration schema (E-05, T-05.06.02).
 *
 * These are the transport-specific fields stored (opaque, encrypted at rest
 * elsewhere — T-05.00.05 / T-05.06.05) inside the `email_provider_configs.config`
 * JSONB column for `transport = 'smtp'`. Defaults are applied by Zod when a field
 * is absent, so stored blobs may be partial; the connection tester always parses
 * with these defaults before dialing.
 */

export const SmtpSecuritySchema = z.enum(['TLS', 'STARTTLS'])
export type SmtpSecurity = z.infer<typeof SmtpSecuritySchema>

export const SmtpConfigSchema = z.object({
  /** SMTP host name or IP literal. */
  host: z.string().min(1).max(253),
  /** TCP port; default 587 (submission). */
  port: z.number().int().min(1).max(65535).default(587),
  /**
   * 'TLS'  – connect over an immediate TLS tunnel (implicit TLS / SMTPS).
   * 'STARTTLS' – connect plaintext then upgrade via the STARTTLS command.
   */
  security: SmtpSecuritySchema.default('STARTTLS'),
  /** Optional SMTP AUTH username. */
  username: z.string().max(255).optional(),
  /** Optional SMTP AUTH password (encrypted at rest — never surfaced). */
  password: z.string().max(2048).optional(),
  /** TCP/greeting connect timeout in seconds; default 10. */
  connection_timeout: z.number().int().min(1).max(600).default(10),
  /** Per-command timeout in seconds; default 15. */
  command_timeout: z.number().int().min(1).max(600).default(15),
  /** Optional human-friendly sender name. */
  from_name: z.string().max(255).optional(),
  /** Required envelope sender e-mail address. */
  from_email: z.string().email().max(320),
  /** Optional reply-to e-mail address. */
  reply_to: z.string().email().max(320).optional(),
})

export type SmtpConfig = z.infer<typeof SmtpConfigSchema>

export interface SmtpConfigParseOk {
  ok: true
  config: SmtpConfig
}

export interface SmtpConfigParseError {
  ok: false
  error: string
}

export type SmtpConfigParseResult = SmtpConfigParseOk | SmtpConfigParseError

/** Parse an opaque stored config blob into a validated `SmtpConfig`. */
export function parseSmtpConfig(raw: unknown): SmtpConfigParseResult {
  const parsed = SmtpConfigSchema.safeParse(raw)
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
