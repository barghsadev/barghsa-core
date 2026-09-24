CREATE TABLE "document_scan_jobs" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"verdict" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_scan_jobs_attempts" CHECK ("document_scan_jobs"."attempts" >= 0),
	CONSTRAINT "document_scan_jobs_verdict" CHECK (("document_scan_jobs"."verdict" IS NULL AND "document_scan_jobs"."completed_at" IS NULL) OR ("document_scan_jobs"."verdict" IN ('clean','infected') AND "document_scan_jobs"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "document_scan_jobs" ADD CONSTRAINT "document_scan_jobs_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_scan_jobs_due_idx" ON "document_scan_jobs" USING btree ("completed_at","next_attempt_at");
--> statement-breakpoint
CREATE TRIGGER modify_updated_at BEFORE UPDATE ON document_scan_jobs
  FOR EACH ROW EXECUTE FUNCTION public.modify_updated_at();

--> statement-breakpoint
-- Allow the owned, immutable upload copy to be sealed while the scanner job is pending.
CREATE OR REPLACE FUNCTION guard_document_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE predecessor documents%ROWTYPE; target_profile uuid;
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Document records are retained for audit' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'Uploading' OR NEW.scan_state<>'Uploading' OR NEW.revision<>1
       OR NEW.storage_key IS NOT NULL OR NEW.checksum IS NOT NULL OR NEW.detected_mime IS NOT NULL THEN
      RAISE EXCEPTION 'Documents begin as owned upload reservations' USING ERRCODE='23514';
    END IF;
    IF NEW.business_record_type='contract' THEN
      SELECT profile_id INTO target_profile FROM contracts WHERE id=NEW.business_record_id;
    ELSIF NEW.business_record_type='invoice' THEN
      SELECT profile_id INTO target_profile FROM invoices WHERE id=NEW.business_record_id;
    ELSIF NEW.business_record_type='order' THEN
      SELECT profile_id INTO target_profile FROM orders WHERE id=NEW.business_record_id;
    ELSIF NEW.business_record_type='solar_request' THEN
      SELECT profile_id INTO target_profile FROM solar_construction_requests WHERE id=NEW.business_record_id;
    ELSE
      target_profile:=NEW.profile_id;
    END IF;
    IF target_profile IS DISTINCT FROM NEW.profile_id THEN
      RAISE EXCEPTION 'Document business record belongs to another profile' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage_records s WHERE s.storage_key=NEW.upload_key
      AND s.metadata->>'uploadedBy'=NEW.uploaded_by
      AND s.metadata->'uploadContext'->>'profileId'=NEW.profile_id::text
      AND s.metadata->'uploadContext'->>'purpose'=CASE NEW.uploaded_by_type
        WHEN 'customer' THEN 'business_document' WHEN 'staff' THEN 'staff_business_document' ELSE '' END
      AND s.file_name=NEW.original_name AND s.file_size=NEW.size_bytes AND s.category=NEW.category
      AND s.status='removed' AND s.metadata->>'provisionalUpload'='true') THEN
      RAISE EXCEPTION 'Document requires its original owned upload reservation' USING ERRCODE='23514';
    END IF;
    IF NEW.supersedes_document_id IS NOT NULL THEN
      SELECT * INTO predecessor FROM documents WHERE id=NEW.supersedes_document_id FOR UPDATE;
      IF NOT FOUND OR predecessor.profile_id<>NEW.profile_id
        OR predecessor.business_record_type<>NEW.business_record_type
        OR predecessor.business_record_id IS DISTINCT FROM NEW.business_record_id
        OR (predecessor.state NOT IN ('Available','Approved','Rejected')
          AND NOT (NEW.business_record_type='solar_request' AND predecessor.state='SubmittedForReview')
          AND NOT (NEW.business_record_type='contract' AND NEW.uploaded_by_type='staff'
            AND predecessor.state='Quarantined' AND EXISTS (
              SELECT 1 FROM contract_documents cd
              WHERE cd.document_id=predecessor.id AND cd.role='original'))) THEN
        RAISE EXCEPTION 'Invalid document replacement target' USING ERRCODE='23514';
      END IF;
    END IF;
    NEW.created_at:=clock_timestamp();
    NEW.updated_at:=NEW.created_at;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.created_at,NEW.profile_id,NEW.business_record_type,NEW.business_record_id,
     NEW.category,NEW.upload_key,NEW.original_name,NEW.size_bytes,NEW.uploaded_by,NEW.uploaded_by_type,NEW.supersedes_document_id)
     IS DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.profile_id,OLD.business_record_type,OLD.business_record_id,
     OLD.category,OLD.upload_key,OLD.original_name,OLD.size_bytes,OLD.uploaded_by,OLD.uploaded_by_type,OLD.supersedes_document_id) THEN
    RAISE EXCEPTION 'Document identity and replacement lineage are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.storage_key IS NOT NULL AND ROW(NEW.storage_key,NEW.checksum,NEW.detected_mime)
    IS DISTINCT FROM ROW(OLD.storage_key,OLD.checksum,OLD.detected_mime) THEN
    RAISE EXCEPTION 'Document bytes are immutable; create a replacement' USING ERRCODE='23514';
  END IF;
  IF (NEW.state=OLD.state AND NOT (OLD.state='PendingScan' AND OLD.storage_key IS NULL
      AND NEW.storage_key IS NOT NULL AND NEW.scan_state='Pending')) OR NOT (
    (OLD.state='PendingScan' AND NEW.state='PendingScan' AND OLD.storage_key IS NULL
      AND NEW.storage_key IS NOT NULL AND NEW.scan_state='Pending') OR
    (OLD.state='Uploading' AND NEW.state IN ('PendingScan','Removed')) OR
    (OLD.state='PendingScan' AND NEW.state IN ('Available','Removed')) OR
    (OLD.state='Available' AND (NEW.state IN ('SubmittedForReview','Superseded')
      OR (NEW.state='Removed' AND OLD.business_record_type='order'
        AND OLD.uploaded_by_type='customer'
        AND EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=OLD.business_record_id)))) OR
    (OLD.business_record_type='solar_request' AND OLD.state IN ('Available','SubmittedForReview','Approved','Rejected') AND NEW.state='Removed') OR
    (OLD.business_record_type='solar_request' AND OLD.state='SubmittedForReview' AND NEW.state='Superseded') OR
    (OLD.business_record_type='solar_request' AND OLD.state='Available' AND NEW.state IN ('Approved','Rejected')) OR
    (OLD.state='SubmittedForReview' AND NEW.state IN ('Approved','Rejected','Available')) OR
    (OLD.state IN ('Approved','Rejected') AND NEW.state='Superseded') OR
    (OLD.state IN ('Superseded','Quarantined') AND NEW.state='Removed') OR
    (OLD.state='Quarantined' AND NEW.state='Superseded' AND EXISTS (
      SELECT 1 FROM contract_documents cd WHERE cd.document_id=OLD.id AND cd.role='original')) OR
    (OLD.state<>'Removed' AND NEW.state='Quarantined')
  ) THEN
    RAISE EXCEPTION 'Document state transition is not permitted' USING ERRCODE='23514';
  END IF;
  IF NEW.state IN ('Superseded','Removed') AND (EXISTS (SELECT 1 FROM contract_document_locks WHERE document_id=OLD.id) OR EXISTS (
    SELECT 1 FROM contract_documents cd JOIN contracts c ON c.id=cd.contract_id
    WHERE cd.document_id=OLD.id AND cd.contract_version_id=c.current_version_id
      AND (c.signed_at IS NOT NULL OR c.state IN ('Signed','Active','Completed'))
  )) THEN
    RAISE EXCEPTION 'Signed contract documents cannot be replaced or removed' USING ERRCODE='23514';
  END IF;
  IF OLD.state='SubmittedForReview' AND NEW.state='Available' AND
    (NEW.review_comment IS NULL OR length(trim(NEW.review_comment)) NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'Returning a document requires a reason' USING ERRCODE='23514';
  END IF;
  IF NEW.storage_key IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM storage_records s WHERE s.storage_key=NEW.storage_key AND s.status='immutable'
      AND s.metadata->>'sourceKey'=NEW.upload_key AND s.metadata->>'sha256'=NEW.checksum
      AND s.metadata->>'profileId'=NEW.profile_id::text AND s.metadata->>'uploadedBy'=NEW.uploaded_by
      AND s.file_size=NEW.size_bytes AND s.content_type=NEW.detected_mime
  ) THEN
    RAISE EXCEPTION 'Document requires its verified immutable storage copy' USING ERRCODE='23514';
  END IF;
  NEW.revision:=OLD.revision+1;
  NEW.updated_at:=clock_timestamp();
  NEW.removed_at:=CASE WHEN NEW.state='Removed' THEN NEW.updated_at ELSE NULL END;
  RETURN NEW;
END $$;
