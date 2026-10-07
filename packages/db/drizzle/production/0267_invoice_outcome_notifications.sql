-- Future customer invoice outcomes share the original invoice/payment transaction.
-- Scheduled payment.invoice_reminder occurrences retain their existing engine/history.
CREATE FUNCTION notify_invoice_outcome_customer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 recipient text;
 outcome_event text;
 occurrence_key text;
 delivery_id uuid;
 notice_id uuid;
 data jsonb;
 content jsonb;
 priority text;
 amount text;
 written integer;
BEGIN
 IF NEW.state IS NOT DISTINCT FROM OLD.state OR NEW.profile_id IS NULL OR NEW.adjustment_kind='credit' THEN RETURN NULL; END IF;
 IF NEW.state='Paid' AND NEW.total_amount>0 AND NEW.paid_amount=NEW.total_amount THEN
  outcome_event:='payment.invoice_paid';
  priority:='urgent';
  amount:=NEW.paid_amount::text;
 ELSIF NEW.state='Overdue' AND NEW.due_at IS NOT NULL AND isfinite(NEW.due_at) AND NEW.due_at<clock_timestamp()
   AND NEW.total_amount>NEW.paid_amount THEN
  outcome_event:='payment.invoice_overdue';
  priority:='normal';
  amount:=(NEW.total_amount-NEW.paid_amount)::text;
 ELSE RETURN NULL;
 END IF;
 -- Retain the caller's original lock order; do not add account/fan-out locks.
 SELECT user_id INTO recipient FROM profiles WHERE id=NEW.profile_id;
 IF recipient IS NULL THEN
  RAISE EXCEPTION 'Invoice customer recipient is unavailable' USING ERRCODE='23514';
 END IF;
 occurrence_key:=outcome_event||':'||NEW.id::text||':'||recipient;
 IF outcome_event='payment.invoice_overdue' THEN occurrence_key:=occurrence_key||':'||to_char(NEW.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'); END IF;
 data:=jsonb_build_object('invoiceId',NEW.id::text,'invoiceNumber',NEW.id::text,'amount',amount,'link_route','/invoices/'||NEW.id::text);
 IF outcome_event='payment.invoice_paid' THEN
  data:=data||jsonb_build_object('paidAt',to_char(COALESCE(NEW.paid_at,clock_timestamp()) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  content:=jsonb_build_object(
   'fa',jsonb_build_object('title','صورتحساب پرداخت شد','body','پرداخت صورتحساب به مبلغ '||amount||' ریال کامل شد. جزئیات و وضعیت بازپرداخت احتمالی در صورتحساب موجود است.'),
   'en',jsonb_build_object('title','Invoice paid','body','The invoice payment of '||amount||' IRR completed. View the invoice for details and any refund progress.'));
 ELSE
  data:=data||jsonb_build_object('dueDate',to_char(NEW.due_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  content:=jsonb_build_object(
   'fa',jsonb_build_object('title','سررسید صورتحساب گذشته است','body','صورتحساب شما با مانده '||amount||' ریال از سررسید گذشته است. آخرین وضعیت پرداخت را در صورتحساب بررسی کنید.'),
   'en',jsonb_build_object('title','Invoice overdue','body','Your invoice has passed its due date with '||amount||' IRR remaining. Check its current payment status.'));
 END IF;
 INSERT INTO notification_outbox(profile_id,user_id,event_key,payload,channels,status,idempotency_key,max_attempts)
 VALUES(NEW.profile_id,recipient,outcome_event,data,ARRAY['in_app','email'],'queued',occurrence_key,5)
 ON CONFLICT(idempotency_key) DO NOTHING RETURNING id INTO delivery_id;
 IF delivery_id IS NULL THEN
  -- A replay preserves original content, read state, job outcomes and receipts.
  PERFORM 1 FROM notification_outbox ob JOIN in_app_notifications n ON n.delivery_key='outbox:'||ob.id::text
   WHERE ob.idempotency_key=occurrence_key AND ob.profile_id=NEW.profile_id AND ob.user_id=recipient
   AND ob.event_key=outcome_event AND ob.payload=data AND ob.channels=ARRAY['in_app','email']
   AND n.profile_id=ob.profile_id AND n.recipient_user_id=ob.user_id AND n.operating_context='customer' AND n.type=ob.event_key
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='in_app')
   AND EXISTS(SELECT 1 FROM notification_job WHERE outbox_id=ob.id AND channel='email')
   AND EXISTS(SELECT 1 FROM notification_delivery_log WHERE notification_id=ob.id AND channel='in_app'
    AND status='delivered' AND attempt_number=1 AND provider_ref=n.id::text);
  IF NOT FOUND THEN
   RAISE EXCEPTION 'Invoice outcome notification occurrence conflicts with saved delivery' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
 END IF;
 INSERT INTO in_app_notifications(profile_id,recipient_user_id,operating_context,type,title_i18n_key,body_i18n_key,params,localized_content,link_route,delivery_key)
 VALUES(NEW.profile_id,recipient,'customer',outcome_event,'notifications.legacy.title','notifications.legacy.body',data,content,data->>'link_route','outbox:'||delivery_id::text)
 RETURNING id INTO notice_id;
 IF notice_id IS NULL THEN
  RAISE EXCEPTION 'Mandatory invoice outcome inbox delivery was not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_job(outbox_id,channel,status,priority,max_attempts,attempts,provider_ref,delivery_payload)
 VALUES(delivery_id,'in_app','done',priority,5,1,notice_id::text,data),
       (delivery_id,'email','queued',priority,5,0,NULL,NULL);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>2 THEN
  RAISE EXCEPTION 'Invoice outcome delivery jobs were not stored' USING ERRCODE='23514';
 END IF;
 INSERT INTO notification_delivery_log(notification_id,channel,status,attempt_number,provider_ref)
 VALUES(delivery_id,'in_app','delivered',1,notice_id::text);
 GET DIAGNOSTICS written=ROW_COUNT;
 IF written<>1 THEN
  RAISE EXCEPTION 'Invoice outcome inbox delivery history was not stored' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER invoice_outcome_customer_notifications
AFTER UPDATE OF state ON invoices
FOR EACH ROW EXECUTE FUNCTION notify_invoice_outcome_customer();
