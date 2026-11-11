ALTER TABLE "storage_records" ADD COLUMN "cleanup_operation" text;--> statement-breakpoint
ALTER TABLE "storage_records" ADD CONSTRAINT "storage_records_cleanup_operation_check" CHECK ("storage_records"."cleanup_operation" IS NULL OR
        ("storage_records"."cleanup_operation" IN ('delete','expire') AND "storage_records"."status"='removed' AND "storage_records"."signed_at" IS NULL));
