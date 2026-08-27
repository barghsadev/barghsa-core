import { z } from 'zod'

/**
 * SMS.ir provider configuration schema (T-09.06.02).
 *
 * Transport-specific fields stored (opaque, encrypted at rest elsewhere —
 * T-05.06.05) inside the `sms_provider_configs.config` JSONB column for
 * `transport = 'smsir'`. The connection tester parses with these defaults
 * before calling the SMS.ir HTTP API.
 *
 * SMS.ir configuration surface:
 * - `api_key` (secret, encrypted at rest — never surfaced)
 * - `sender` — sender/line number
 * - `timeout` — request timeout seconds
 * - `throughput_limit` — max outbound messages per minute (per-message ms)
 * - `low_credit_threshold` — balance watermark that triggers replenishment alerts
 * - `template_mappings` — internal event key -> SMS.ir TemplateId + variable mapping
 *
 * The SMS.ir base URL is application-managed (`SMSIR_API_BASE`) and is NOT an
 * admin-editable field: it is intentionally absent here so a malicious/buggy
 * client cannot redirect the provider to an arbitrary endpoint.
 */

const TemplateVariableMappingSchema = z.record(z.string().min(1).max(255), z.string().min(1).max(255))

/** One internal-event -> SMS.ir template mapping (T-09.06.02 admin UI). */
export const SmsirTemplateMappingSchema = z.object({
  /** Internal notification event key (e.g. `otp:login`). */
  event_key: z.string().min(1).max(128),
  /** SMS.ir message template id returned by the platform. */
  template_id: z.string().min(1).max(128),
  /** Map of internal template variable name -> SMS.ir parameter name. */
  variables: TemplateVariableMappingSchema.optional(),
})

export const SmsirConfigSchema = z.object({
  /** SMS.ir API key (encrypted at rest — never surfaced). */
  api_key: z.string().min(1).max(1024),
  /** Sender / line number that outbound SMS appear to come from. */
  sender: z.string().min(1).max(64),
  /** Request timeout in seconds; default 15. */
  timeout: z.number().int().min(1).max(300).default(15),
  /**
   * Max outbound messages per minute, applied by the sender to stay within the
   * SMS.ir account's throughput contract. Default 100.
   */
  throughput_limit: z.number().int().min(1).max(10000).default(100),
  /**
   * Account credit balance (in messages or Rial as reported by SMS.ir) below
   * which a replenishment alert is raised. 0 disables the alert.
   */
  low_credit_threshold: z.number().int().min(0).max(1_000_000_000).default(0),
  /** Internal event -> SMS.ir template mappings. */
  template_mappings: z.array(SmsirTemplateMappingSchema).optional(),
})

export type SmsirConfig = z.infer<typeof SmsirConfigSchema>
export type SmsirTemplateMapping = z.infer<typeof SmsirTemplateMappingSchema>

export interface SmsirConfigParseOk {
  ok: true
  config: SmsirConfig
}

export interface SmsirConfigParseError {
  ok: false
  error: string
}

export type SmsirConfigParseResult = SmsirConfigParseOk | SmsirConfigParseError

/** Parse an opaque stored config blob into a validated `SmsirConfig`. */
export function parseSmsirConfig(raw: unknown): SmsirConfigParseResult {
  const parsed = SmsirConfigSchema.safeParse(raw)
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
