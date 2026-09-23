CREATE TABLE "electricity_price_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"original_invoice_id" uuid NOT NULL,
	"proposed_by" text NOT NULL,
	"finalized_by" text,
	"reason" text NOT NULL,
	"contractual_basis" text NOT NULL,
	"percentage_bps" bigint NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"adjustment_amount" bigint NOT NULL,
	"calculation" jsonb NOT NULL,
	"calculation_sha256" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"adjustment_invoice_id" uuid,
	"finalized_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_price_adjustments_reason" CHECK (length(trim("electricity_price_adjustments"."reason")) BETWEEN 1 AND 1000),
	CONSTRAINT "electricity_price_adjustments_basis" CHECK (length(trim("electricity_price_adjustments"."contractual_basis")) BETWEEN 1 AND 2000),
	CONSTRAINT "electricity_price_adjustments_percentage" CHECK ("electricity_price_adjustments"."percentage_bps"<>0 AND "electricity_price_adjustments"."percentage_bps">-10000),
	CONSTRAINT "electricity_price_adjustments_period" CHECK ("electricity_price_adjustments"."effective_from"<"electricity_price_adjustments"."period_end"),
	CONSTRAINT "electricity_price_adjustments_amount" CHECK ("electricity_price_adjustments"."adjustment_amount"<>0),
	CONSTRAINT "electricity_price_adjustments_sha" CHECK ("electricity_price_adjustments"."calculation_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "electricity_price_adjustments_state" CHECK ((
      ("electricity_price_adjustments"."status"='proposed' AND "electricity_price_adjustments"."adjustment_invoice_id" IS NULL AND "electricity_price_adjustments"."finalized_by" IS NULL AND "electricity_price_adjustments"."finalized_at" IS NULL AND "electricity_price_adjustments"."cancelled_at" IS NULL)
      OR ("electricity_price_adjustments"."status"='finalized' AND "electricity_price_adjustments"."adjustment_invoice_id" IS NOT NULL AND "electricity_price_adjustments"."finalized_by" IS NOT NULL AND "electricity_price_adjustments"."finalized_at" IS NOT NULL AND "electricity_price_adjustments"."cancelled_at" IS NULL)
      OR ("electricity_price_adjustments"."status"='cancelled' AND "electricity_price_adjustments"."adjustment_invoice_id" IS NULL AND "electricity_price_adjustments"."finalized_by" IS NULL AND "electricity_price_adjustments"."finalized_at" IS NULL AND "electricity_price_adjustments"."cancelled_at" IS NOT NULL)
    ))
);
--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_order_id_electricity_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."electricity_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_original_invoice_id_invoices_id_fk" FOREIGN KEY ("original_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_proposed_by_users_user_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_finalized_by_users_user_id_fk" FOREIGN KEY ("finalized_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_adjustment_invoice_id_invoices_id_fk" FOREIGN KEY ("adjustment_invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_price_adjustments" ADD CONSTRAINT "electricity_price_adjustments_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_price_adjustments_proposed_contract_key" ON "electricity_price_adjustments" USING btree ("contract_id") WHERE "electricity_price_adjustments"."status"='proposed';--> statement-breakpoint
CREATE UNIQUE INDEX "electricity_price_adjustments_invoice_key" ON "electricity_price_adjustments" USING btree ("adjustment_invoice_id");--> statement-breakpoint
CREATE INDEX "electricity_price_adjustments_contract_idx" ON "electricity_price_adjustments" USING btree ("contract_id","created_at");
--> statement-breakpoint
CREATE FUNCTION guard_electricity_price_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE linked invoices%ROWTYPE;
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'proposed' THEN
      RAISE EXCEPTION 'Price adjustment must first be published as a proposal' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Electricity price adjustment history cannot be deleted' USING ERRCODE='23514';
  END IF;
  IF OLD.status<>'proposed' OR NEW.status NOT IN ('finalized','cancelled') OR
     NEW.id IS DISTINCT FROM OLD.id OR
     NEW.contract_id IS DISTINCT FROM OLD.contract_id OR
     NEW.version_id IS DISTINCT FROM OLD.version_id OR
     NEW.order_id IS DISTINCT FROM OLD.order_id OR
     NEW.profile_id IS DISTINCT FROM OLD.profile_id OR
     NEW.original_invoice_id IS DISTINCT FROM OLD.original_invoice_id OR
     NEW.proposed_by IS DISTINCT FROM OLD.proposed_by OR
     NEW.reason IS DISTINCT FROM OLD.reason OR
     NEW.contractual_basis IS DISTINCT FROM OLD.contractual_basis OR
     NEW.percentage_bps IS DISTINCT FROM OLD.percentage_bps OR
     NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
     NEW.period_end IS DISTINCT FROM OLD.period_end OR
     NEW.adjustment_amount IS DISTINCT FROM OLD.adjustment_amount OR
     NEW.calculation IS DISTINCT FROM OLD.calculation OR
     NEW.calculation_sha256 IS DISTINCT FROM OLD.calculation_sha256 OR
     NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Electricity price proposal terms and final state are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status='finalized' THEN
    SELECT * INTO linked FROM invoices WHERE id=NEW.adjustment_invoice_id;
    IF NOT FOUND OR linked.adjustment_for_invoice_id<>NEW.original_invoice_id OR
       linked.contract_id<>NEW.contract_id::text OR linked.order_id<>NEW.order_id OR
       linked.profile_id<>NEW.profile_id OR linked.state<>'Unpaid' OR
       linked.total_amount<>abs(NEW.adjustment_amount) OR
       NOT ((NEW.adjustment_amount>0 AND linked.adjustment_kind='charge') OR
            (NEW.adjustment_amount<0 AND linked.adjustment_kind='credit')) THEN
      RAISE EXCEPTION 'Price adjustment invoice does not match the disclosed proposal' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER electricity_price_adjustment_guard
 BEFORE INSERT OR UPDATE OR DELETE ON electricity_price_adjustments
 FOR EACH ROW EXECUTE FUNCTION guard_electricity_price_adjustment();
