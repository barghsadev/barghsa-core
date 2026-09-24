CREATE TABLE "upload_cleanup_log" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"storage_key" text NOT NULL,
	"provider_upload_id" text NOT NULL,
	"initiated_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"error_code" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_cleanup_status" CHECK ("upload_cleanup_log"."status" IN ('aborted','failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "upload_cleanup_upload_unique" ON "upload_cleanup_log" USING btree ("storage_key","provider_upload_id");--> statement-breakpoint
CREATE INDEX "upload_cleanup_recorded_idx" ON "upload_cleanup_log" USING btree ("recorded_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_records_multipart_id_unique" ON "storage_records"
  ((metadata->'multipart'->>'id')) WHERE metadata->'multipart'->>'id' IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON public.document_destruction_items
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
