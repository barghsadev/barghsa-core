ALTER TABLE tickets ADD COLUMN privacy_export_job_id uuid;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN privacy_export_storage_key text;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN privacy_export_expires_at timestamptz;
--> statement-breakpoint
ALTER TABLE tickets ADD COLUMN privacy_export_downloaded_at timestamptz;
--> statement-breakpoint
ALTER TABLE tickets ADD CONSTRAINT tickets_privacy_export_job_id_async_jobs_id_fk
  FOREIGN KEY (privacy_export_job_id) REFERENCES async_jobs(id);
--> statement-breakpoint
ALTER TABLE tickets ADD CONSTRAINT tickets_privacy_export_valid CHECK (
  (privacy_export_job_id IS NULL AND privacy_export_storage_key IS NULL AND privacy_export_expires_at IS NULL)
  OR (privacy_request_type='export' AND privacy_export_job_id IS NOT NULL
    AND (privacy_export_storage_key IS NULL OR privacy_export_expires_at IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX tickets_privacy_export_job_unique ON tickets(privacy_export_job_id)
  WHERE privacy_export_job_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX tickets_privacy_export_expiry ON tickets(privacy_export_expires_at)
  WHERE privacy_export_storage_key IS NOT NULL;
