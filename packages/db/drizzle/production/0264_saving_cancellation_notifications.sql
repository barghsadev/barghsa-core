-- Mirror the saving commercial cancellation occurrence in the same transaction
-- as its existing contract/inventory/refund synchronization. Future writes only.
CREATE FUNCTION notify_saving_cancellation_customer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 recipient text;
 contract_id uuid;
 contract_version uuid;
 occurrence_key text;
 delivery_id uuid;
 notice_id uuid;
 data jsonb;
 content jsonb;
 written integer;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status<>'cancelled' THEN
  RETURN NULL;
 END IF;
 SELECT c.id,c.current_version_id INTO contract_id,contract_version FROM contracts c
  WHERE c.order_id=NEW.order_id AND c.profile_id=NEW.profile_id
   AND c.service_type='savings' AND c.state='Cancelled';
 IF contract_id IS NULL THEN
  RAISE EXCEPTION 'Saving cancellation requires its cancelled contract' USING ERRCODE='23514';
 END IF;
 SELECT user_id INTO recipient FROM profiles WHERE id=NEW.profile_id FOR SHARE;
 IF recipient IS NULL THEN
  RAISE EXCEPTION 'Saving customer recipient is unavailable' USING ERRCODE='23514';
 END IF;
 occurrence_key:='order.status_changed:saving:'||NEW.id::text||':contract_cancel:'||contract_version::text||':'||recipient;
 data:=jsonb_build_object('orderNumber',NEW.id::text,'status','cancelled',
  'newStatus','لغوشده / Cancelled','contractId',contract_id::text,'link_route','/savings/orders/'||NEW.id::text);
 content:=jsonb_build_object(
  'fa',jsonb_build_object('title','سفارش صرفه‌جویی لغو شد','body','سفارش صرفه‌جویی شما لغو شد. وضعیت بازپرداخت جداگانه پیگیری می‌شود.'),
  'en',jsonb_build_object('title','Saving order cancelled','body','Your power-saving order was cancelled. Refund progress is tracked separately.'));
 INSERT INTO notification_outbox(profile_id,user_id,event_key,payload,channels,status,idempotency_key,max_attempts)
 VALUES(NEW.profile_id,recipient,'order.status_changed',data,ARRAY['in_app','email'],'queued',occurrence_key,5)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO delivery_id;
 IF delivery_id IS NULL THEN
  -- A replay preserves original content, read state, job outcomes and receipts.
  PERFORM 1 FROM notification_outbox ob JOIN in_app_notifications n ON n.delivery_key='outbox:'||ob.id::text
   WHERE ob.idempotency_key=occurrence_key AND ob.profile_id=NEW.profile_id AND ob.user_id=recipient
   AND ob.event_key='order.status_changed' AND ob.payload=data AND ob.channels=ARRAY['in_app','email']
   AND n.profile_id=ob.profile_id AND n.recipient_user_id=ob.user_id AND n.operating_context='customer' AND n.type=ob.event_key
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='in_app')
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='email')
   AND EXISTS(SELECT 1 FROM notification_delivery_log WHERE notification_id=ob.id AND channel='in_app'
    AND status='delivered' AND attempt_number=1 AND provider_ref=n.id::text);
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Saving cancellation notification occurrence conflicts with saved delivery' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END IF;
 INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,params,localized_content,link_route,delivery_key)
 VALUES(NEW.profile_id,recipient,'customer','order.status_changed','notifications.legacy.title','notifications.legacy.body',data,content,data->>'link_route','outbox:'||delivery_id::text)
 RETURNING id INTO notice_id;
 IF notice_id IS NULL THEN
  RAISE EXCEPTION 'Mandatory saving cancellation inbox delivery was not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
 VALUES(delivery_id,'in_app','done','normal',5,1,notice_id::text,data),
       (delivery_id,'email','queued','normal',5,0,NULL,NULL);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>2 THEN
  RAISE EXCEPTION 'Saving cancellation delivery jobs were not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
 VALUES(delivery_id,'in_app','delivered',1,notice_id::text);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 THEN
  RAISE EXCEPTION 'Saving cancellation inbox delivery history was not stored' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_cancellation_customer_notifications
AFTER UPDATE OF status ON saving_orders
FOR EACH ROW EXECUTE FUNCTION notify_saving_cancellation_customer();
