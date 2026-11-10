CREATE INDEX "storage_records_upload_profile_idx" ON "storage_records" USING btree (lower(COALESCE(
  metadata->'uploadContext'->>'profileId',
  metadata->>'profileId',
  metadata->'scanContext'->>'profileId'
)));--> statement-breakpoint
CREATE INDEX "storage_records_unscoped_uploader_idx" ON "storage_records" USING btree (("metadata"->>'uploadedBy')) WHERE lower(COALESCE(
  metadata->'uploadContext'->>'profileId',
  metadata->>'profileId',
  metadata->'scanContext'->>'profileId'
)) IS NULL;