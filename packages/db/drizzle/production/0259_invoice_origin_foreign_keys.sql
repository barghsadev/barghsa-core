-- Expand compatible parent keys, then migrate/validate references without changing invoice history.
ALTER TABLE "consultation_requests" ADD COLUMN "invoice_reference" text GENERATED ALWAYS AS (id::text) STORED;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "invoice_reference" text GENERATED ALWAYS AS (id::text) STORED;--> statement-breakpoint
ALTER TABLE "consultation_requests" ADD CONSTRAINT "consultation_requests_invoice_reference_key" UNIQUE("invoice_reference");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_invoice_reference_key" UNIQUE("invoice_reference");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_id_contracts_invoice_reference_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("invoice_reference") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_consultation_id_consultation_requests_invoice_reference_fk" FOREIGN KEY ("consultation_id") REFERENCES "public"."consultation_requests"("invoice_reference") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_contract_id_contracts_invoice_reference_fk";--> statement-breakpoint
ALTER TABLE "invoices" VALIDATE CONSTRAINT "invoices_consultation_id_consultation_requests_invoice_reference_fk";
