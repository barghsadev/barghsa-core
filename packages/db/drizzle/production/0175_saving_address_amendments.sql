CREATE TABLE "saving_address_amendments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"contract_version_id" uuid NOT NULL,
	"actor_user_id" text NOT NULL,
	"previous_address_id" uuid NOT NULL,
	"address_id" uuid NOT NULL,
	"previous_snapshot" jsonb NOT NULL,
	"address_snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saving_address_amendments_distinct" CHECK ("saving_address_amendments"."previous_address_id"<>"saving_address_amendments"."address_id"),
	CONSTRAINT "saving_address_amendments_snapshots" CHECK (jsonb_typeof("saving_address_amendments"."previous_snapshot")='object' AND jsonb_typeof("saving_address_amendments"."address_snapshot")='object'),
	CONSTRAINT "saving_address_amendments_reason" CHECK (length(trim("saving_address_amendments"."reason")) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD CONSTRAINT "saving_address_amendments_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD CONSTRAINT "saving_address_amendments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD CONSTRAINT "saving_address_amendments_contract_version_id_contract_versions_id_fk" FOREIGN KEY ("contract_version_id") REFERENCES "public"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD CONSTRAINT "saving_address_amendments_actor_user_id_users_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD CONSTRAINT "saving_address_amendments_previous_address_id_addresses_id_fk" FOREIGN KEY ("previous_address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_address_amendments" ADD CONSTRAINT "saving_address_amendments_address_id_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."addresses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saving_address_amendments_order_idx" ON "saving_address_amendments" USING btree ("order_id","created_at","id");
--> statement-breakpoint
CREATE FUNCTION guard_saving_address_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saving address amendment history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER saving_address_amendment_guard BEFORE UPDATE OR DELETE ON saving_address_amendments
FOR EACH ROW EXECUTE FUNCTION guard_saving_address_amendment();
