ALTER TABLE "solar_construction_postal" ADD COLUMN "estimated_arrival_date" date;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD COLUMN "tracking_url" text;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD COLUMN "tracking_note" text;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD COLUMN "tracking_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD COLUMN "tracking_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_postal_tracking_revision" CHECK ("solar_construction_postal"."tracking_revision">=0);--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_postal_tracking_note" CHECK ("solar_construction_postal"."tracking_note" IS NULL OR (char_length(btrim("solar_construction_postal"."tracking_note")) BETWEEN 1 AND 1000 AND "solar_construction_postal"."tracking_note"=btrim("solar_construction_postal"."tracking_note")));--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_postal_tracking_url" CHECK ("solar_construction_postal"."tracking_url" IS NULL OR (char_length("solar_construction_postal"."tracking_url")<=2000 AND "solar_construction_postal"."tracking_url" ~ '^https://' AND "solar_construction_postal"."tracking_url" !~ '[[:space:]]'));--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_postal_arrival_estimate" CHECK ("solar_construction_postal"."estimated_arrival_date" IS NULL OR ("solar_construction_postal"."status"='shipped' AND "solar_construction_postal"."send_date" IS NOT NULL AND "solar_construction_postal"."estimated_arrival_date">=("solar_construction_postal"."send_date" AT TIME ZONE 'UTC')::date AND "solar_construction_postal"."tracking_note" IS NOT NULL AND "solar_construction_postal"."tracking_recorded_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "solar_construction_postal" ADD CONSTRAINT "solar_postal_tracking_record" CHECK (("solar_construction_postal"."tracking_note" IS NULL) = ("solar_construction_postal"."tracking_recorded_at" IS NULL));
--> statement-breakpoint
CREATE FUNCTION guard_solar_postal_tracking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.estimated_arrival_date IS NOT NULL OR NEW.tracking_url IS NOT NULL OR
       NEW.tracking_note IS NOT NULL OR NEW.tracking_recorded_at IS NOT NULL OR NEW.tracking_revision<>0 THEN
      RAISE EXCEPTION 'Postal tracking must be recorded after shipment' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id<>OLD.id OR NEW.request_id<>OLD.request_id THEN
    RAISE EXCEPTION 'Postal ownership is immutable' USING ERRCODE='23514';
  END IF;
  IF ROW(NEW.courier,NEW.tracking_number,NEW.send_date,NEW.receipt_image_id)
     IS DISTINCT FROM ROW(OLD.courier,OLD.tracking_number,OLD.send_date,OLD.receipt_image_id) OR
     (NEW.status='shipped' AND OLD.status<>'shipped') THEN
    NEW.estimated_arrival_date:=NULL;
    NEW.tracking_url:=NULL;
    NEW.tracking_note:=NULL;
    NEW.tracking_recorded_at:=NULL;
    NEW.tracking_revision:=OLD.tracking_revision+1;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.estimated_arrival_date:=NULL;
    NEW.tracking_note:=NULL;
    NEW.tracking_recorded_at:=NULL;
    NEW.tracking_revision:=OLD.tracking_revision+1;
  ELSIF ROW(NEW.estimated_arrival_date,NEW.tracking_url,NEW.tracking_note)
        IS DISTINCT FROM ROW(OLD.estimated_arrival_date,OLD.tracking_url,OLD.tracking_note) THEN
    IF current_setting('barghsa.solar_postal_tracking',true) IS DISTINCT FROM NEW.request_id::text OR
       NEW.status<>'shipped' THEN
      RAISE EXCEPTION 'Reviewed shipment tracking context required' USING ERRCODE='23514';
    END IF;
    PERFORM 1 FROM solar_construction_requests r JOIN profiles p ON p.id=r.profile_id
      WHERE r.id=NEW.request_id AND r.status='waiting_for_postal_submission'
        AND NOT p.archived AND p.status NOT IN ('DRAFT','SUSPENDED') FOR SHARE OF r,p NOWAIT;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Postal arrival estimate is unavailable' USING ERRCODE='23514';
    END IF;
    NEW.tracking_revision:=OLD.tracking_revision+1;
    NEW.tracking_recorded_at:=clock_timestamp();
  ELSIF NEW.tracking_revision<>OLD.tracking_revision OR
        NEW.tracking_recorded_at IS DISTINCT FROM OLD.tracking_recorded_at THEN
    RAISE EXCEPTION 'Postal tracking revision and time are server-owned' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER solar_postal_tracking_guard BEFORE INSERT OR UPDATE ON solar_construction_postal
FOR EACH ROW EXECUTE FUNCTION guard_solar_postal_tracking();
