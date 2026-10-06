-- Expand-only constraints. Preserve data and stop for explicit legacy reconciliation.
-- Application rollback keeps valid catalogue references and nonnegative prices.
ALTER TABLE "product_price_versions" ADD CONSTRAINT "product_price_versions_vat_category_override_vat_configurations_id_fk" FOREIGN KEY ("vat_category_override") REFERENCES "public"."vat_configurations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_price_nonnegative" CHECK ((price IS NULL OR price >= 0));
--> statement-breakpoint
LOCK TABLE products,product_categories,electricity_product_limits IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM product_categories c JOIN products p ON p.id=c.product_id
    WHERE p.type::text<>CASE WHEN c.category::text IN ('electricity_generation_station_consultation','electricity_saving_certificate_consultation') THEN 'consultation' ELSE 'electricity' END)
    OR EXISTS(SELECT 1 FROM electricity_product_limits l JOIN products p ON p.id=l.product_id WHERE p.type<>'electricity') THEN
    RAISE EXCEPTION 'Catalogue relationships require explicit legacy reconciliation' USING ERRCODE='23514';
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_catalogue_relation_type() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_type text;
BEGIN
  SELECT type::text INTO parent_type FROM products WHERE id=NEW.product_id FOR SHARE;
  IF parent_type IS NULL THEN RETURN NEW; END IF; -- Existing FK supplies missing-parent rejection.
  IF TG_TABLE_NAME='product_categories' THEN
    IF parent_type<>(CASE WHEN NEW.category::text IN ('electricity_generation_station_consultation','electricity_saving_certificate_consultation') THEN 'consultation' ELSE 'electricity' END) THEN
      RAISE EXCEPTION 'Category does not match its catalogue product type' USING ERRCODE='23514';
    END IF;
  ELSIF parent_type<>'electricity' THEN
    RAISE EXCEPTION 'Electricity limits require an electricity product' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER catalogue_category_type BEFORE INSERT OR UPDATE OF product_id,category ON product_categories
 FOR EACH ROW EXECUTE FUNCTION guard_catalogue_relation_type();
--> statement-breakpoint
CREATE TRIGGER catalogue_limit_type BEFORE INSERT OR UPDATE OF product_id ON electricity_product_limits
 FOR EACH ROW EXECUTE FUNCTION guard_catalogue_relation_type();
--> statement-breakpoint
CREATE FUNCTION preserve_catalogue_relation_type() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type AND
    (EXISTS(SELECT 1 FROM product_categories c WHERE c.product_id=OLD.id
      AND NEW.type::text<>CASE WHEN c.category::text IN ('electricity_generation_station_consultation','electricity_saving_certificate_consultation') THEN 'consultation' ELSE 'electricity' END)
     OR (NEW.type<>'electricity' AND EXISTS(SELECT 1 FROM electricity_product_limits WHERE product_id=OLD.id))) THEN
    RAISE EXCEPTION 'Product type is retained by catalogue relationships' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Keep established system identity guards and their rejection codes first.
CREATE TRIGGER trg_validate_catalogue_parent_type BEFORE UPDATE OF type ON products
 FOR EACH ROW EXECUTE FUNCTION preserve_catalogue_relation_type();
