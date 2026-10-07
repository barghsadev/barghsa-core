-- Future positive refund/correction credits commit private delivery with the ledger.
-- No historical backfill; top-up/payment/debit notices remain separate.
CREATE FUNCTION notify_wallet_credit_customer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 recipient text;
 outcome_event text;
 occurrence_key text;
 delivery_id uuid;
 notice_id uuid;
 data jsonb;
 content jsonb;
 written integer;
BEGIN
 IF NEW.type NOT IN ('refund','reversal','compensating') OR NEW.state<>'Completed' OR NEW.amount<=0 THEN RETURN NULL; END IF;
 outcome_event:='wallet.credit_received';
 SELECT user_id INTO recipient FROM profiles WHERE id=NEW.wallet_id;
 IF recipient IS NULL THEN
  RAISE EXCEPTION 'Wallet credit customer recipient is unavailable' USING ERRCODE='23514';
 END IF;
 occurrence_key:=outcome_event||':'||NEW.id::text||':'||recipient;
 data:=jsonb_build_object('amount',NEW.amount::text,'transactionId',NEW.id::text,'link_route','/wallet',
  'reason',CASE WHEN NEW.type='refund' THEN 'بازپرداخت / Refund' ELSE 'اصلاح تراکنش / Transaction correction' END);
 content:=jsonb_build_object(
  'fa',jsonb_build_object('title','اعتبار کیف پول افزایش یافت','body',NEW.amount::text||' ریال به کیف پول شما اضافه شد. جزئیات در سابقه کیف پول موجود است.'),
  'en',jsonb_build_object('title','Wallet credited','body',NEW.amount::text||' IRR was added to your wallet. View wallet history for details.'));
 INSERT INTO notification_outbox(profile_id,user_id,event_key,payload,channels,status,idempotency_key,max_attempts)
 VALUES(NEW.wallet_id,recipient,outcome_event,data,ARRAY['in_app','email'],'queued',occurrence_key,5)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO delivery_id;
 IF delivery_id IS NULL THEN
  -- A replay preserves original content, read state, job outcomes and receipts.
  PERFORM 1 FROM notification_outbox ob JOIN in_app_notifications n ON n.delivery_key='outbox:'||ob.id::text
   WHERE ob.idempotency_key=occurrence_key AND ob.profile_id=NEW.wallet_id AND ob.user_id=recipient
   AND ob.event_key=outcome_event AND ob.payload=data AND ob.channels=ARRAY['in_app','email']
   AND n.profile_id=ob.profile_id AND n.recipient_user_id=ob.user_id AND n.operating_context='customer' AND n.type=ob.event_key
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='in_app')
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='email')
   AND EXISTS(SELECT 1 FROM notification_delivery_log WHERE notification_id=ob.id AND channel='in_app'
    AND status='delivered' AND attempt_number=1 AND provider_ref=n.id::text);
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Wallet credit notification occurrence conflicts with saved delivery' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END IF;
 INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,params,localized_content,link_route,delivery_key)
 VALUES(NEW.wallet_id,recipient,'customer',outcome_event,'notifications.legacy.title','notifications.legacy.body',data,content,data->>'link_route','outbox:'||delivery_id::text)
 RETURNING id INTO notice_id;
 IF notice_id IS NULL THEN
  RAISE EXCEPTION 'Mandatory wallet credit inbox delivery was not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
 VALUES(delivery_id,'in_app','done','urgent',5,1,notice_id::text,data),
       (delivery_id,'email','queued','urgent',5,0,NULL,NULL);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>2 THEN
  RAISE EXCEPTION 'Wallet credit delivery jobs were not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
 VALUES(delivery_id,'in_app','delivered',1,notice_id::text);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 THEN
  RAISE EXCEPTION 'Wallet credit inbox delivery history was not stored' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER wallet_credit_customer_notifications
AFTER INSERT ON wallet_transactions
FOR EACH ROW EXECUTE FUNCTION notify_wallet_credit_customer();
