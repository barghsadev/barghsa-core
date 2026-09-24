CREATE TABLE "document_template_files" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"template_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"change_summary" text DEFAULT '' NOT NULL,
	"placeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"created_by" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_template_files" ADD CONSTRAINT "document_template_files_version_id_document_template_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."document_template_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_template_versions" ADD CONSTRAINT "document_template_versions_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_document_template_file_name" ON "document_template_files" USING btree ("version_id","original_name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_document_template_file_storage" ON "document_template_files" USING btree ("version_id","storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_document_template_version" ON "document_template_versions" USING btree ("template_id","version_number");--> statement-breakpoint
CREATE INDEX "idx_document_templates_category" ON "document_templates" USING btree ("category");
--> statement-breakpoint
ALTER TABLE document_templates ADD CONSTRAINT chk_document_templates_details
  CHECK (length(btrim(title)) BETWEEN 1 AND 200 AND length(description) <= 2000
    AND category IN ('general','contract','invoice'));
--> statement-breakpoint
ALTER TABLE document_template_versions ADD CONSTRAINT chk_document_template_versions_content
  CHECK (version_number > 0 AND length(change_summary) <= 500
    AND jsonb_typeof(placeholders) = 'array');
--> statement-breakpoint
ALTER TABLE document_template_files ADD CONSTRAINT chk_document_template_files_content
  CHECK (length(btrim(original_name)) BETWEEN 1 AND 255
    AND mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    AND size_bytes BETWEEN 1 AND 10485760 AND checksum ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(placeholders) = 'array');
--> statement-breakpoint
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON document_templates
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
--> statement-breakpoint
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON document_template_versions
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
--> statement-breakpoint
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON document_template_files
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();
