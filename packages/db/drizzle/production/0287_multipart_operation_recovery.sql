ALTER TABLE "upload_cleanup_log" DROP CONSTRAINT "upload_cleanup_status";--> statement-breakpoint
CREATE INDEX "storage_records_multipart_pending_idx" ON "storage_records" USING btree ("updated_at","storage_key") WHERE "storage_records"."status"='removed' AND "storage_records"."signed_at" IS NULL
        AND "storage_records"."metadata"->'multipart'->>'status' IN ('completing','aborting');--> statement-breakpoint
CREATE INDEX "upload_cleanup_retry_idx" ON "upload_cleanup_log" USING btree ("status","recorded_at");--> statement-breakpoint
ALTER TABLE "upload_cleanup_log" ADD CONSTRAINT "upload_cleanup_status" CHECK ("upload_cleanup_log"."status" IN ('pending','aborted','failed'));