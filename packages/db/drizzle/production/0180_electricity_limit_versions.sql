-- Repair the timestamp invariant for the saving draft table introduced in 0179.
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.saving_customer_drafts
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();--> statement-breakpoint
CREATE TABLE "electricity_product_limit_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"product_id" uuid NOT NULL,
	"min_kwh" bigint NOT NULL,
	"max_kwh" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_limit_versions_range" CHECK ("electricity_product_limit_versions"."effective_until" IS NULL OR "electricity_product_limit_versions"."effective_until" > "electricity_product_limit_versions"."effective_from"),
	CONSTRAINT "electricity_limit_versions_values" CHECK ("electricity_product_limit_versions"."min_kwh" >= 0 AND ("electricity_product_limit_versions"."max_kwh" = 0 OR "electricity_product_limit_versions"."max_kwh" >= "electricity_product_limit_versions"."min_kwh"))
);
--> statement-breakpoint
ALTER TABLE "electricity_product_limit_versions" ADD CONSTRAINT "electricity_product_limit_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_limit_versions_open_key" ON "electricity_product_limit_versions" USING btree ("product_id") WHERE "electricity_product_limit_versions"."effective_until" IS NULL;--> statement-breakpoint
ALTER TABLE electricity_product_limit_versions
  ADD CONSTRAINT electricity_limit_versions_no_overlap
  EXCLUDE USING gist (product_id WITH =, tstzrange(effective_from, effective_until, '[)') WITH &&);--> statement-breakpoint
-- The pre-migration limits are a known baseline; earlier effective values cannot be reconstructed.
INSERT INTO electricity_product_limit_versions(product_id,min_kwh,max_kwh,effective_from)
SELECT product_id,min_kwh,max_kwh,NOW() FROM electricity_product_limits;--> statement-breakpoint
CREATE FUNCTION record_electricity_limit_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_at timestamptz := clock_timestamp();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.min_kwh = OLD.min_kwh AND NEW.max_kwh = OLD.max_kwh THEN
    RETURN NEW;
  END IF;
  UPDATE electricity_product_limit_versions
     SET effective_until = changed_at
   WHERE product_id = NEW.product_id AND effective_until IS NULL;
  INSERT INTO electricity_product_limit_versions(product_id,min_kwh,max_kwh,effective_from)
  VALUES(NEW.product_id,NEW.min_kwh,NEW.max_kwh,changed_at);
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER electricity_limit_version_write
  AFTER INSERT OR UPDATE ON electricity_product_limits
  FOR EACH ROW EXECUTE FUNCTION record_electricity_limit_version();
