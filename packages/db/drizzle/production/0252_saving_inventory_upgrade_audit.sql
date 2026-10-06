-- Actual reservation row changes carry their OLD/NEW states and event timestamps. Legacy inventory
-- action names also describe stock transfers, so preserve them as observations
-- without inventing reservation transitions or duplicating a confirmed row event.
CREATE FUNCTION audit_saving_inventory_row_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected_user text; affected_profile uuid; previous_state text; previous_hardware uuid; event_name text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.hardware_product_id IS NOT DISTINCT FROM OLD.hardware_product_id THEN RETURN NULL; END IF;
  previous_state:=OLD.status;previous_hardware:=OLD.hardware_product_id;
 END IF;
 SELECT o.user_id,s.profile_id INTO affected_user,affected_profile FROM saving_orders s JOIN orders o ON o.id=s.order_id WHERE s.id=NEW.order_id;
 event_name:=CASE WHEN TG_OP='UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN 'saving.inventory.reservation_changed' ELSE 'saving.inventory.'||NEW.status END;
 INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
 VALUES(uuid_generate_v7()::text,affected_user,event_name,
  jsonb_build_object('entity','saving_inventory_reservation','entityId',NEW.id,'fromState',previous_state,'toState',NEW.status,'reason',NULL,'actor','system','actorType','system','profileId',affected_profile,'affectedUserId',affected_user,'savingOrderId',NEW.order_id,'reservationId',NEW.id,'previousHardwareProductId',previous_hardware,'hardwareProductId',NEW.hardware_product_id,'kind','reservation_change','transactionId',txid_current()::text)::text,uuid_generate_v7()::text,clock_timestamp());
 RETURN NULL;
END $$;
CREATE TRIGGER saving_inventory_reservation_audit AFTER INSERT OR UPDATE ON saving_inventory_reservations
 FOR EACH ROW EXECUTE FUNCTION audit_saving_inventory_row_change();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION audit_saving_inventory(target_order uuid,reservation_id uuid,state_name text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE owner record; reservation saving_inventory_reservations%ROWTYPE; current_state text;
BEGIN
 SELECT o.user_id,s.profile_id,s.status,s.hardware_product_id INTO owner FROM saving_orders s JOIN orders o ON o.id=s.order_id WHERE s.id=target_order;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saving inventory order is unavailable' USING ERRCODE='23514'; END IF;
 IF reservation_id IS NOT NULL THEN
  SELECT * INTO reservation FROM saving_inventory_reservations WHERE id=reservation_id AND order_id=target_order;
  IF NOT FOUND THEN RAISE EXCEPTION 'Saving inventory reservation is unavailable' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM audit_log WHERE event='saving.inventory.'||state_name AND metadata::jsonb->>'reservationId'=reservation_id::text AND metadata::jsonb->>'kind'='reservation_change' AND metadata::jsonb->>'transactionId'=txid_current()::text) THEN RETURN; END IF;
 END IF;
 current_state:=COALESCE(reservation.status,owner.status);
 INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
 VALUES(uuid_generate_v7()::text,owner.user_id,'saving.inventory.'||state_name,
  jsonb_build_object('entity',CASE WHEN reservation.id IS NULL THEN 'saving_order' ELSE 'saving_inventory_reservation' END,'entityId',COALESCE(reservation.id,target_order),'fromState',current_state,'toState',current_state,'reason',NULL,'actor','system','actorType','system','profileId',owner.profile_id,'affectedUserId',owner.user_id,'savingOrderId',target_order,'reservationId',reservation_id,'hardwareProductId',COALESCE(reservation.hardware_product_id,owner.hardware_product_id),'action',state_name,'kind','inventory_action','transactionId',txid_current()::text)::text,uuid_generate_v7()::text,clock_timestamp());
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
    WHERE adjustment_invoice_id=NEW.id FOR UPDATE;
  IF NOT FOUND OR upgrade.status<>'awaiting_payment' THEN RETURN NEW; END IF;
  IF NEW.state='Paid' THEN
    SELECT * INTO saving FROM saving_orders WHERE id=upgrade.order_id FOR UPDATE;
    IF saving.status NOT IN ('approved','in_progress') OR saving.financial_status<>'paid'
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
