-- Extend only future automatic audit metadata. Existing activation/expiry locks,
-- money and receipt policy, notifications and immutable history stay intact.
CREATE OR REPLACE FUNCTION finalize_paid_electricity_increase(p_request_id uuid, p_now timestamptz DEFAULT clock_timestamp()) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r electricity_quantity_increase_requests%ROWTYPE;
DECLARE recipient text;
BEGIN
  SELECT * INTO r FROM electricity_quantity_increase_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status<>'awaiting_payment' OR r.effective_from>p_now
     OR r.period_end<=p_now
     OR (r.pricing_snapshot->>'eligibleFrom')::timestamptz>p_now
     OR NOT EXISTS (
       SELECT 1 FROM invoices i JOIN contracts c ON c.id=r.contract_id
       WHERE i.id=r.adjustment_invoice_id AND i.state='Paid'
         AND i.paid_amount>=i.total_amount AND i.refunded_amount=0 AND c.state='Active'
     ) THEN RETURN false; END IF;
  UPDATE electricity_quantity_increase_requests
     SET status='effective',effective_at=p_now WHERE id=r.id;
  INSERT INTO audit_log(id,user_id,event,metadata,correlation_id)
    VALUES(uuid_generate_v7()::text,r.requested_by,'electricity.increase_effective',
      jsonb_build_object('entity','electricity_quantity_increase_request','entityId',r.id,'fromState',r.status,'toState','effective','reason',NULL,'actor','system','actorType','system','profileId',r.profile_id,'affectedUserId',r.requested_by,'requestId',r.id,'contractId',r.contract_id,
        'orderId',r.order_id,'invoiceId',r.adjustment_invoice_id,
        'originalKwh',r.original_kwh,'requestedKwh',r.requested_kwh)::text,
      uuid_generate_v7()::text);
  SELECT user_id INTO recipient FROM profiles WHERE id=r.profile_id;
  INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,
    body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
  VALUES(uuid_generate_v7(),recipient,r.profile_id,'general',
    'notifications.legacy.title','notifications.legacy.body',
    jsonb_build_object('fa',jsonb_build_object('title','قرارداد',
      'body','افزایش مقدار برق پس از پرداخت کامل اعمال شد.'),
      'en',jsonb_build_object('title','Contract',
      'body','Your electricity quantity increase is now effective after full payment.')),
    '/electricity/orders/'||r.order_id::text,false,p_now,
    'electricity-increase-effective:'||r.id::text);
  RETURN true;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION expire_electricity_increase(p_request_id uuid,p_now timestamptz DEFAULT clock_timestamp())
 RETURNS text LANGUAGE plpgsql AS $$
DECLARE r electricity_quantity_increase_requests%ROWTYPE;
DECLARE invoice_id uuid;
DECLARE inv invoices%ROWTYPE;
DECLARE disposition text:='unsigned';
DECLARE recipient text;
BEGIN
  SELECT adjustment_invoice_id INTO invoice_id FROM electricity_quantity_increase_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RETURN 'skipped'; END IF;
  IF invoice_id IS NOT NULL THEN SELECT * INTO inv FROM invoices WHERE id=invoice_id FOR UPDATE; END IF;
  SELECT * INTO r FROM electricity_quantity_increase_requests WHERE id=p_request_id FOR UPDATE;
  IF NOT FOUND OR r.status NOT IN ('pending','awaiting_signature','awaiting_payment') OR r.period_end>p_now
     OR (invoice_id IS DISTINCT FROM r.adjustment_invoice_id) THEN RETURN 'skipped'; END IF;
  IF r.adjustment_invoice_id IS NOT NULL THEN
    IF inv.id IS NULL THEN RAISE EXCEPTION 'Signed increase invoice is missing' USING ERRCODE='23514'; END IF;
    IF inv.state IN ('Unpaid','Overdue') AND inv.paid_amount=0 THEN
      UPDATE invoices SET state='Cancelled',cancelled_at=p_now,updated_at=p_now WHERE id=inv.id;
      INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
      VALUES(uuid_generate_v7()::text,r.requested_by,'invoice.cancel',
        jsonb_build_object('entity','invoice','entityId',inv.id,'actor','system','actorType','system','profileId',r.profile_id,'affectedUserId',r.requested_by,'invoiceId',inv.id,'fromState',inv.state,'toState','Cancelled',
          'transition','cancel','reason','Electricity increase delivery period ended',
          'systemTriggered',true)::text,uuid_generate_v7()::text,p_now);
      disposition:='invoice_cancelled';
    ELSIF inv.state='Cancelled' AND inv.paid_amount=0 THEN
      disposition:='invoice_cancelled';
    ELSE
      disposition:='finance_review';
    END IF;
  END IF;
  UPDATE electricity_quantity_increase_requests SET status='expired',expired_at=p_now WHERE id=r.id;
  INSERT INTO audit_log(id,user_id,event,metadata,correlation_id,created_at)
  VALUES(uuid_generate_v7()::text,r.requested_by,'electricity.increase_expired',
    jsonb_build_object('entity','electricity_quantity_increase_request','entityId',r.id,'fromState',r.status,'toState','expired','reason','Electricity increase delivery period ended','actor','system','actorType','system','profileId',r.profile_id,'affectedUserId',r.requested_by,'requestId',r.id,'contractId',r.contract_id,'orderId',r.order_id,
      'invoiceId',r.adjustment_invoice_id,'disposition',disposition,
      'paidAmount',COALESCE(inv.paid_amount,0))::text,uuid_generate_v7()::text,p_now);
  SELECT user_id INTO recipient FROM profiles WHERE id=r.profile_id;
  INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,
    body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
  VALUES(uuid_generate_v7(),recipient,r.profile_id,'general',
    'notifications.legacy.title','notifications.legacy.body',
    jsonb_build_object('fa',jsonb_build_object('title','قرارداد',
      'body',CASE WHEN disposition='finance_review' THEN
        'درخواست افزایش برق منقضی شد. پرداخت یا رسید شما نیازمند بررسی مالی است.'
        ELSE 'درخواست افزایش برق با پایان دوره تحویل منقضی شد.' END),
      'en',jsonb_build_object('title','Contract',
      'body',CASE WHEN disposition='finance_review' THEN
        'Your electricity increase expired. Your payment or receipt needs finance review.'
        ELSE 'Your electricity increase expired when the delivery period ended.' END)),
    '/electricity/orders/'||r.order_id::text,false,p_now,
    'electricity-increase-expired:'||r.id::text);
  IF disposition='finance_review' THEN
    INSERT INTO in_app_notifications(id,recipient_user_id,profile_id,type,title_i18n_key,
      body_i18n_key,localized_content,link_route,is_read,created_at,delivery_key)
    SELECT uuid_generate_v7(),u.user_id,NULL,'general',
      'notifications.legacy.title','notifications.legacy.body',
      jsonb_build_object('fa',jsonb_build_object('title','بررسی مالی',
        'body','تعدیل افزایش برق منقضی‌شده نیازمند بررسی مالی است.'),
        'en',jsonb_build_object('title','Finance review',
        'body','An expired electricity increase adjustment needs finance review.')),
      '/admin/electricity-increases',false,p_now,
      'electricity-increase-expired-staff:'||r.id::text||':'||u.user_id
    FROM users u WHERE u.is_admin=true AND u.disabled_at IS NULL;
  END IF;
  RETURN disposition;
END $$;
