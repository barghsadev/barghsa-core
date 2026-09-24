CREATE TABLE "document_destruction_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"document_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"upload_key" text NOT NULL,
	"retention_deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending_approval' NOT NULL,
	"planned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"destruction_started_at" timestamp with time zone,
	"destroyed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_destruction_status" CHECK ("document_destruction_items"."status" IN ('pending_approval','approved','destroying','cancelled','destroyed')),
	CONSTRAINT "document_destruction_attempts" CHECK ("document_destruction_items"."attempts" >= 0),
	CONSTRAINT "document_destruction_approval" CHECK (("document_destruction_items"."status" = 'pending_approval' AND "document_destruction_items"."approved_by" IS NULL AND "document_destruction_items"."approved_at" IS NULL AND "document_destruction_items"."destruction_started_at" IS NULL AND "document_destruction_items"."destroyed_at" IS NULL)
        OR ("document_destruction_items"."status" = 'cancelled' AND "document_destruction_items"."destroyed_at" IS NULL)
        OR ("document_destruction_items"."status" = 'approved' AND "document_destruction_items"."approved_by" IS NOT NULL AND "document_destruction_items"."approved_at" IS NOT NULL AND "document_destruction_items"."destruction_started_at" IS NULL AND "document_destruction_items"."destroyed_at" IS NULL)
        OR ("document_destruction_items"."status" = 'destroying' AND "document_destruction_items"."approved_by" IS NOT NULL AND "document_destruction_items"."approved_at" IS NOT NULL AND "document_destruction_items"."destruction_started_at" IS NOT NULL AND "document_destruction_items"."destroyed_at" IS NULL)
        OR ("document_destruction_items"."status" = 'destroyed' AND "document_destruction_items"."approved_by" IS NOT NULL AND "document_destruction_items"."approved_at" IS NOT NULL AND "document_destruction_items"."destruction_started_at" IS NOT NULL AND "document_destruction_items"."destroyed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "document_destruction_items" ADD CONSTRAINT "document_destruction_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_destruction_items" ADD CONSTRAINT "document_destruction_items_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_destruction_items" ADD CONSTRAINT "document_destruction_items_policy_id_document_retention_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."document_retention_policies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_destruction_items" ADD CONSTRAINT "document_destruction_items_approved_by_users_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_destruction_active_document_unique" ON "document_destruction_items" USING btree ("document_id") WHERE "document_destruction_items"."status" IN ('pending_approval','approved','destroying');--> statement-breakpoint
CREATE INDEX "document_destruction_status_idx" ON "document_destruction_items" USING btree ("status","planned_at");--> statement-breakpoint
CREATE INDEX "document_destruction_profile_idx" ON "document_destruction_items" USING btree ("profile_id","status");
--> statement-breakpoint
CREATE FUNCTION document_retention_eligibility(p_document_id uuid)
RETURNS TABLE(policy_id uuid, retention_deadline timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT p.id,
    (CASE
      WHEN d.business_record_type='standalone' THEN d.removed_at
      WHEN d.business_record_type='contract' AND c.state='Completed' AND c.completed_at IS NOT NULL
        THEN GREATEST(d.removed_at,c.completed_at)
      WHEN d.business_record_type='contract' AND c.state='Cancelled' AND c.cancelled_at IS NOT NULL
        THEN GREATEST(d.removed_at,c.cancelled_at)
      WHEN d.business_record_type='contract' AND c.state='Rejected'
        THEN GREATEST(d.removed_at,c.updated_at)
      WHEN d.business_record_type='invoice' AND i.state='Paid' AND i.paid_at IS NOT NULL
        THEN GREATEST(d.removed_at,i.paid_at)
      WHEN d.business_record_type='invoice' AND i.state='Cancelled' AND i.cancelled_at IS NOT NULL
        THEN GREATEST(d.removed_at,i.cancelled_at)
      WHEN d.business_record_type='invoice' AND i.state='Refunded'
        THEN GREATEST(d.removed_at,i.updated_at)
      WHEN d.business_record_type='order' AND o.status='CANCELLED'
        THEN GREATEST(d.removed_at,o.updated_at)
      WHEN d.business_record_type='order' AND o.order_type='electricity'
        AND eo.status IN ('completed','rejected','cancelled')
        THEN GREATEST(d.removed_at,eo.updated_at)
      WHEN d.business_record_type='order' AND o.order_type='savings'
        AND so.status IN ('completed','rejected','cancelled')
        THEN GREATEST(d.removed_at,so.updated_at)
      WHEN d.business_record_type='solar_request' AND s.status IN ('rejected','cancelled')
        THEN GREATEST(d.removed_at,s.updated_at)
      WHEN d.business_record_type='solar_request' AND s.status='contract_created'
        AND sc.state='Completed' AND sc.completed_at IS NOT NULL
        THEN GREATEST(d.removed_at,sc.completed_at)
      WHEN d.business_record_type='solar_request' AND s.status='contract_created'
        AND sc.state='Cancelled' AND sc.cancelled_at IS NOT NULL
        THEN GREATEST(d.removed_at,sc.cancelled_at)
    END) + p.retention_years * interval '1 year'
  FROM documents d
  JOIN LATERAL (
    SELECT policy.id,policy.retention_years FROM document_retention_policies policy
    WHERE policy.business_record_type=d.business_record_type::text
      AND policy.effective_date<=now()
    ORDER BY policy.effective_date DESC,policy.id DESC LIMIT 1
  ) p ON true
  LEFT JOIN contracts c ON d.business_record_type='contract' AND c.id=d.business_record_id
  LEFT JOIN invoices i ON d.business_record_type='invoice' AND i.id=d.business_record_id
  LEFT JOIN orders o ON d.business_record_type='order' AND o.id=d.business_record_id
  LEFT JOIN electricity_orders eo ON eo.id=o.id
  LEFT JOIN saving_orders so ON so.order_id=o.id
  LEFT JOIN solar_construction_requests s ON d.business_record_type='solar_request'
    AND s.id=d.business_record_id
  LEFT JOIN contracts sc ON sc.id=s.contract_id
  WHERE d.id=p_document_id AND d.state='Removed';
$$;
--> statement-breakpoint
CREATE FUNCTION guard_policy_during_destruction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('document_retention_policy:' || NEW.business_record_type));
  IF EXISTS (SELECT 1 FROM document_destruction_items item
    JOIN documents d ON d.id=item.document_id
    WHERE d.business_record_type::text=NEW.business_record_type AND item.status='destroying') THEN
    RAISE EXCEPTION 'Cannot change policy during document destruction' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER document_retention_policy_destruction_guard
  BEFORE INSERT ON document_retention_policies
  FOR EACH ROW EXECUTE FUNCTION guard_policy_during_destruction();

--> statement-breakpoint
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
  -- A started, approved destruction can erase object pointers while preserving identity and history.
  IF OLD.state='Removed' AND NEW.state='Removed' AND OLD.storage_key IS NOT NULL
    AND NEW.storage_key IS NULL AND NEW.original_name='[destroyed]'
    AND NEW.detected_mime IS NULL AND NEW.checksum IS NULL
    AND NEW.rejection_reason IS NULL AND NEW.review_comment IS NULL
    AND ROW(NEW.id,NEW.created_at,NEW.profile_id,NEW.business_record_type,
      NEW.business_record_id,NEW.category,NEW.upload_key,NEW.size_bytes,
      NEW.uploaded_by,NEW.uploaded_by_type,NEW.supersedes_document_id,
      NEW.scan_state,NEW.scan_skipped_reason,NEW.removed_at)
      IS NOT DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.profile_id,
      OLD.business_record_type,OLD.business_record_id,OLD.category,
      OLD.upload_key,OLD.size_bytes,OLD.uploaded_by,OLD.uploaded_by_type,
      OLD.supersedes_document_id,OLD.scan_state,OLD.scan_skipped_reason,OLD.removed_at)
    AND EXISTS (SELECT 1 FROM document_destruction_items item
      WHERE item.document_id=OLD.id AND item.status='destroying'
        AND item.storage_key=OLD.storage_key AND item.upload_key=OLD.upload_key) THEN
    NEW.revision:=OLD.revision+1;
    NEW.updated_at:=clock_timestamp();
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

--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_document_legal_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Legal holds are retained for audit' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.document_id IS NOT NULL THEN
      PERFORM 1 FROM documents WHERE id=NEW.document_id FOR UPDATE;
      IF EXISTS (SELECT 1 FROM document_destruction_items
        WHERE document_id=NEW.document_id AND status IN ('destroying','destroyed')) THEN
        RAISE EXCEPTION 'Document destruction already started' USING ERRCODE='23514';
      END IF;
    ELSE
      PERFORM 1 FROM profiles WHERE id=NEW.profile_id FOR UPDATE;
      IF EXISTS (SELECT 1 FROM document_destruction_items
        WHERE profile_id=NEW.profile_id AND status='destroying') THEN
        RAISE EXCEPTION 'Profile document destruction already started' USING ERRCODE='23514';
      END IF;
    END IF;
    IF NEW.released_at IS NOT NULL OR NEW.released_by IS NOT NULL THEN
      RAISE EXCEPTION 'Legal holds begin active' USING ERRCODE='23514';
    END IF;
    NEW.initiated_at:=clock_timestamp();
    RETURN NEW;
  END IF;
  IF OLD.released_at IS NOT NULL OR NEW.released_at IS NULL OR NEW.released_by IS NULL
    OR ROW(NEW.id,NEW.document_id,NEW.profile_id,NEW.reason,NEW.initiated_by,
      NEW.initiated_at,NEW.expires_at) IS DISTINCT FROM ROW(OLD.id,OLD.document_id,
      OLD.profile_id,OLD.reason,OLD.initiated_by,OLD.initiated_at,OLD.expires_at) THEN
    RAISE EXCEPTION 'Only a recorded release may change a legal hold' USING ERRCODE='23514';
  END IF;
  NEW.released_at:=clock_timestamp();
  RETURN NEW;
END $$;
