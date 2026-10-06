CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity order history is retained' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('rejected','cancelled') AND EXISTS(
    SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=OLD.id::text
  ) AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
    RAISE EXCEPTION 'Terminated raw electricity draft history is retained' USING ERRCODE='23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    RAISE EXCEPTION 'Submitted electricity orders cannot return to draft' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND NEW.settings_snapshot IS DISTINCT FROM OLD.settings_snapshot THEN
    RAISE EXCEPTION 'Submitted electricity settings are immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'draft' AND (
    NEW.pricing_snapshot IS DISTINCT FROM OLD.pricing_snapshot OR
    NEW.period_start IS DISTINCT FROM OLD.period_start OR
    NEW.period_end IS DISTINCT FROM OLD.period_end OR
    NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
  ) AND NOT (
    OLD.status='changes_requested' AND NEW.status='changes_requested' AND
    EXISTS (
      SELECT 1 FROM contracts c
      JOIN electricity_contracts ec ON ec.contract_id=c.id
      JOIN contract_versions v ON v.id=c.current_version_id
      JOIN contract_activation_requirements ar ON ar.version_id=v.id
      JOIN invoices i ON i.id=ar.initial_invoice_id
      WHERE ec.order_id=OLD.id AND c.state='ChangesRequested'
        AND NOT EXISTS(SELECT 1 FROM contract_publications p WHERE p.version_id=v.id)
        AND v.content->'pricing'=OLD.pricing_snapshot
        AND i.state IN ('Draft','Unpaid','Overdue') AND i.paid_amount=0
        AND NOT EXISTS(SELECT 1 FROM bank_receipts r WHERE r.invoice_id=i.id
          AND r.state IN ('Submitted','UnderReview'))
    )
  ) THEN
    RAISE EXCEPTION 'Submitted electricity snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  -- An unlinked, unfunded raw draft can end without fabricated submission data.
  IF TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status='rejected'
    AND (to_jsonb(NEW)-'status'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
    AND EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.id AND o.profile_id=OLD.profile_id AND o.order_type='electricity' AND o.status='CANCELLED' AND o.gift_code_id IS NULL)
    AND NOT EXISTS(SELECT 1 FROM contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM gift_code_redemptions WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM refund_obligations WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM electricity_order_submissions WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM wallet_transactions WHERE type='payment' AND lower(ref_id)=OLD.id::text)
    AND OLD.submitted_at IS NULL AND OLD.submitted_by IS NULL
  THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('draft', 'cancelled') AND (
    NEW.period_start IS NULL OR NEW.period_end IS NULL OR
    NEW.submitted_at IS NULL OR NEW.pricing_snapshot IS NULL OR
    NEW.period_end <= NEW.period_start
  ) THEN
    RAISE EXCEPTION 'Submitted electricity order needs period and pricing snapshot' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Keep the submitted-facts requirement. Only unsubmitted rejected drafts gain
-- an exception, constrained by the transition guard above.
ALTER TABLE electricity_orders DROP CONSTRAINT electricity_orders_submitted_facts;
ALTER TABLE electricity_orders ADD CONSTRAINT electricity_orders_submitted_facts
 CHECK (status IN ('draft','cancelled') OR
   (status='rejected' AND submitted_at IS NULL AND submitted_by IS NULL) OR
   (total_kwh > 0 AND average_power_kw >= 0 AND green_rule_applied IS NOT NULL AND submitted_by IS NOT NULL));

--> statement-breakpoint
-- Raw rejection is a reviewed UPDATE, never a fabricated terminal INSERT.
CREATE FUNCTION guard_raw_electricity_terminal_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='rejected' AND NEW.submitted_at IS NULL AND NEW.submitted_by IS NULL THEN
  RAISE EXCEPTION 'Raw electricity rejection requires an existing draft transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER electricity_orders_raw_terminal_insert_guard BEFORE INSERT ON electricity_orders FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_insert();

--> statement-breakpoint
-- Profile-first locks serialize new associations against raw-draft termination.
-- Ordinary contract/invoice creation keeps its existing behavior. A raw terminal
-- record cannot acquire a new contract or invoice after its audited closure.
CREATE FUNCTION assert_raw_electricity_link_allowed(target_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE target_profile uuid; target_status text;
BEGIN
 SELECT profile_id INTO target_profile FROM electricity_orders WHERE id=target_order;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM 1 FROM profiles WHERE id=target_profile FOR KEY SHARE NOWAIT;
 SELECT status INTO target_status FROM electricity_orders WHERE id=target_order FOR SHARE NOWAIT;
 IF target_status IN ('rejected','cancelled') AND EXISTS(
   SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=target_order::text
 ) THEN RAISE EXCEPTION 'Terminated raw electricity drafts cannot acquire business associations' USING ERRCODE='23514'; END IF;
END $$;
CREATE FUNCTION guard_raw_electricity_terminal_association() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.order_id IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.order_id IS NOT DISTINCT FROM OLD.order_id THEN RETURN NEW; END IF;
 PERFORM assert_raw_electricity_link_allowed(NEW.order_id);
 RETURN NEW;
END $$;
CREATE TRIGGER contracts_raw_electricity_terminal_guard BEFORE INSERT OR UPDATE OF order_id ON contracts FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_association();
CREATE TRIGGER invoices_raw_electricity_terminal_guard BEFORE INSERT OR UPDATE OF order_id ON invoices FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_association();
CREATE TRIGGER electricity_contracts_raw_terminal_guard BEFORE INSERT OR UPDATE OF order_id ON electricity_contracts FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_association();

CREATE TRIGGER gifts_raw_electricity_terminal_guard BEFORE INSERT OR UPDATE OF order_id ON gift_code_redemptions FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_association();
CREATE TRIGGER refunds_raw_electricity_terminal_guard BEFORE INSERT OR UPDATE OF order_id ON refund_obligations FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_association();
CREATE TRIGGER submissions_raw_electricity_terminal_guard BEFORE INSERT OR UPDATE OF order_id ON electricity_order_submissions FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_association();
CREATE TRIGGER lines_raw_electricity_terminal_guard BEFORE INSERT OR UPDATE OF order_id ON electricity_order_lines FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_association();
CREATE FUNCTION guard_raw_electricity_terminal_payment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type <> 'payment' OR NEW.ref_id IS NULL OR NEW.ref_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.type IS NOT DISTINCT FROM OLD.type AND NEW.ref_id IS NOT DISTINCT FROM OLD.ref_id THEN RETURN NEW; END IF;
 PERFORM assert_raw_electricity_link_allowed(NEW.ref_id::uuid);
 RETURN NEW;
END $$;
CREATE TRIGGER wallet_raw_electricity_terminal_guard BEFORE INSERT OR UPDATE OF type,ref_id ON wallet_transactions FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_payment();

--> statement-breakpoint
CREATE FUNCTION guard_raw_electricity_terminal_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM electricity_orders e WHERE e.id=OLD.id AND e.status IN ('rejected','cancelled')) AND EXISTS(
   SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=OLD.id::text
 ) THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at')
  THEN RAISE EXCEPTION 'Terminated raw electricity order history is retained' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER orders_raw_electricity_terminal_guard BEFORE UPDATE OR DELETE ON orders FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_order();
