CREATE TABLE "saving_plan_agreement_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" timestamp with time zone,
	"created_by" text NOT NULL,
	CONSTRAINT "saving_plan_agreement_status" CHECK ("saving_plan_agreement_versions"."status" IN ('draft','active','superseded')),
	CONSTRAINT "saving_plan_agreement_text" CHECK (length(trim("saving_plan_agreement_versions"."title")) > 0 AND length(trim("saving_plan_agreement_versions"."body")) > 0),
	CONSTRAINT "saving_plan_agreement_effective" CHECK ("saving_plan_agreement_versions"."status" = 'draft' OR "saving_plan_agreement_versions"."effective_from" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "saving_plan_hardware" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"plan_id" uuid NOT NULL,
	"hardware_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saving_plan_agreement_versions" ADD CONSTRAINT "saving_plan_agreement_versions_plan_id_products_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_plan_agreement_versions" ADD CONSTRAINT "saving_plan_agreement_versions_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_plan_hardware" ADD CONSTRAINT "saving_plan_hardware_plan_id_products_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_plan_hardware" ADD CONSTRAINT "saving_plan_hardware_hardware_id_products_id_fk" FOREIGN KEY ("hardware_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "saving_plan_agreement_active_key" ON "saving_plan_agreement_versions" USING btree ("plan_id") WHERE "saving_plan_agreement_versions"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "saving_plan_agreement_draft_key" ON "saving_plan_agreement_versions" USING btree ("plan_id") WHERE "saving_plan_agreement_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "saving_plan_hardware_pair_key" ON "saving_plan_hardware" USING btree ("plan_id","hardware_id");
--> statement-breakpoint
CREATE FUNCTION guard_saving_plan_hardware() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.plan_id AND type='saving_plan') OR
     NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.hardware_id AND type='hardware') THEN
    RAISE EXCEPTION 'Saving plan associations require a plan and hardware product' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_plan_hardware_guard BEFORE INSERT OR UPDATE ON saving_plan_hardware
 FOR EACH ROW EXECUTE FUNCTION guard_saving_plan_hardware();
--> statement-breakpoint
CREATE FUNCTION guard_saving_plan_agreement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.status<>'draft' THEN
      RAISE EXCEPTION 'Published saving plan agreements are immutable' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM products WHERE id=NEW.plan_id AND type='saving_plan') THEN
    RAISE EXCEPTION 'Agreement requires a saving plan' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'draft' THEN
      RAISE EXCEPTION 'Agreement must begin as a draft' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.plan_id IS DISTINCT FROM OLD.plan_id OR
     NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR
     NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at OR
     NOT ((OLD.status='draft' AND NEW.status='active' AND NEW.effective_from IS NOT NULL) OR
          (OLD.status='active' AND NEW.status='superseded' AND NEW.effective_from=OLD.effective_from)) THEN
    RAISE EXCEPTION 'Saving plan agreement text and published history are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_plan_agreement_guard BEFORE INSERT OR UPDATE OR DELETE ON saving_plan_agreement_versions
 FOR EACH ROW EXECUTE FUNCTION guard_saving_plan_agreement();
--> statement-breakpoint
CREATE FUNCTION prevent_linked_saving_product_retype() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IS DISTINCT FROM OLD.type AND (
    EXISTS(SELECT 1 FROM saving_plan_hardware WHERE plan_id=OLD.id OR hardware_id=OLD.id) OR
    EXISTS(SELECT 1 FROM saving_plan_agreement_versions WHERE plan_id=OLD.id)
  ) THEN
    RAISE EXCEPTION 'Linked saving catalogue product type is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER linked_saving_product_type_guard BEFORE UPDATE OF type ON products
 FOR EACH ROW EXECUTE FUNCTION prevent_linked_saving_product_retype();
