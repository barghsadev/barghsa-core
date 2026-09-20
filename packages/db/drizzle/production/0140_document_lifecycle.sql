CREATE TYPE "public"."contract_document_role" AS ENUM('original', 'signed', 'amendment', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."document_business_type" AS ENUM('contract', 'invoice', 'order', 'solar_request', 'standalone');--> statement-breakpoint
CREATE TYPE "public"."document_scan_state" AS ENUM('Uploading', 'Pending', 'Available', 'Quarantined');--> statement-breakpoint
CREATE TYPE "public"."document_state" AS ENUM('Uploading', 'PendingScan', 'Available', 'SubmittedForReview', 'Approved', 'Rejected', 'Superseded', 'Quarantined', 'Removed');--> statement-breakpoint
CREATE TYPE "public"."document_uploader_type" AS ENUM('customer', 'staff', 'system');--> statement-breakpoint
CREATE TABLE "contract_document_locks" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"contract_version_id" uuid NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_documents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"contract_version_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"role" "contract_document_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_events" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_state" "document_state",
	"state" "document_state" NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"profile_id" uuid NOT NULL,
	"business_record_type" "document_business_type" NOT NULL,
	"business_record_id" uuid,
	"category" text NOT NULL,
	"state" "document_state" DEFAULT 'Uploading' NOT NULL,
	"scan_state" "document_scan_state" DEFAULT 'Uploading' NOT NULL,
	"scan_skipped_reason" text,
	"upload_key" text NOT NULL,
	"storage_key" text,
	"original_name" text NOT NULL,
	"detected_mime" text,
	"size_bytes" bigint NOT NULL,
	"checksum" text,
	"uploaded_by" text NOT NULL,
	"uploaded_by_type" "document_uploader_type" NOT NULL,
	"supersedes_document_id" uuid,
	"rejection_reason" text,
	"review_comment" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "documents_business_identity" CHECK (("documents"."business_record_type"='standalone') = ("documents"."business_record_id" IS NULL)),
	CONSTRAINT "documents_positive_size" CHECK ("documents"."size_bytes" > 0 AND "documents"."size_bytes" <= 52428800),
	CONSTRAINT "documents_positive_revision" CHECK ("documents"."revision" > 0),
	CONSTRAINT "documents_name" CHECK (length(trim("documents"."original_name")) BETWEEN 1 AND 255),
	CONSTRAINT "documents_category" CHECK ("documents"."category" IN ('document','image','contract')),
	CONSTRAINT "documents_checksum" CHECK ("documents"."checksum" IS NULL OR "documents"."checksum" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "documents_rejection_reason" CHECK ("documents"."state" <> 'Rejected' OR ("documents"."rejection_reason" IS NOT NULL AND length(trim("documents"."rejection_reason")) BETWEEN 1 AND 1000)),
	CONSTRAINT "documents_scan_state" CHECK (("documents"."state"<>'Uploading' OR "documents"."scan_state"='Uploading') AND ("documents"."state"<>'PendingScan' OR "documents"."scan_state"='Pending') AND ("documents"."state"<>'Quarantined' OR "documents"."scan_state"='Quarantined')),
	CONSTRAINT "documents_removed_timestamp" CHECK (("documents"."state"='Removed') = ("documents"."removed_at" IS NOT NULL)),
	CONSTRAINT "documents_ready_content" CHECK ("documents"."state" IN ('Uploading','PendingScan','Quarantined','Removed') OR ("documents"."storage_key" IS NOT NULL AND "documents"."detected_mime" IS NOT NULL AND "documents"."checksum" IS NOT NULL AND "documents"."scan_state"='Available'))
);
--> statement-breakpoint
ALTER TABLE "contract_document_locks" ADD CONSTRAINT "contract_document_locks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_document_locks" ADD CONSTRAINT "contract_document_locks_contract_version_id_contract_versions_id_fk" FOREIGN KEY ("contract_version_id") REFERENCES "public"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_contract_version_id_contract_versions_id_fk" FOREIGN KEY ("contract_version_id") REFERENCES "public"."contract_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_documents" ADD CONSTRAINT "contract_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_events" ADD CONSTRAINT "document_events_actor_id_users_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_upload_key_storage_records_storage_key_fk" FOREIGN KEY ("upload_key") REFERENCES "public"."storage_records"("storage_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_storage_key_storage_records_storage_key_fk" FOREIGN KEY ("storage_key") REFERENCES "public"."storage_records"("storage_key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_document_locks_version_idx" ON "contract_document_locks" USING btree ("contract_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_documents_document_unique" ON "contract_documents" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "contract_documents_version_idx" ON "contract_documents" USING btree ("contract_version_id");--> statement-breakpoint
CREATE INDEX "contract_documents_contract_idx" ON "contract_documents" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_events_revision_unique" ON "document_events" USING btree ("document_id","revision");--> statement-breakpoint
CREATE INDEX "document_events_actor_idx" ON "document_events" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_upload_unique" ON "documents" USING btree ("upload_key");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_unique" ON "documents" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_successor_unique" ON "documents" USING btree ("supersedes_document_id") WHERE "documents"."storage_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "documents_profile_created_idx" ON "documents" USING btree ("profile_id","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_business_idx" ON "documents" USING btree ("business_record_type","business_record_id");--> statement-breakpoint
CREATE INDEX "documents_review_idx" ON "documents" USING btree ("state","created_at","id");--> statement-breakpoint
CREATE INDEX "documents_uploader_idx" ON "documents" USING btree ("uploaded_by");
--> statement-breakpoint
ALTER TABLE documents ADD CONSTRAINT documents_predecessor_fk
  FOREIGN KEY (supersedes_document_id) REFERENCES documents(id) ON DELETE RESTRICT;
ALTER TABLE contract_documents ADD CONSTRAINT contract_documents_version_identity_fk
  FOREIGN KEY (contract_id,contract_version_id) REFERENCES contract_versions(contract_id,id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION guard_document_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
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
    (OLD.state='Available' AND NEW.state IN ('SubmittedForReview','Superseded')) OR
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
CREATE TRIGGER document_lifecycle_guard BEFORE INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_document_lifecycle();
--> statement-breakpoint
CREATE FUNCTION retain_document_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Document evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER document_events_immutable BEFORE UPDATE OR DELETE ON document_events
  FOR EACH ROW EXECUTE FUNCTION retain_document_evidence();
CREATE TRIGGER contract_documents_immutable BEFORE UPDATE OR DELETE ON contract_documents
  FOR EACH ROW EXECUTE FUNCTION retain_document_evidence();
--> statement-breakpoint
CREATE FUNCTION validate_document_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_document documents%ROWTYPE;
BEGIN
  SELECT * INTO current_document FROM documents WHERE id=NEW.id;
  IF NOT EXISTS (SELECT 1 FROM document_events e WHERE e.document_id=NEW.id
    AND e.revision=NEW.revision AND e.state=NEW.state
    AND (e.previous_state IS NOT DISTINCT FROM CASE WHEN TG_OP='UPDATE' THEN OLD.state ELSE NULL END)) THEN
    RAISE EXCEPTION 'Every document transition requires an audit event' USING ERRCODE='23514';
  END IF;
  IF NEW.business_record_type='contract' AND NOT EXISTS (
    SELECT 1 FROM contract_documents cd WHERE cd.document_id=NEW.id AND cd.contract_id=NEW.business_record_id
  ) THEN
    RAISE EXCEPTION 'Contract documents require an exact version association' USING ERRCODE='23514';
  END IF;
  IF NEW.state='Superseded' AND NOT EXISTS (
    SELECT 1 FROM documents successor WHERE successor.supersedes_document_id=NEW.id
      AND successor.storage_key IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Supersession requires a verified replacement' USING ERRCODE='23514';
  END IF;
  IF NEW.state='Available' AND NEW.supersedes_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM documents predecessor WHERE predecessor.id=NEW.supersedes_document_id AND predecessor.state='Superseded'
  ) THEN
    RAISE EXCEPTION 'Replacement must supersede its predecessor atomically' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER document_commit_guard AFTER INSERT OR UPDATE ON documents
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_document_commit();
--> statement-breakpoint
CREATE FUNCTION guard_contract_document_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM documents d JOIN contracts c ON c.id=NEW.contract_id
    WHERE d.id=NEW.document_id AND d.business_record_type='contract'
      AND d.business_record_id=c.id AND d.profile_id=c.profile_id
      AND c.current_version_id=NEW.contract_version_id AND c.signed_at IS NULL
      AND c.state NOT IN ('Signed','Active','Completed','Cancelled')
      AND (d.uploaded_by_type<>'customer' OR NEW.role='signed')) THEN
    RAISE EXCEPTION 'Contract document association must match its business record' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_document_link_guard BEFORE INSERT ON contract_documents
  FOR EACH ROW EXECUTE FUNCTION guard_contract_document_link();
--> statement-breakpoint
CREATE FUNCTION guard_document_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM documents d WHERE d.id=NEW.document_id AND d.revision=NEW.revision AND d.state=NEW.state)
    OR (NEW.revision=1 AND NEW.previous_state IS NOT NULL)
    OR (NEW.revision>1 AND NOT EXISTS (SELECT 1 FROM document_events e WHERE e.document_id=NEW.document_id
      AND e.revision=NEW.revision-1 AND e.state=NEW.previous_state)) THEN
    RAISE EXCEPTION 'Document event must describe the current transition' USING ERRCODE='23514';
  END IF;
  NEW.created_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER document_event_guard BEFORE INSERT ON document_events
  FOR EACH ROW EXECUTE FUNCTION guard_document_event();
--> statement-breakpoint
CREATE TRIGGER contract_document_locks_immutable BEFORE UPDATE OR DELETE ON contract_document_locks
  FOR EACH ROW EXECUTE FUNCTION retain_document_evidence();
CREATE FUNCTION lock_signed_contract_documents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.state IN ('Signed','Active','Completed') AND OLD.state NOT IN ('Signed','Active','Completed'))
     OR (NEW.signed_at IS NOT NULL AND NEW.signed_at IS DISTINCT FROM OLD.signed_at) THEN
    INSERT INTO contract_document_locks(document_id,contract_version_id)
      SELECT cd.document_id,cd.contract_version_id FROM contract_documents cd
      WHERE cd.contract_id=NEW.id AND cd.contract_version_id=NEW.current_version_id
      ON CONFLICT (document_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER signed_contract_document_retention AFTER UPDATE OF state,signed_at ON contracts
  FOR EACH ROW EXECUTE FUNCTION lock_signed_contract_documents();
--> statement-breakpoint
CREATE FUNCTION guard_contract_document_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM contract_documents cd JOIN contracts c ON c.id=cd.contract_id
    WHERE cd.document_id=NEW.document_id AND cd.contract_version_id=NEW.contract_version_id
      AND c.current_version_id=NEW.contract_version_id
      AND (c.signed_at IS NOT NULL OR c.state IN ('Signed','Active','Completed'))) THEN
    RAISE EXCEPTION 'Retention lock requires its signed contract version' USING ERRCODE='23514';
  END IF;
  NEW.locked_at:=clock_timestamp();
  RETURN NEW;
END $$;
CREATE TRIGGER contract_document_retention_guard BEFORE INSERT ON contract_document_locks
  FOR EACH ROW EXECUTE FUNCTION guard_contract_document_lock();
