-- The contract completion evidence is the authority for the electricity term.
-- Keep the linked order and electricity contract statuses in the same transaction.
CREATE FUNCTION sync_electricity_order_completion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.service_type='electricity' AND OLD.state='Active' AND NEW.state='Completed'
  AND NEW.order_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM electricity_orders e WHERE e.id=NEW.order_id
  ) THEN
  UPDATE electricity_orders SET status='completed',updated_at=clock_timestamp()
   WHERE id=NEW.order_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Electricity order is not active for completion'
   USING ERRCODE='23514',CONSTRAINT='electricity_completion_prerequisites'; END IF;
  UPDATE electricity_contracts SET status='completed',updated_at=clock_timestamp()
   WHERE contract_id=NEW.id AND order_id=NEW.order_id AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Electricity contract is not active for completion'
   USING ERRCODE='23514',CONSTRAINT='electricity_completion_prerequisites'; END IF;
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contracts_electricity_completion_sync AFTER UPDATE OF state ON contracts
 FOR EACH ROW EXECUTE FUNCTION sync_electricity_order_completion();
--> statement-breakpoint
-- Reconcile linked rows whose contracts completed before this trigger existed.
WITH repaired AS (
 UPDATE electricity_orders e SET status='completed',updated_at=clock_timestamp()
 FROM electricity_contracts ec JOIN contracts c ON c.id=ec.contract_id
 WHERE ec.order_id=e.id AND c.order_id=e.id AND c.service_type='electricity'
  AND c.state='Completed' AND e.status='active'
 RETURNING e.id AS order_id,e.profile_id,ec.contract_id
)
INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,ip)
SELECT uuid_generate_v7(),p.user_id,'electricity.order_completion_reconciled',
 jsonb_build_object('orderId',r.order_id,'contractId',r.contract_id,'actorType','system'),
 uuid_generate_v7(),'127.0.0.1'
FROM repaired r JOIN profiles p ON p.id=r.profile_id;
--> statement-breakpoint
UPDATE electricity_contracts ec SET status='completed',updated_at=clock_timestamp()
 FROM contracts c JOIN electricity_orders e ON e.id=c.order_id
 WHERE ec.contract_id=c.id AND ec.order_id=e.id AND e.status='completed'
 AND c.service_type='electricity' AND c.state='Completed' AND ec.status='active';
