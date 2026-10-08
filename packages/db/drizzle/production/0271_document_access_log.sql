-- Expand only. Historical URL issuances cannot be reconstructed and are not backfilled.
-- Application rollback leaves this ledger and its protection in place.
CREATE TABLE "document_access_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"document_id" uuid NOT NULL,
	"accessed_by" text NOT NULL,
	"accessed_by_type" text NOT NULL,
	"action" text NOT NULL,
	"ip_address" text NOT NULL,
	"user_agent" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_access_log_actor_type" CHECK ("document_access_log"."accessed_by_type" IN ('customer','staff')),
	CONSTRAINT "document_access_log_action" CHECK ("document_access_log"."action" IN ('download','view')),
	CONSTRAINT "document_access_log_request_bounds" CHECK (length("document_access_log"."ip_address") <= 64 AND length("document_access_log"."user_agent") <= 1024)
);
--> statement-breakpoint
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_accessed_by_users_user_id_fk" FOREIGN KEY ("accessed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_access_log_document_created_idx" ON "document_access_log" USING btree ("document_id","created_at");--> statement-breakpoint
CREATE INDEX "document_access_log_actor_created_idx" ON "document_access_log" USING btree ("accessed_by","created_at");
--> statement-breakpoint
CREATE TRIGGER document_access_log_immutable_row BEFORE UPDATE OR DELETE ON document_access_log
  FOR EACH ROW EXECUTE FUNCTION retain_document_evidence();
--> statement-breakpoint
CREATE TRIGGER document_access_log_immutable_truncate BEFORE TRUNCATE ON document_access_log
  FOR EACH STATEMENT EXECUTE FUNCTION retain_document_evidence();
