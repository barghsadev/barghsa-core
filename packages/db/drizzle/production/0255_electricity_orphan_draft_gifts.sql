-- Existing unpaid gift cancellation policy applies to actual orphan drafts.
CREATE FUNCTION raw_electricity_draft_gift_consistent(target_order uuid, target_profile uuid, target_gift uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN target_gift IS NULL THEN NOT EXISTS(SELECT 1 FROM gift_code_redemptions WHERE order_id=target_order)
 ELSE (SELECT count(*)=1 AND bool_and(profile_id=target_profile AND gift_code_id=target_gift AND status IN ('consumed','released')) FROM gift_code_redemptions WHERE order_id=target_order)
 END
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_electricity_order_settings_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Electricity order history is retained' USING ERRCODE = '23514';
  END IF;
  IF OLD.status IN ('rejected','cancelled') AND (EXISTS(
    SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=OLD.id::text
  ) OR has_reviewed_electricity_rejection(OLD.id)) AND (to_jsonb(NEW)-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at') THEN
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
  -- Linked incomplete drafts use the same reviewed immutable terminal engine.
  IF OLD.status='draft' AND NEW.status='rejected'
   AND (to_jsonb(NEW)-'status'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
   AND EXISTS(SELECT 1 FROM contracts c JOIN contract_cancellations x ON x.contract_id=c.id JOIN contract_cancellation_intents n ON n.id=x.intent_id JOIN orders o ON o.id=OLD.id
     WHERE c.order_id=OLD.id AND c.profile_id=OLD.profile_id AND c.state='Rejected' AND c.current_version_id=n.version_id
       AND n.financial_snapshot->>'terminalAction'='reject' AND n.financial_snapshot->'electricityOrder'->>'commercialStatus'='draft'
       AND o.profile_id=OLD.profile_id AND o.order_type='electricity' AND o.status='CANCELLED')
  THEN RETURN NEW; END IF;
  -- An unlinked, unfunded raw draft can end without fabricated submission data.
  IF TG_OP='UPDATE' AND OLD.status='draft' AND NEW.status='rejected'
    AND (to_jsonb(NEW)-'status'-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'status'-'updated_at')
    AND EXISTS(SELECT 1 FROM orders o WHERE o.id=OLD.id AND o.profile_id=OLD.profile_id AND o.order_type='electricity' AND o.status='CANCELLED' AND raw_electricity_draft_gift_consistent(o.id,o.profile_id,o.gift_code_id))
    AND NOT EXISTS(SELECT 1 FROM contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM electricity_contracts WHERE order_id=OLD.id)
    AND NOT EXISTS(SELECT 1 FROM invoices WHERE order_id=OLD.id)
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
CREATE FUNCTION guard_raw_electricity_terminal_gift_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM electricity_orders e WHERE e.id=OLD.order_id AND e.status IN ('rejected','cancelled')) AND EXISTS(SELECT 1 FROM audit_log WHERE event='electricity.draft.terminated' AND metadata::jsonb->>'entityId'=OLD.order_id::text) THEN
  IF TG_OP='DELETE' OR to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
   RAISE EXCEPTION 'Terminated raw electricity gift history is retained' USING ERRCODE='23514';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER gifts_raw_electricity_terminal_history_guard BEFORE UPDATE OR DELETE ON gift_code_redemptions FOR EACH ROW EXECUTE FUNCTION guard_raw_electricity_terminal_gift_history();
