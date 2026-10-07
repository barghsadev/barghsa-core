-- Future electricity status synchronization shares the native contract transaction.
-- API review/revision/raw/customer cancellation producers remain separate.
CREATE FUNCTION notify_electricity_lifecycle_customer() RETURNS trigger LANGUAGE plpgsql AS $$
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
 label_fa text;
 label_en text;
BEGIN
 IF NEW.status IS NOT DISTINCT FROM OLD.status OR NEW.status NOT IN ('active','completed','cancelled') THEN
  RETURN NULL;
 END IF;
 SELECT c.id,c.current_version_id INTO contract_id,contract_version FROM contracts c
  JOIN electricity_contracts ec ON ec.contract_id=c.id AND ec.order_id=NEW.id
  WHERE c.order_id=NEW.id AND c.profile_id=NEW.profile_id AND c.service_type='electricity'
   AND c.state::text=CASE NEW.status WHEN 'active' THEN 'Active' WHEN 'completed' THEN 'Completed' ELSE 'Cancelled' END;
 -- Raw/customer API cancellation has its own guarded occurrence; no duplicate here.
 IF contract_id IS NULL THEN RETURN NULL; END IF;
 SELECT user_id INTO recipient FROM profiles WHERE id=NEW.profile_id FOR SHARE;
 IF recipient IS NULL THEN
  RAISE EXCEPTION 'Electricity customer recipient is unavailable' USING ERRCODE='23514';
 END IF;
 label_fa:=CASE NEW.status WHEN 'active' THEN 'فعال' WHEN 'completed' THEN 'تکمیل‌شده' ELSE 'لغوشده' END;
 label_en:=CASE NEW.status WHEN 'active' THEN 'Active' WHEN 'completed' THEN 'Completed' ELSE 'Cancelled' END;
 occurrence_key:='order.status_changed:electricity:'||NEW.id::text||':contract_'||NEW.status||':'||contract_version::text||':'||recipient;
 data:=jsonb_build_object('orderNumber',NEW.id::text,'status',NEW.status,
  'newStatus',label_fa||' / '||label_en,'contractId',contract_id::text,'link_route','/electricity/orders/'||NEW.id::text);
 content:=jsonb_build_object(
  'fa',jsonb_build_object('title','وضعیت سفارش برق تغییر کرد','body','وضعیت سفارش برق شما به «'||label_fa||'» تغییر کرد.'||CASE WHEN NEW.status='cancelled' THEN ' وضعیت بازپرداخت جداگانه پیگیری می‌شود.' ELSE '' END),
  'en',jsonb_build_object('title','Electricity order status changed','body','Your electricity order status changed to '||label_en||'.'||CASE WHEN NEW.status='cancelled' THEN ' Refund progress is tracked separately.' ELSE '' END));
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
   RAISE EXCEPTION 'Electricity lifecycle notification occurrence conflicts with saved delivery' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END IF;
 INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,params,localized_content,link_route,delivery_key)
 VALUES(NEW.profile_id,recipient,'customer','order.status_changed','notifications.legacy.title','notifications.legacy.body',data,content,data->>'link_route','outbox:'||delivery_id::text)
 RETURNING id INTO notice_id;
 IF notice_id IS NULL THEN
  RAISE EXCEPTION 'Mandatory electricity lifecycle inbox delivery was not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
 VALUES(delivery_id,'in_app','done','normal',5,1,notice_id::text,data),
       (delivery_id,'email','queued','normal',5,0,NULL,NULL);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>2 THEN
  RAISE EXCEPTION 'Electricity lifecycle delivery jobs were not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
 VALUES(delivery_id,'in_app','delivered',1,notice_id::text);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 THEN
  RAISE EXCEPTION 'Electricity lifecycle inbox delivery history was not stored' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_lifecycle_customer_notifications
AFTER UPDATE OF status ON electricity_orders
FOR EACH ROW EXECUTE FUNCTION notify_electricity_lifecycle_customer();
