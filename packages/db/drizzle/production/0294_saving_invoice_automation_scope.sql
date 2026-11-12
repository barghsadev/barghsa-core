-- Apply future saving invoice events within their existing order and profile.
-- Preserve all historical order, payment and stock records.
CREATE FUNCTION saving_original_invoice_order(i invoices)
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT s.id FROM saving_orders s
    JOIN orders o ON o.id=s.order_id AND o.profile_id=s.profile_id AND o.order_type='savings'
    JOIN contracts c ON c.order_id=o.id AND c.profile_id=s.profile_id AND c.service_type='savings'
  WHERE i.order_id=o.id AND i.profile_id=s.profile_id AND i.type='auto'
    AND i.replaces_invoice_id IS NULL AND i.adjustment_for_invoice_id IS NULL
    AND (i.contract_id IS NULL OR i.contract_id=c.id::text)
  LIMIT 1;
$$;
--> statement-breakpoint
CREATE FUNCTION saving_hardware_invoice_has_scope(
  saving_id uuid, contract_key uuid, version_key uuid, original_id uuid, adjustment invoices
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM saving_orders s
      JOIN contracts c ON c.id=contract_key AND c.order_id=s.order_id
        AND c.profile_id=s.profile_id AND c.service_type='savings'
      JOIN contract_versions v ON v.id=version_key AND v.contract_id=c.id
      JOIN invoices original ON original.id=original_id
        AND saving_original_invoice_order(original)=s.id
        AND (original.contract_id IS NULL OR original.contract_id=c.id::text)
    WHERE s.id=saving_id AND adjustment.order_id=s.order_id AND adjustment.profile_id=s.profile_id
      AND adjustment.contract_id IS NOT DISTINCT FROM original.contract_id
      AND adjustment.adjustment_for_invoice_id=original.id
  );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION saving_inventory_invoice_paid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order uuid;
BEGIN
  IF NEW.state='Paid' AND OLD.state IS DISTINCT FROM NEW.state THEN
    target_order:=saving_original_invoice_order(NEW);
    IF target_order IS NOT NULL THEN PERFORM allocate_saving_inventory(target_order); END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_saving_order_financial_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_order uuid;
BEGIN
  target_order:=saving_original_invoice_order(NEW);
  IF target_order IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM saving_orders s JOIN contracts c
        ON c.order_id=s.order_id AND c.profile_id=s.profile_id AND c.service_type='savings'
      JOIN contract_cancellations x ON x.contract_id=c.id
      WHERE s.id=target_order AND s.status='cancelled') THEN
      PERFORM refresh_saving_cancellation_financial_status(NEW.order_id);
    ELSE
      UPDATE saving_orders SET financial_status=CASE NEW.state
        WHEN 'Paid' THEN 'paid' WHEN 'PartiallyRefunded' THEN 'refund_pending'
        WHEN 'Refunded' THEN 'refunded' ELSE 'unpaid' END,updated_at=NOW()
        WHERE id=target_order AND profile_id=NEW.profile_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_saving_hardware_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM saving_orders saving JOIN contracts contract
      ON contract.id=NEW.contract_id AND contract.order_id=saving.order_id
      JOIN invoices original ON original.id=NEW.original_invoice_id
      JOIN invoices charge ON charge.id=NEW.adjustment_invoice_id
      JOIN products hardware ON hardware.id=NEW.hardware_id
    WHERE saving.id=NEW.order_id
      AND saving.hardware_product_id=NEW.previous_hardware_id
      AND saving.financial_status='paid'
      AND contract.current_version_id=NEW.contract_version_id
      AND original.state='Paid'
      AND saving_hardware_invoice_has_scope(
        NEW.order_id,NEW.contract_id,NEW.contract_version_id,NEW.original_invoice_id,charge
      )
      AND charge.adjustment_kind='charge'
      AND charge.accounting_amount=NEW.price_delta_irr
      AND charge.state='Unpaid' AND charge.paid_amount=0
      AND charge.payable_from IS NOT NULL
      AND hardware.stock_tracking=NEW.stock_reserved
  ) THEN
    RAISE EXCEPTION 'Saving hardware upgrade must match the paid order and charge' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION validate_saving_hardware_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.adjustment_invoice_id IS NULL THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM invoices adjustment
    WHERE adjustment.id=NEW.adjustment_invoice_id
      AND saving_hardware_invoice_has_scope(
        NEW.order_id,NEW.contract_id,NEW.contract_version_id,NEW.original_invoice_id,adjustment
      )
      AND adjustment.accounting_amount=NEW.price_delta_irr
      AND (
        (NEW.price_delta_irr<0 AND adjustment.adjustment_kind='credit'
          AND adjustment.state='Unpaid' AND adjustment.paid_amount=0
          AND adjustment.payable_from IS NULL)
        OR
        (NEW.price_delta_irr>0 AND adjustment.adjustment_kind='charge'
          AND adjustment.state='Paid' AND adjustment.paid_amount=adjustment.total_amount
          AND adjustment.refunded_amount=0 AND EXISTS (
            SELECT 1 FROM saving_hardware_upgrade_requests upgrade
            WHERE upgrade.adjustment_invoice_id=adjustment.id
              AND upgrade.order_id=NEW.order_id
              AND upgrade.contract_id=NEW.contract_id
              AND upgrade.previous_hardware_id=NEW.previous_hardware_id
              AND upgrade.hardware_id=NEW.hardware_id
              AND upgrade.price_delta_irr=NEW.price_delta_irr
              AND upgrade.status='awaiting_payment')))
  ) THEN
    RAISE EXCEPTION 'Saving hardware adjustment must match its linked invoice' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION settle_saving_hardware_upgrade() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE upgrade saving_hardware_upgrade_requests%ROWTYPE;
DECLARE saving saving_orders%ROWTYPE;
DECLARE recipient text;
BEGIN
  IF NEW.state NOT IN ('Paid','Cancelled','Overdue') OR NEW.state IS NOT DISTINCT FROM OLD.state
    THEN RETURN NEW; END IF;
  SELECT * INTO upgrade FROM saving_hardware_upgrade_requests
    WHERE adjustment_invoice_id=NEW.id AND original_invoice_id=NEW.adjustment_for_invoice_id
      AND NEW.adjustment_kind='charge' FOR UPDATE;
  IF NOT FOUND OR upgrade.status<>'awaiting_payment' THEN RETURN NEW; END IF;
  IF NEW.accounting_amount IS DISTINCT FROM upgrade.price_delta_irr
    OR NOT saving_hardware_invoice_has_scope(
      upgrade.order_id,upgrade.contract_id,upgrade.contract_version_id,upgrade.original_invoice_id,NEW
    ) THEN
    RAISE EXCEPTION 'Saving hardware upgrade invoice scope requires reconciliation' USING ERRCODE='23514';
  END IF;
  IF NEW.state='Paid' THEN
    SELECT * INTO saving FROM saving_orders WHERE id=upgrade.order_id FOR UPDATE;
    IF NOT FOUND OR saving.profile_id IS DISTINCT FROM NEW.profile_id
      OR saving.order_id IS DISTINCT FROM NEW.order_id
      OR saving.status NOT IN ('approved','in_progress') OR saving.financial_status<>'paid'
      OR saving.hardware_product_id<>upgrade.previous_hardware_id
      OR NEW.paid_amount<>NEW.total_amount OR NEW.refunded_amount<>0
      OR NOT EXISTS (SELECT 1 FROM contracts c WHERE c.id=upgrade.contract_id
        AND c.current_version_id=upgrade.contract_version_id
        AND c.state IN ('AwaitingCustomerAcceptance','Active'))
      OR NOT EXISTS (SELECT 1 FROM saving_fulfillment_stages f
        WHERE f.order_id=upgrade.order_id AND f.stage='product_delivery' AND f.status='in_progress')
      OR EXISTS (SELECT 1 FROM saving_fulfillment_stages f
        WHERE f.order_id=upgrade.order_id
          AND f.stage IN ('installation_and_document_upload','equipment_handover','process_completion')
          AND f.status<>'pending') THEN
      RAISE EXCEPTION 'Saving hardware upgrade can no longer be applied' USING ERRCODE='23514';
    END IF;
    PERFORM id FROM products WHERE id IN (upgrade.previous_hardware_id,upgrade.hardware_id)
      ORDER BY id FOR UPDATE;
    IF upgrade.stock_reserved THEN
      UPDATE products SET reserved_count=reserved_count-1
        WHERE id=upgrade.hardware_id AND stock_tracking AND reserved_count>0;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Saving hardware upgrade reservation is missing' USING ERRCODE='23514';
      END IF;
    END IF;
    INSERT INTO saving_hardware_amendments(
      order_id,contract_id,contract_version_id,actor_user_id,
      previous_hardware_id,hardware_id,previous_snapshot,hardware_snapshot,
      original_invoice_id,adjustment_invoice_id,price_delta_irr,reason)
    VALUES(upgrade.order_id,upgrade.contract_id,upgrade.contract_version_id,upgrade.actor_user_id,
      upgrade.previous_hardware_id,upgrade.hardware_id,upgrade.previous_snapshot,upgrade.hardware_snapshot,
      upgrade.original_invoice_id,upgrade.adjustment_invoice_id,upgrade.price_delta_irr,upgrade.reason);
    UPDATE saving_orders SET hardware_product_id=upgrade.hardware_id,updated_at=clock_timestamp()
      WHERE id=upgrade.order_id;
    UPDATE saving_hardware_upgrade_requests SET status='applied',applied_at=clock_timestamp()
      WHERE id=upgrade.id;
    INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
    VALUES(uuid_generate_v7()::text,upgrade.actor_user_id,'saving.hardware_upgrade_applied',
      jsonb_build_object('entity','saving_hardware_upgrade_request','entityId',upgrade.id,'fromState',upgrade.status,'toState','applied','reason',upgrade.reason,'actor','system','actorType','system','profileId',saving.profile_id,'affectedUserId',upgrade.actor_user_id,'invoiceFromState',OLD.state,'invoiceToState',NEW.state,'savingOrderId',upgrade.order_id,'upgradeId',upgrade.id,
        'chargeInvoiceId',NEW.id,'priceDeltaIrR',upgrade.price_delta_irr)::text,
      uuid_generate_v7()::text);
    SELECT user_id INTO recipient FROM profiles WHERE id=saving.profile_id;
    INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,
      body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
    VALUES(uuid_generate_v7(),recipient,saving.profile_id,'general',
      'notifications.legacy.title','notifications.legacy.body',
      jsonb_build_object('fa',jsonb_build_object('title','سفارش صرفه‌جویی',
        'body','تجهیز جدید سفارش شما پس از پرداخت مبلغ اضافه اعمال شد.'),
        'en',jsonb_build_object('title','Power-saving order',
        'body','Your new equipment was applied after the additional payment.')),
      '/savings/orders/'||upgrade.order_id::text,false,clock_timestamp(),
      'saving-hardware-upgrade-applied:'||upgrade.id::text);
    RETURN NEW;
  END IF;
  IF NEW.paid_amount<>0 THEN RETURN NEW; END IF;
  IF upgrade.stock_reserved THEN
    UPDATE products SET reserved_count=reserved_count-1
      WHERE id=upgrade.hardware_id AND reserved_count>0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Saving hardware upgrade reservation is missing' USING ERRCODE='23514';
    END IF;
  END IF;
  UPDATE saving_hardware_upgrade_requests SET
    status=CASE WHEN NEW.state='Overdue' THEN 'expired' ELSE 'cancelled' END,
    closed_at=clock_timestamp() WHERE id=upgrade.id;
  INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
  VALUES(uuid_generate_v7()::text,upgrade.actor_user_id,'saving.hardware_upgrade_closed',
    jsonb_build_object('entity','saving_hardware_upgrade_request','entityId',upgrade.id,'fromState',upgrade.status,'toState',CASE WHEN NEW.state='Overdue' THEN 'expired' ELSE 'cancelled' END,'reason',upgrade.reason,'actor','system','actorType','system','profileId',(SELECT profile_id FROM saving_orders WHERE id=upgrade.order_id),'affectedUserId',upgrade.actor_user_id,'invoiceFromState',OLD.state,'invoiceToState',NEW.state,'savingOrderId',upgrade.order_id,'upgradeId',upgrade.id,
      'chargeInvoiceId',NEW.id,'invoiceState',NEW.state)::text,uuid_generate_v7()::text);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_closed_saving_hardware_upgrade_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE upgrade saving_hardware_upgrade_requests%ROWTYPE;
BEGIN
  IF NEW.paid_amount>OLD.paid_amount OR (NEW.state='Paid' AND OLD.state IS DISTINCT FROM NEW.state) THEN
    SELECT * INTO upgrade FROM saving_hardware_upgrade_requests
      WHERE adjustment_invoice_id=NEW.id AND original_invoice_id=NEW.adjustment_for_invoice_id
        AND NEW.adjustment_kind='charge';
    IF FOUND THEN
      IF upgrade.status IN ('cancelled','expired') THEN
        RAISE EXCEPTION 'Saving hardware upgrade payment window has closed' USING ERRCODE='23514';
      END IF;
      IF NEW.total_amount IS DISTINCT FROM upgrade.price_delta_irr
        OR NOT saving_hardware_invoice_has_scope(
          upgrade.order_id,upgrade.contract_id,upgrade.contract_version_id,upgrade.original_invoice_id,NEW
        ) THEN
        RAISE EXCEPTION 'Saving hardware upgrade invoice scope requires reconciliation' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION refresh_saving_cancellation_financial_status(order_key uuid) RETURNS void LANGUAGE sql AS $$
  WITH facts AS (
    SELECT s.id,
      jsonb_array_length(n.refund_decision->'refunds') AS expected_returns,
      contract_has_pending_payments(c.id) OR EXISTS (
        SELECT 1 FROM invoices i JOIN refunds r ON r.invoice_id=i.id
        WHERE i.profile_id=c.profile_id
          AND (i.contract_id=c.id::text OR (i.order_id=c.order_id AND i.contract_id IS NULL))
          AND r.state NOT IN ('Completed','Rejected','Cancelled')
          AND NOT EXISTS (SELECT 1 FROM contract_refund_obligations o WHERE o.refund_id=r.id AND o.contract_id=c.id)
      ) AS unsettled,
      (SELECT count(*) FROM contract_refund_obligations o WHERE o.contract_id=c.id) AS recorded_returns,
      EXISTS (
        SELECT 1 FROM contract_refund_obligations o JOIN refunds r ON r.id=o.refund_id
        LEFT JOIN refund_transactions t ON t.refund_id=r.id
        WHERE o.contract_id=c.id AND (r.state<>'Completed' OR t.state IS DISTINCT FROM 'Completed')
      ) AS unfinished_returns,
      EXISTS (SELECT 1 FROM invoices i WHERE i.profile_id=c.profile_id AND i.paid_amount>0
        AND (i.contract_id=c.id::text OR (i.order_id=c.order_id AND i.contract_id IS NULL))) AS has_payment
    FROM saving_orders s
    JOIN orders o ON o.id=s.order_id AND o.profile_id=s.profile_id AND o.order_type='savings'
    JOIN contracts c ON c.order_id=o.id AND c.profile_id=s.profile_id
      AND c.service_type='savings' AND c.state='Cancelled'
    JOIN contract_cancellations x ON x.contract_id=c.id
    JOIN contract_cancellation_intents n ON n.id=x.intent_id
    WHERE s.order_id=order_key AND s.status='cancelled'
  ), outcomes AS (
    SELECT id,CASE
      WHEN unsettled OR expected_returns<>recorded_returns OR unfinished_returns THEN 'refund_pending'
      WHEN expected_returns>0 THEN 'refunded'
      WHEN has_payment THEN 'paid'
      ELSE 'unpaid' END AS financial_status
    FROM facts
  )
  UPDATE saving_orders s SET financial_status=o.financial_status,updated_at=clock_timestamp()
    FROM outcomes o WHERE s.id=o.id AND s.financial_status IS DISTINCT FROM o.financial_status;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION sync_saving_cancellation_return() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_key uuid;
BEGIN
  IF TG_TABLE_NAME IN ('contract_cancellations','contract_refund_obligations') THEN
    SELECT order_id INTO order_key FROM contracts WHERE id=NEW.contract_id;
  ELSIF TG_TABLE_NAME='refunds' THEN
    SELECT c.order_id INTO order_key FROM invoices i JOIN contracts c
      ON c.profile_id=i.profile_id
        AND (c.id::text=i.contract_id OR (c.order_id=i.order_id AND i.contract_id IS NULL))
      WHERE i.id=NEW.invoice_id AND i.profile_id=NEW.profile_id AND c.service_type='savings';
  ELSE
    SELECT c.order_id INTO order_key FROM refunds r JOIN invoices i ON i.id=r.invoice_id
      JOIN contracts c ON c.profile_id=i.profile_id
        AND (c.id::text=i.contract_id OR (c.order_id=i.order_id AND i.contract_id IS NULL))
      WHERE r.id=NEW.refund_id AND r.profile_id=i.profile_id AND c.service_type='savings';
  END IF;
  IF order_key IS NOT NULL THEN PERFORM refresh_saving_cancellation_financial_status(order_key); END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION synchronize_saving_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE saving saving_orders%ROWTYPE;
BEGIN
  IF NEW.service_type='savings' AND NEW.state='Cancelled' AND OLD.state<>'Cancelled' THEN
    SELECT s.* INTO saving FROM saving_orders s
      JOIN orders o ON o.id=s.order_id AND o.profile_id=s.profile_id AND o.order_type='savings'
      WHERE o.id=NEW.order_id AND o.profile_id=NEW.profile_id FOR UPDATE OF s;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF saving.status IN ('completed','rejected') THEN
      RAISE EXCEPTION 'Completed or rejected saving orders cannot be cancelled' USING ERRCODE='23514';
    END IF;
    UPDATE saving_orders SET status='cancelled',
      financial_status=CASE WHEN EXISTS (
        SELECT 1 FROM invoices i WHERE i.profile_id=NEW.profile_id AND i.paid_amount>i.refunded_amount
          AND (i.contract_id=NEW.id::text OR (i.order_id=NEW.order_id AND i.contract_id IS NULL))
      ) THEN 'refund_pending' WHEN EXISTS (
        SELECT 1 FROM invoices i WHERE i.profile_id=NEW.profile_id AND i.paid_amount>0
          AND (i.contract_id=NEW.id::text OR (i.order_id=NEW.order_id AND i.contract_id IS NULL))
      ) THEN 'refunded' ELSE 'unpaid' END,
      updated_at=clock_timestamp()
      WHERE id=saving.id AND status NOT IN ('cancelled','rejected','completed');
    UPDATE orders SET status='CANCELLED',updated_at=clock_timestamp()
      WHERE id=NEW.order_id;
  END IF;
  RETURN NULL;
END $$;
