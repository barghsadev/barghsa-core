-- Restore inline domain constraints skipped by the production baseline's CREATE IF NOT EXISTS statements.
-- Existing invalid rows require reconciliation; this migration does not delete or rewrite them.
CREATE OR REPLACE FUNCTION barghsa_valid_upload_extensions(values_in text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT cardinality(values_in) BETWEEN 1 AND 50 AND array_ndims(values_in)=1
    AND NOT EXISTS (SELECT 1 FROM unnest(values_in) AS value WHERE value IS NULL OR value !~ '^[.][a-z0-9]{1,10}$')
$$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_outbox'::regclass AND conname='chk_ob_status') THEN
  ALTER TABLE notification_outbox ADD CONSTRAINT chk_ob_status CHECK (status IN ('queued', 'scheduled', 'sending', 'delivered', 'failed', 'cancelled'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_job'::regclass AND conname='chk_job_channel') THEN
  ALTER TABLE notification_job ADD CONSTRAINT chk_job_channel CHECK (channel IN ('in_app', 'email', 'sms'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_job'::regclass AND conname='chk_job_status') THEN
  ALTER TABLE notification_job ADD CONSTRAINT chk_job_status CHECK (status IN ('queued', 'running', 'retrying', 'done', 'failed', 'dead_letter'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_job'::regclass AND conname='chk_job_priority') THEN
  ALTER TABLE notification_job ADD CONSTRAINT chk_job_priority CHECK (priority IN ('urgent', 'normal'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_delivery_log'::regclass AND conname='chk_ndl_channel') THEN
  ALTER TABLE notification_delivery_log ADD CONSTRAINT chk_ndl_channel CHECK (channel IN ('in_app', 'email', 'sms'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_delivery_log'::regclass AND conname='chk_ndl_status') THEN
  ALTER TABLE notification_delivery_log ADD CONSTRAINT chk_ndl_status CHECK (status IN ('delivered', 'failed'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_delivery_log'::regclass AND conname='chk_ndl_error_category') THEN
  ALTER TABLE notification_delivery_log ADD CONSTRAINT chk_ndl_error_category CHECK (error_category IN ('transient', 'permanent', 'provider'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_dead_letter'::regclass AND conname='chk_ndl_channel') THEN
  ALTER TABLE notification_dead_letter ADD CONSTRAINT chk_ndl_channel CHECK (channel IN ('in_app', 'email', 'sms'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_dead_letter'::regclass AND conname='chk_ndl_severity') THEN
  ALTER TABLE notification_dead_letter ADD CONSTRAINT chk_ndl_severity CHECK (severity IN ('error', 'critical'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_dead_letter'::regclass AND conname='chk_ndl_error_category') THEN
  ALTER TABLE notification_dead_letter ADD CONSTRAINT chk_ndl_error_category CHECK (error_category IN ('transient', 'permanent', 'provider'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='notification_dead_letter'::regclass AND conname='chk_ndl_status') THEN
  ALTER TABLE notification_dead_letter ADD CONSTRAINT chk_ndl_status CHECK (status IN ('open', 'retried', 'resolved', 'dismissed'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='approval_requests'::regclass AND conname='chk_ar_action_type') THEN
  ALTER TABLE approval_requests ADD CONSTRAINT chk_ar_action_type CHECK (action_type IN ('refund', 'manual_adjustment', 'bank_payment_confirmation'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='approval_requests'::regclass AND conname='chk_ar_amount_positive') THEN
  ALTER TABLE approval_requests ADD CONSTRAINT chk_ar_amount_positive CHECK (amount_irr > 0);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='approval_requests'::regclass AND conname='chk_ar_status') THEN
  ALTER TABLE approval_requests ADD CONSTRAINT chk_ar_status CHECK (status IN ('pending', 'approved', 'rejected'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='reconciliation_exceptions'::regclass AND conname='chk_rex_type') THEN
  ALTER TABLE reconciliation_exceptions ADD CONSTRAINT chk_rex_type CHECK (exception_type IN ('wallet_mismatch', 'payment_mismatch'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='reconciliation_exceptions'::regclass AND conname='chk_rex_severity') THEN
  ALTER TABLE reconciliation_exceptions ADD CONSTRAINT chk_rex_severity CHECK (severity IN ('low', 'medium', 'high', 'critical'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='reconciliation_exceptions'::regclass AND conname='chk_rex_status') THEN
  ALTER TABLE reconciliation_exceptions ADD CONSTRAINT chk_rex_status CHECK (status IN ('open', 'investigating', 'resolved', 'closed'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='background_jobs'::regclass AND conname='chk_bj_status') THEN
  ALTER TABLE background_jobs ADD CONSTRAINT chk_bj_status CHECK (status IN ('failed', 'retrying', 'dead_letter', 'resolved'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='background_jobs'::regclass AND conname='chk_bj_error_category') THEN
  ALTER TABLE background_jobs ADD CONSTRAINT chk_bj_error_category CHECK (error_category IN ('transient', 'permanent', 'provider'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='background_jobs'::regclass AND conname='chk_bj_attempts_ge_1') THEN
  ALTER TABLE background_jobs ADD CONSTRAINT chk_bj_attempts_ge_1 CHECK (attempts >= 1);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='background_jobs'::regclass AND conname='chk_bj_max_attempts_ge_1') THEN
  ALTER TABLE background_jobs ADD CONSTRAINT chk_bj_max_attempts_ge_1 CHECK (max_attempts >= 1);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='contract_templates'::regclass AND conname='chk_contract_templates_status') THEN
  ALTER TABLE contract_templates ADD CONSTRAINT chk_contract_templates_status CHECK (status IN ('active', 'inactive'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='contract_templates'::regclass AND conname='chk_contract_templates_name') THEN
  ALTER TABLE contract_templates ADD CONSTRAINT chk_contract_templates_name CHECK (length(btrim(name)) > 0);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='contract_template_versions'::regclass AND conname='chk_contract_template_versions_version_number') THEN
  ALTER TABLE contract_template_versions ADD CONSTRAINT chk_contract_template_versions_version_number CHECK (version_number > 0);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='upload_policies'::regclass AND conname='chk_upload_policies_category') THEN
  ALTER TABLE upload_policies ADD CONSTRAINT chk_upload_policies_category CHECK (category IN ('document', 'image', 'video'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='upload_policies'::regclass AND conname='chk_upload_policies_extensions') THEN
  ALTER TABLE upload_policies ADD CONSTRAINT chk_upload_policies_extensions CHECK (barghsa_valid_upload_extensions(allowed_extensions));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='upload_policies'::regclass AND conname='chk_upload_policies_max_size') THEN
  ALTER TABLE upload_policies ADD CONSTRAINT chk_upload_policies_max_size CHECK (max_size_bytes BETWEEN 1 AND 104857600);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='upload_policies'::regclass AND conname='chk_upload_policies_effective_range') THEN
  ALTER TABLE upload_policies ADD CONSTRAINT chk_upload_policies_effective_range CHECK (effective_until IS NULL OR effective_from < effective_until);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='upload_policies'::regclass AND conname='excl_upload_policies_no_overlap') THEN
  ALTER TABLE upload_policies ADD CONSTRAINT excl_upload_policies_no_overlap EXCLUDE USING GIST ( category WITH =, tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH && );
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_due_periods'::regclass AND conname='chk_service_due_periods_service_type') THEN
  ALTER TABLE service_due_periods ADD CONSTRAINT chk_service_due_periods_service_type CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_due_periods'::regclass AND conname='chk_service_due_periods_default_days') THEN
  ALTER TABLE service_due_periods ADD CONSTRAINT chk_service_due_periods_default_days CHECK (default_days BETWEEN 1 AND 365);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_due_periods'::regclass AND conname='chk_service_due_periods_effective_range') THEN
  ALTER TABLE service_due_periods ADD CONSTRAINT chk_service_due_periods_effective_range CHECK (effective_until IS NULL OR effective_from < effective_until);
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='service_due_periods'::regclass AND conname='excl_service_due_periods_no_overlap') THEN
  ALTER TABLE service_due_periods ADD CONSTRAINT excl_service_due_periods_no_overlap EXCLUDE USING GIST ( service_type WITH =, tstzrange(effective_from, COALESCE(effective_until, 'infinity'::TIMESTAMPTZ), '[)') WITH && );
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoice_reminder_schedule'::regclass AND conname='chk_invoice_reminder_schedule_offset') THEN
  ALTER TABLE invoice_reminder_schedule ADD CONSTRAINT chk_invoice_reminder_schedule_offset CHECK ("offset" IN (-7, -3, -1, 0, 1, 7));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoice_reminder_schedule'::regclass AND conname='chk_invoice_reminder_schedule_channel') THEN
  ALTER TABLE invoice_reminder_schedule ADD CONSTRAINT chk_invoice_reminder_schedule_channel CHECK (channel IN ('in_app', 'email', 'sms'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoice_reminder_schedule'::regclass AND conname='chk_invoice_reminder_schedule_status') THEN
  ALTER TABLE invoice_reminder_schedule ADD CONSTRAINT chk_invoice_reminder_schedule_status CHECK (status IN ('scheduled', 'sent', 'cancelled'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoice_reminder_schedule'::regclass AND conname='chk_invoice_reminder_schedule_sent_at') THEN
  ALTER TABLE invoice_reminder_schedule ADD CONSTRAINT chk_invoice_reminder_schedule_sent_at CHECK ( (status = 'sent' AND sent_at IS NOT NULL) OR (status <> 'sent' AND sent_at IS NULL) );
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoice_reminder_offset_toggles'::regclass AND conname='chk_invoice_reminder_offset_toggles_service_type') THEN
  ALTER TABLE invoice_reminder_offset_toggles ADD CONSTRAINT chk_invoice_reminder_offset_toggles_service_type CHECK (service_type IN ('electricity', 'saving_plan', 'consultation', 'manual'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='invoice_reminder_offset_toggles'::regclass AND conname='chk_invoice_reminder_offset_toggles_offset') THEN
  ALTER TABLE invoice_reminder_offset_toggles ADD CONSTRAINT chk_invoice_reminder_offset_toggles_offset CHECK ("offset" IN (-7, -3, -1, 0, 1, 7));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='wallet_topup_callback_events'::regclass AND conname='chk_wallet_topup_callback_events_status') THEN
  ALTER TABLE wallet_topup_callback_events ADD CONSTRAINT chk_wallet_topup_callback_events_status CHECK (status IN ('credited', 'unpaid', 'duplicate'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='wallet_chargeback_events'::regclass AND conname='chk_wallet_chargeback_events_status') THEN
  ALTER TABLE wallet_chargeback_events ADD CONSTRAINT chk_wallet_chargeback_events_status CHECK (status IN ('processing', 'reversed', 'unmatched', 'unresolved', 'duplicate'));
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='wallet_chargeback_events'::regclass AND conname='chk_wallet_chargeback_events_match_method') THEN
  ALTER TABLE wallet_chargeback_events ADD CONSTRAINT chk_wallet_chargeback_events_match_method CHECK (match_method IS NULL OR match_method IN ('merchant_order_id', 'provider_ref_id', 'authority'));
 END IF;
END $$;
