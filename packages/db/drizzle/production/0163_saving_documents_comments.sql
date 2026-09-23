CREATE TABLE "saving_order_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"order_id" uuid NOT NULL,
	"author_user_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saving_order_comments_body" CHECK (length(trim("saving_order_comments"."body")) BETWEEN 1 AND 10000)
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_category";--> statement-breakpoint
ALTER TABLE "saving_order_comments" ADD CONSTRAINT "saving_order_comments_order_id_saving_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."saving_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saving_order_comments" ADD CONSTRAINT "saving_order_comments_author_user_id_users_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saving_order_comments_order_idx" ON "saving_order_comments" USING btree ("order_id","created_at","id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_category" CHECK ("documents"."category" IN ('document','image','video','contract'));
--> statement-breakpoint
CREATE FUNCTION prevent_saving_order_comment_edit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Saving order comments are append-only' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER saving_order_comment_immutable
BEFORE UPDATE OR DELETE ON saving_order_comments
FOR EACH ROW EXECUTE FUNCTION prevent_saving_order_comment_edit();

--> statement-breakpoint
-- Permit soft deletion of an unsubmitted customer document linked to a saving order.
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
      RAISE EXCEPTION 'Solar request document association is not yet supported' USING ERRCODE='23514';
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
        OR predecessor.state NOT IN ('Available','Approved','Rejected') THEN
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
  IF NEW.state=OLD.state OR NOT (
    (OLD.state='Uploading' AND NEW.state IN ('PendingScan','Removed')) OR
    (OLD.state='PendingScan' AND NEW.state IN ('Available','Removed')) OR
    (OLD.state='Available' AND (NEW.state IN ('SubmittedForReview','Superseded')
      OR (NEW.state='Removed' AND OLD.business_record_type='order'
        AND OLD.uploaded_by_type='customer'
        AND EXISTS(SELECT 1 FROM saving_orders s WHERE s.order_id=OLD.business_record_id)))) OR
    (OLD.state='SubmittedForReview' AND NEW.state IN ('Approved','Rejected','Available')) OR
    (OLD.state IN ('Approved','Rejected') AND NEW.state='Superseded') OR
    (OLD.state IN ('Superseded','Quarantined') AND NEW.state='Removed') OR
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
