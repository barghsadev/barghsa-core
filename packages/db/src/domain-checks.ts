import { sql, type SQL } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';

/** Legacy domain checks restored by production migration 0104. Keep future schema generation aligned.
 * GiST exclusions and the immutable upload validator remain explicit migration SQL. */
const definitions: Record<string, Array<[string, SQL]>> = {
  products: [['products_price_nonnegative', sql`(price IS NULL OR price >= 0)`]],
  notification_outbox: [
    [
      'chk_ob_status',
      sql`(status IN ('queued', 'scheduled', 'sending', 'delivered', 'failed', 'cancelled'))`,
    ],
  ],
  notification_job: [
    ['chk_job_channel', sql`(channel IN ('in_app', 'email', 'sms'))`],
    [
      'chk_job_status',
      sql`(status IN ('queued', 'running', 'retrying', 'done', 'failed', 'dead_letter'))`,
    ],
    ['chk_job_priority', sql`(priority IN ('urgent', 'normal'))`],
  ],
  notification_delivery_log: [
    ['chk_ndl_channel', sql`(channel IN ('in_app', 'email', 'sms'))`],
    ['chk_ndl_status', sql`(status IN ('delivered', 'failed', 'sending', 'unknown'))`],
    ['chk_ndl_error_category', sql`(error_category IN ('transient', 'permanent', 'provider'))`],
  ],
  notification_dead_letter: [
    ['chk_ndl_channel', sql`(channel IN ('in_app', 'email', 'sms'))`],
    ['chk_ndl_severity', sql`(severity IN ('error', 'critical'))`],
    ['chk_ndl_error_category', sql`(error_category IN ('transient', 'permanent', 'provider'))`],
    ['chk_ndl_status', sql`(status IN ('open', 'retried', 'resolved', 'dismissed'))`],
  ],
  approval_requests: [
    [
      'chk_ar_action_type',
      sql`(action_type IN ('refund', 'manual_adjustment', 'bank_payment_confirmation', 'contract_cancellation'))`,
    ],
    ['chk_ar_amount_positive', sql`(amount_irr > 0)`],
    ['chk_ar_status', sql`(status IN ('pending', 'approved', 'rejected'))`],
  ],
  reconciliation_exceptions: [
    ['chk_rex_type', sql`(exception_type IN ('wallet_mismatch', 'payment_mismatch'))`],
    ['chk_rex_severity', sql`(severity IN ('low', 'medium', 'high', 'critical'))`],
    ['chk_rex_status', sql`(status IN ('open', 'investigating', 'resolved', 'closed'))`],
  ],
  background_jobs: [
    ['chk_bj_status', sql`(status IN ('failed', 'retrying', 'dead_letter', 'resolved'))`],
    ['chk_bj_error_category', sql`(error_category IN ('transient', 'permanent', 'provider'))`],
    ['chk_bj_attempts_ge_1', sql`(attempts >= 1)`],
    ['chk_bj_max_attempts_ge_1', sql`(max_attempts >= 1)`],
  ],
  contract_templates: [
    ['chk_contract_templates_status', sql`(status IN ('active', 'inactive'))`],
    ['chk_contract_templates_name', sql`(length(btrim(name)) > 0)`],
  ],
  contract_template_versions: [
    ['chk_contract_template_versions_version_number', sql`(version_number > 0)`],
  ],
  upload_policies: [
    ['chk_upload_policies_category', sql`(category IN ('document', 'image', 'video'))`],
    ['chk_upload_policies_extensions', sql`(barghsa_valid_upload_extensions(allowed_extensions))`],
    ['chk_upload_policies_max_size', sql`(max_size_bytes BETWEEN 1 AND 104857600)`],
    [
      'chk_upload_policies_effective_range',
      sql`(effective_until IS NULL OR effective_from < effective_until)`,
    ],
  ],
  service_due_periods: [
    [
      'chk_service_due_periods_service_type',
      sql`(service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'))`,
    ],
    ['chk_service_due_periods_default_days', sql`(default_days BETWEEN 1 AND 365)`],
    [
      'chk_service_due_periods_effective_range',
      sql`(effective_until IS NULL OR effective_from < effective_until)`,
    ],
  ],
  invoice_reminder_schedule: [
    ['chk_invoice_reminder_schedule_offset', sql`("offset" IN (-7, -3, -1, 0, 1, 7))`],
    ['chk_invoice_reminder_schedule_channel', sql`(channel IN ('in_app', 'email', 'sms'))`],
    ['chk_invoice_reminder_schedule_status', sql`(status IN ('scheduled', 'sent', 'cancelled'))`],
    [
      'chk_invoice_reminder_schedule_sent_at',
      sql`( (status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL) )`,
    ],
  ],
  invoice_reminder_offset_toggles: [
    [
      'chk_invoice_reminder_offset_toggles_service_type',
      sql`(service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'))`,
    ],
    ['chk_invoice_reminder_offset_toggles_offset', sql`("offset" IN (-7, -3, -1, 0, 1, 7))`],
  ],
  wallet_topup_callback_events: [
    [
      'chk_wallet_topup_callback_events_status',
      sql`(status IN ('processing', 'credited', 'unpaid', 'duplicate'))`,
    ],
  ],
  wallet_chargeback_events: [
    [
      'chk_wallet_chargeback_events_status',
      sql`(status IN ('processing', 'reversed', 'unmatched', 'unresolved', 'duplicate'))`,
    ],
    [
      'chk_wallet_chargeback_events_match_method',
      sql`(match_method IS NULL OR match_method IN ('merchant_order_id', 'provider_ref_id', 'authority'))`,
    ],
  ],
};

export function domainChecks(tableName: string) {
  return (definitions[tableName] ?? []).map(([name, expression]) => check(name, expression));
}

export function domainCheckEntries(tableName: string) {
  return Object.fromEntries(
    domainChecks(tableName).map((constraint, index) => [`domainCheck${index}`, constraint])
  );
}
