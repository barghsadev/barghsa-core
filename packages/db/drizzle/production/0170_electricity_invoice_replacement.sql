-- An unpublished electricity order may replace its unpaid invoice without
-- changing the submitted contract term. The replacement must directly follow
-- the invoice currently bound to the activation requirements.
CREATE OR REPLACE FUNCTION guard_contract_activation_requirement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; rule contract_activation_rules%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Activation requirements cannot be deleted' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM contract_versions WHERE id=NEW.version_id AND contract_id=NEW.contract_id)
 THEN RAISE EXCEPTION 'Activation requirements must belong to their contract version' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO rule FROM contract_activation_rules WHERE service_type=parent.service_type FOR SHARE;
  IF NOT FOUND OR NEW.rule_revision<>rule.revision OR NEW.signature_required<>rule.signature_required
   OR NEW.payment_required<>rule.payment_required OR NEW.service_start_required<>rule.service_start_required
  THEN RAISE EXCEPTION 'Activation requirements must snapshot current service rules' USING ERRCODE='23514'; END IF;
  NEW.captured_at:=clock_timestamp();
 ELSE
  IF (to_jsonb(NEW)-'initial_invoice_id'-'service_starts_at'-'service_ends_at') IS DISTINCT FROM (to_jsonb(OLD)-'initial_invoice_id'-'service_starts_at'-'service_ends_at')
   OR parent.current_version_id<>NEW.version_id
   OR (parent.state NOT IN ('Draft','ChangesRequested')
     AND NOT (parent.state='AwaitingStaffReview' AND parent.service_type='electricity'))
   OR EXISTS(SELECT 1 FROM contract_publications WHERE version_id=NEW.version_id)
  THEN RAISE EXCEPTION 'Published activation requirements and rule snapshots are immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.initial_invoice_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM invoices i WHERE i.id=NEW.initial_invoice_id AND i.profile_id=parent.profile_id
   AND i.state NOT IN ('Cancelled','Refunded','PartiallyRefunded') AND i.adjustment_for_invoice_id IS NULL
   AND (i.contract_id=parent.id::text OR (parent.order_id IS NOT NULL AND i.order_id=parent.order_id AND (i.contract_id IS NULL OR i.contract_id=parent.id::text)))
 ) THEN RAISE EXCEPTION 'Initial invoice must belong to the contract profile and order or contract' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND parent.service_type='electricity' AND parent.state='AwaitingStaffReview'
  AND NOT EXISTS(
   SELECT 1 FROM electricity_orders e JOIN invoices i ON i.order_id=e.id
   WHERE e.id=parent.order_id AND i.id=NEW.initial_invoice_id
    AND i.profile_id=parent.profile_id AND i.adjustment_for_invoice_id IS NULL
    AND ((i.type='auto' AND i.replaces_invoice_id IS NULL)
      OR (i.type='manual' AND i.replaces_invoice_id=OLD.initial_invoice_id))
    AND NEW.service_starts_at IS NOT DISTINCT FROM e.period_start
    AND NEW.service_ends_at IS NOT DISTINCT FROM e.period_end
  )
 THEN RAISE EXCEPTION 'Electricity activation must bind the submitted invoice and term' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
