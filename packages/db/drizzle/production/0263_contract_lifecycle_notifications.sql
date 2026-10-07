-- Future lifecycle transitions enqueue their customer delivery in the same
-- transaction, including system activation. Do not backfill or rewrite history,
-- and do not replace any activation, cancellation, refund or audit guard.
CREATE FUNCTION notify_contract_lifecycle_customer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 lifecycle_event text;
 recipient text;
 occurrence_key text;
 delivery_id uuid;
 notice_id uuid;
 data jsonb;
 content jsonb;
 type_labels jsonb:= '{"electricity":{"fa":"برق","en":"Electricity"},"savings":{"fa":"صرفه‌جویی","en":"Energy saving"},"solar":{"fa":"نیروگاه خورشیدی","en":"Solar"}}';
 notice_link text;
 priority text;
 written integer;
BEGIN
 IF TG_OP='INSERT' THEN
  lifecycle_event:='contract.created';
 ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state='Active' THEN
  lifecycle_event:='contract.active';
 ELSIF NEW.state IS DISTINCT FROM OLD.state AND NEW.state='Cancelled' THEN
  lifecycle_event:='contract.cancelled';
 ELSE
  RETURN NULL;
 END IF;
 SELECT user_id INTO recipient FROM profiles WHERE id=NEW.profile_id;
 IF recipient IS NULL THEN
  RAISE EXCEPTION 'Contract customer recipient is unavailable' USING ERRCODE='23514';
 END IF;
 occurrence_key:=lifecycle_event||':'||NEW.id::text||':'||NEW.current_version_id::text||':'||recipient;
 notice_link:='/contracts/'||NEW.id::text;
 IF lifecycle_event='contract.created' THEN
  notice_link:='/contracts';
 ELSIF lifecycle_event='contract.cancelled' AND NOT EXISTS(
  SELECT 1 FROM contract_publications WHERE contract_id=NEW.id
 ) THEN
  notice_link:=CASE WHEN NEW.service_type='electricity' AND NEW.order_id IS NOT NULL AND EXISTS(
   SELECT 1 FROM electricity_contracts ec JOIN electricity_orders e ON e.id=ec.order_id
   JOIN contract_activation_requirements ar ON ar.contract_id=ec.contract_id AND ar.version_id=NEW.current_version_id
   JOIN invoices i ON i.id=ar.initial_invoice_id AND i.profile_id=NEW.profile_id
   WHERE ec.contract_id=NEW.id AND ec.order_id=NEW.order_id
  )
   THEN '/electricity/orders/'||NEW.order_id::text ELSE '/contracts' END;
 END IF;
 data:=jsonb_build_object('contractId',NEW.id::text,'contractNumber',NEW.contract_number::text,'link_route',notice_link);
 IF lifecycle_event='contract.created' THEN
  data:=data||jsonb_build_object('contractType',
   (type_labels->(NEW.service_type::text)->>'fa')||' / '||(type_labels->(NEW.service_type::text)->>'en'));
  content:=jsonb_build_object(
   'fa',jsonb_build_object('title','قرارداد جدید ایجاد شد','body','قرارداد شماره '||NEW.contract_number::text||' ایجاد شد. متن قرارداد پس از انتشار توسط کارشناس برای بررسی شما قابل مشاهده خواهد بود.'),
   'en',jsonb_build_object('title','New contract created','body','Contract '||NEW.contract_number::text||' was created. Its terms will be available for your review after staff publication.'));
 ELSIF lifecycle_event='contract.active' THEN
  content:=jsonb_build_object(
   'fa',jsonb_build_object('title','قرارداد فعال شد','body','قرارداد شماره '||NEW.contract_number::text||' شما فعال است.'),
   'en',jsonb_build_object('title','Contract active','body','Your contract '||NEW.contract_number::text||' is now active.'));
 ELSE
  content:=jsonb_build_object(
   'fa',jsonb_build_object('title','قرارداد لغو شد','body','قرارداد شماره '||NEW.contract_number::text||' لغو شد. وضعیت بازپرداخت جداگانه پیگیری می‌شود.'),
   'en',jsonb_build_object('title','Contract cancelled','body','Contract '||NEW.contract_number::text||' was cancelled. Refund progress is tracked separately.'));
 END IF;
 priority:=CASE WHEN lifecycle_event='contract.cancelled' THEN 'urgent' ELSE 'normal' END;
 INSERT INTO notification_outbox(profile_id,user_id,event_key,payload,channels,status,idempotency_key,max_attempts)
 VALUES(NEW.profile_id,recipient,lifecycle_event,data,ARRAY['in_app','email'],'queued',occurrence_key,5)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO delivery_id;
 IF delivery_id IS NULL THEN
  -- A replay preserves original content, read state, job outcomes and receipts.
  PERFORM 1 FROM notification_outbox ob JOIN in_app_notifications n ON n.delivery_key='outbox:'||ob.id::text
   WHERE ob.idempotency_key=occurrence_key AND ob.profile_id=NEW.profile_id AND ob.user_id=recipient
   AND ob.event_key=lifecycle_event AND ob.payload=data AND ob.channels=ARRAY['in_app','email']
   AND n.profile_id=ob.profile_id AND n.recipient_user_id=ob.user_id AND n.operating_context='customer' AND n.type=ob.event_key
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='in_app')
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='email')
   AND EXISTS(SELECT 1 FROM notification_delivery_log WHERE notification_id=ob.id AND channel='in_app'
    AND status='delivered' AND attempt_number=1 AND provider_ref=n.id::text);
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Contract notification occurrence conflicts with saved delivery' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END IF;
 INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,params,localized_content,link_route,delivery_key)
 VALUES(NEW.profile_id,recipient,'customer',lifecycle_event,'notifications.legacy.title','notifications.legacy.body',data,content,data->>'link_route','outbox:'||delivery_id::text)
 RETURNING id INTO notice_id;
 IF notice_id IS NULL THEN
  RAISE EXCEPTION 'Mandatory contract inbox delivery was not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
 VALUES(delivery_id,'in_app','done',priority,5,1,notice_id::text,data),
       (delivery_id,'email','queued',priority,5,0,NULL,NULL);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>2 THEN
  RAISE EXCEPTION 'Contract delivery jobs were not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
 VALUES(delivery_id,'in_app','delivered',1,notice_id::text);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 THEN
  RAISE EXCEPTION 'Contract inbox delivery history was not stored' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER contract_lifecycle_customer_notifications
AFTER INSERT OR UPDATE OF state ON contracts
FOR EACH ROW EXECUTE FUNCTION notify_contract_lifecycle_customer();
