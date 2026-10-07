-- Fresh native receipts use the active in-app catalogue in their business transaction.
-- No backfill, existing-function replacement, domain lock or historical UPDATE.
CREATE FUNCTION render_native_inbox_text(template_text text, variables jsonb, data jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET extra_float_digits=3 AS $$
DECLARE
 item jsonb;
 name text;
 names text[]:='{}';
 segments text[];
 segment text;
 match text[];
 resolved jsonb;
 scalar text;
 numeric_value double precision;
 output text:='';
 cursor_position integer:=1;
 match_position integer;
 trim_chars text:=E' \t\n\f\r'||chr(11)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279);
BEGIN
 IF template_text IS NULL OR jsonb_typeof(variables) IS DISTINCT FROM 'array' OR jsonb_typeof(data) IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION 'Invalid native inbox template' USING ERRCODE='23514';
 END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(variables) LOOP
  name:=CASE WHEN jsonb_typeof(item)='string' THEN item#>>'{}'
             WHEN jsonb_typeof(item)='object' AND jsonb_typeof(item->'name')='string' THEN item->>'name' ELSE '' END;
  name:=btrim(name,trim_chars);
  IF name='' THEN RAISE EXCEPTION 'Invalid native inbox template variables' USING ERRCODE='23514'; END IF;
  names:=array_append(names,name);
 END LOOP;
 -- Scan the original template, never interpolated values: replacement is one pass.
 FOR match IN SELECT regexp_matches(template_text,'(\{\{([^{}]*)\}\})','g') LOOP
  name:=btrim(match[2],trim_chars);
  segments:=string_to_array(name,'.');
  IF name !~ '^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$' OR NOT name=ANY(names)
     OR segments && ARRAY['__proto__','prototype','constructor','hasOwnProperty'] THEN
   RAISE EXCEPTION 'Native inbox template data incomplete' USING ERRCODE='23514';
  END IF;
  resolved:=data;
  FOREACH segment IN ARRAY segments LOOP
   IF jsonb_typeof(resolved)='object' THEN resolved:=resolved->segment;
   ELSIF jsonb_typeof(resolved)='array' AND segment ~ '^(0|[1-9][0-9]*)$' AND length(segment)<=10 AND segment::numeric<2147483648 THEN
    resolved:=resolved->segment::integer;
   ELSE resolved:=NULL; EXIT;
   END IF;
  END LOOP;
  IF resolved IS NULL OR jsonb_typeof(resolved) NOT IN ('string','number','boolean') THEN
   RAISE EXCEPTION 'Native inbox template data incomplete' USING ERRCODE='23514';
  END IF;
  scalar:=resolved#>>'{}';
  IF jsonb_typeof(resolved)='number' THEN
   -- Match the existing JS scalar presentation. Monetary payloads are exact strings.
   numeric_value:=scalar::double precision;
   IF numeric_value=0 THEN scalar:='0';
   ELSIF abs(numeric_value)>=0.000001 AND abs(numeric_value)<1e21 THEN scalar:=(numeric_value::text)::numeric::text;
   ELSE scalar:=regexp_replace(numeric_value::text,'e([+-])0+([0-9]+)$',E'e\\1\\2'); END IF;
  END IF;
  match_position:=strpos(substring(template_text FROM cursor_position),match[1]);
  output:=output||substring(template_text FROM cursor_position FOR match_position-1)||scalar;
  cursor_position:=cursor_position+match_position-1+char_length(match[1]);
 END LOOP;
 RETURN output||substring(template_text FROM cursor_position);
END $$;
--> statement-breakpoint
CREATE FUNCTION render_native_inbox_content(outcome_event text, data jsonb, fallback jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
 template record;
 content jsonb:=fallback;
 initialized boolean:=false;
 locale_name text;
BEGIN
 FOR template IN SELECT locale,subject,body_template,variables FROM notification_templates
  WHERE event_key=outcome_event AND channel='in_app' AND status='active' AND is_active=true ORDER BY locale LOOP
  IF template.locale NOT IN ('fa','en') THEN RAISE EXCEPTION 'Invalid native inbox template locale' USING ERRCODE='23514'; END IF;
  IF NOT initialized THEN
   content:=COALESCE(content,'{}'::jsonb);
   IF jsonb_typeof(content)<>'object' THEN RAISE EXCEPTION 'Invalid native inbox fallback' USING ERRCODE='23514'; END IF;
   FOREACH locale_name IN ARRAY ARRAY['fa','en'] LOOP
    IF content->locale_name IS NULL AND jsonb_typeof(content->'original')='object' THEN
     content:=jsonb_set(content,ARRAY[locale_name],content->'original',true);
    END IF;
   END LOOP;
   content:=content-'original';
   initialized:=true;
  END IF;
  content:=jsonb_set(content,ARRAY[template.locale],jsonb_build_object(
   'title',render_native_inbox_text(COALESCE(template.subject,content->template.locale->>'title',''),template.variables,data),
   'body',render_native_inbox_text(template.body_template,template.variables,data)),true);
 END LOOP;
 RETURN content;
END $$;
--> statement-breakpoint
CREATE FUNCTION apply_native_inbox_templates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
 outcome_event text:=NEW.type;
 data jsonb;
BEGIN
 -- BEFORE INSERT also fires for ON CONFLICT; a retained receipt never re-renders.
 IF EXISTS(SELECT 1 FROM in_app_notifications WHERE delivery_key=NEW.delivery_key) THEN RETURN NEW; END IF;
 IF NEW.delivery_key ~ '^refund:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:Completed$'
    AND NEW.type='general' AND NEW.operating_context='customer' THEN outcome_event:='payment.refund_completed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM notification_templates WHERE event_key=outcome_event AND channel='in_app' AND status='active' AND is_active=true) THEN RETURN NEW; END IF;
 IF NEW.delivery_key LIKE 'outbox:%' THEN
  SELECT o.payload INTO data FROM notification_outbox o LEFT JOIN profiles p ON p.id=o.profile_id
   WHERE o.id::text=substring(NEW.delivery_key FROM 8) AND o.event_key=NEW.type
    AND o.profile_id IS NOT DISTINCT FROM NEW.profile_id AND 'in_app'=ANY(o.channels)
    AND (o.user_id IS NOT NULL AND o.user_id=NEW.recipient_user_id
     OR o.user_id IS NULL AND o.profile_id IS NOT NULL AND (NEW.recipient_user_id IS NULL OR p.user_id=NEW.recipient_user_id));
 ELSIF outcome_event='payment.refund_completed' THEN
  SELECT jsonb_build_object('refundId',r.id::text,'invoiceId',r.invoice_id::text,'amount',r.amount::text,'destination',r.destination)
   INTO data FROM refunds r JOIN invoices i ON i.id=r.invoice_id JOIN profiles p ON p.id=i.profile_id
   WHERE r.id=split_part(NEW.delivery_key,':',2)::uuid AND r.state='Completed'
    AND i.profile_id=NEW.profile_id AND p.user_id=NEW.recipient_user_id;
 ELSIF outcome_event='auth.refresh_token_reused' AND NEW.delivery_key LIKE 'session-reuse:%' AND length(NEW.delivery_key)>14
    AND NEW.profile_id IS NULL AND NEW.operating_context='account' AND NEW.recipient_user_id IS NOT NULL THEN
  IF EXISTS(SELECT 1 FROM sessions WHERE family_id=substring(NEW.delivery_key FROM 15)
   AND user_id=NEW.recipient_user_id AND revoked_at IS NOT NULL) THEN data:='{}'::jsonb; END IF;
 ELSE RETURN NEW;
 END IF;
 IF data IS NULL OR jsonb_typeof(data)<>'object' THEN RAISE EXCEPTION 'Native inbox requires its saved private payload' USING ERRCODE='23514'; END IF;
 NEW.localized_content:=render_native_inbox_content(outcome_event,data,NEW.localized_content);
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER native_inbox_active_templates BEFORE INSERT ON in_app_notifications
FOR EACH ROW EXECUTE FUNCTION apply_native_inbox_templates();
