import { sql } from 'drizzle-orm';
import { check } from 'drizzle-orm/pg-core';

/** Legacy domain checks restored by production migration 0104. Keep future schema generation aligned.
 * GiST exclusions and the immutable upload validator remain explicit migration SQL. */
const definitions: Record<string, Array<[string, string]>> = {
  notification_outbox: [
    [
      'chk_ob_status',
      "(status IN ('queued', 'scheduled', 'sending', 'delivered', 'failed', 'cancelled'))",
    ],
  ],
  notification_job: [
    ['chk_job_channel', "(channel IN ('in_app', 'email', 'sms'))"],
    [
      'chk_job_status',
      "(status IN ('queued', 'running', 'retrying', 'done', 'failed', 'dead_letter'))",
    ],
    ['chk_job_priority', "(priority IN ('urgent', 'normal'))"],
  ],
  notification_delivery_log: [
    ['chk_ndl_channel', "(channel IN ('in_app', 'email', 'sms'))"],
    ['chk_ndl_status', "(status IN ('delivered', 'failed'))"],
    ['chk_ndl_error_category', "(error_category IN ('transient', 'permanent', 'provider'))"],
  ],
  notification_dead_letter: [
    ['chk_ndl_channel', "(channel IN ('in_app', 'email', 'sms'))"],
    ['chk_ndl_severity', "(severity IN ('error', 'critical'))"],
    ['chk_ndl_error_category', "(error_category IN ('transient', 'permanent', 'provider'))"],
    ['chk_ndl_status', "(status IN ('open', 'retried', 'resolved', 'dismissed'))"],
  ],
  approval_requests: [
    [
      'chk_ar_action_type',
      "(action_type IN ('refund', 'manual_adjustment', 'bank_payment_confirmation'))",
    ],
    ['chk_ar_amount_positive', '(amount_irr > 0)'],
    ['chk_ar_status', "(status IN ('pending', 'approved', 'rejected'))"],
  ],
  reconciliation_exceptions: [
    ['chk_rex_type', "(exception_type IN ('wallet_mismatch', 'payment_mismatch'))"],
    ['chk_rex_severity', "(severity IN ('low', 'medium', 'high', 'critical'))"],
    ['chk_rex_status', "(status IN ('open', 'investigating', 'resolved', 'closed'))"],
  ],
  background_jobs: [
    ['chk_bj_status', "(status IN ('failed', 'retrying', 'dead_letter', 'resolved'))"],
    ['chk_bj_error_category', "(error_category IN ('transient', 'permanent', 'provider'))"],
    ['chk_bj_attempts_ge_1', '(attempts >= 1)'],
    ['chk_bj_max_attempts_ge_1', '(max_attempts >= 1)'],
  ],
  contract_templates: [
    ['chk_contract_templates_status', "(status IN ('active', 'inactive'))"],
    ['chk_contract_templates_name', '(length(btrim(name)) > 0)'],
  ],
  contract_template_versions: [
    ['chk_contract_template_versions_version_number', '(version_number > 0)'],
  ],
  upload_policies: [
    ['chk_upload_policies_category', "(category IN ('document', 'image', 'video'))"],
    ['chk_upload_policies_extensions', '(barghsa_valid_upload_extensions(allowed_extensions))'],
    ['chk_upload_policies_max_size', '(max_size_bytes BETWEEN 1 AND 104857600)'],
    [
      'chk_upload_policies_effective_range',
      '(effective_until IS NULL OR effective_from < effective_until)',
    ],
  ],
  service_due_periods: [
    [
      'chk_service_due_periods_service_type',
      "(service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'))",
    ],
    ['chk_service_due_periods_default_days', '(default_days BETWEEN 1 AND 365)'],
    [
      'chk_service_due_periods_effective_range',
      '(effective_until IS NULL OR effective_from < effective_until)',
    ],
  ],
  invoice_reminder_schedule: [
    ['chk_invoice_reminder_schedule_offset', '("offset" IN (-7, -3, -1, 0, 1, 7))'],
    ['chk_invoice_reminder_schedule_channel', "(channel IN ('in_app', 'email', 'sms'))"],
    ['chk_invoice_reminder_schedule_status', "(status IN ('scheduled', 'sent', 'cancelled'))"],
    [
      'chk_invoice_reminder_schedule_sent_at',
      "( (status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL) )",
    ],
  ],
  invoice_reminder_offset_toggles: [
    [
      'chk_invoice_reminder_offset_toggles_service_type',
      "(service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'))",
    ],
    ['chk_invoice_reminder_offset_toggles_offset', '("offset" IN (-7, -3, -1, 0, 1, 7))'],
  ],
  wallet_topup_callback_events: [
    [
      'chk_wallet_topup_callback_events_status',
      "(status IN ('processing', 'credited', 'unpaid', 'duplicate'))",
    ],
  ],
  wallet_chargeback_events: [
    [
      'chk_wallet_chargeback_events_status',
      "(status IN ('processing', 'reversed', 'unmatched', 'unresolved', 'duplicate'))",
    ],
    [
      'chk_wallet_chargeback_events_match_method',
      "(match_method IS NULL OR match_method IN ('merchant_order_id', 'provider_ref_id', 'authority'))",
    ],
  ],
};

export function domainChecks(tableName: string) {
  return (definitions[tableName] ?? []).map(([name, expression]) =>
    check(name, sql.raw(expression))
  );
}

export function domainCheckEntries(tableName: string) {
  return Object.fromEntries(
    domainChecks(tableName).map((constraint, index) => [`domainCheck${index}`, constraint])
  );
}
