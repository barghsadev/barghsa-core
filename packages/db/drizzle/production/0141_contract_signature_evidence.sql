CREATE TABLE "contract_signature_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"request_number" integer NOT NULL,
	"original_document_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signature_requests_positive_number" CHECK ("contract_signature_requests"."request_number">0)
);
--> statement-breakpoint
CREATE TABLE "contract_signatures" (
	"version_id" uuid PRIMARY KEY NOT NULL,
	"contract_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"signed_document_id" uuid NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_by_type" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_signatures_recorder_type" CHECK ("contract_signatures"."recorded_by_type" IN ('customer','staff'))
);
--> statement-breakpoint
ALTER TABLE "contract_signature_requests" ADD CONSTRAINT "contract_signature_requests_original_document_id_documents_id_fk" FOREIGN KEY ("original_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signature_requests" ADD CONSTRAINT "contract_signature_requests_requested_by_users_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signature_requests" ADD CONSTRAINT "signature_requests_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_request_id_contract_signature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."contract_signature_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_signed_document_id_documents_id_fk" FOREIGN KEY ("signed_document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_recorded_by_users_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_signatures" ADD CONSTRAINT "contract_signatures_version_fk" FOREIGN KEY ("contract_id","version_id") REFERENCES "public"."contract_versions"("contract_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "signature_requests_number_unique" ON "contract_signature_requests" USING btree ("version_id","request_number");--> statement-breakpoint
CREATE INDEX "signature_requests_contract_idx" ON "contract_signature_requests" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_signatures_request_unique" ON "contract_signatures" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_signatures_document_unique" ON "contract_signatures" USING btree ("signed_document_id");--> statement-breakpoint
CREATE INDEX "contract_signatures_contract_idx" ON "contract_signatures" USING btree ("contract_id");
--> statement-breakpoint
CREATE FUNCTION guard_contract_signature_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; previous_number integer;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Signing requests are immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR parent.current_version_id<>NEW.version_id OR parent.state NOT IN ('Accepted','AwaitingSignature')
   OR parent.signed_at IS NOT NULL OR NOT EXISTS (SELECT 1 FROM contract_acceptances WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id)
 THEN RAISE EXCEPTION 'Signing request requires the current accepted contract version' USING ERRCODE='23514'; END IF;
 PERFORM id FROM documents WHERE id=NEW.original_document_id FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM documents d JOIN contract_documents cd ON cd.document_id=d.id
   WHERE d.id=NEW.original_document_id AND d.profile_id=parent.profile_id AND d.state='Approved'
    AND d.storage_key IS NOT NULL AND d.checksum IS NOT NULL AND d.detected_mime='application/pdf'
    AND cd.contract_id=NEW.contract_id AND cd.contract_version_id=NEW.version_id AND cd.role='original')
 THEN RAISE EXCEPTION 'Signing request requires an approved original PDF for the exact version' USING ERRCODE='23514'; END IF;
 SELECT COALESCE(MAX(request_number),0) INTO previous_number FROM contract_signature_requests WHERE version_id=NEW.version_id;
 IF NEW.request_number<>previous_number+1 THEN RAISE EXCEPTION 'Signing request number must increment exactly once' USING ERRCODE='23514'; END IF;
 NEW.requested_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER contract_signature_requests_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_signature_requests
 FOR EACH ROW EXECUTE FUNCTION guard_contract_signature_request();
--> statement-breakpoint
CREATE FUNCTION apply_contract_signature_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE contracts SET state='AwaitingSignature' WHERE id=NEW.contract_id;
 RETURN NULL;
END $$;
CREATE TRIGGER contract_signature_requests_apply AFTER INSERT ON contract_signature_requests
 FOR EACH ROW EXECUTE FUNCTION apply_contract_signature_request();
--> statement-breakpoint
CREATE FUNCTION guard_contract_signature() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent contracts%ROWTYPE; request contract_signature_requests%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Signed-copy evidence is immutable' USING ERRCODE='23514'; END IF;
 SELECT * INTO parent FROM contracts WHERE id=NEW.contract_id FOR UPDATE;
 IF NOT FOUND OR parent.current_version_id<>NEW.version_id OR parent.state<>'AwaitingSignature' OR parent.signed_at IS NOT NULL
   OR NOT EXISTS (SELECT 1 FROM contract_acceptances WHERE version_id=NEW.version_id AND contract_id=NEW.contract_id)
 THEN RAISE EXCEPTION 'Signed copy requires the current accepted version awaiting signature' USING ERRCODE='23514'; END IF;
 SELECT * INTO request FROM contract_signature_requests WHERE version_id=NEW.version_id ORDER BY request_number DESC LIMIT 1;
 IF NOT FOUND OR request.id<>NEW.request_id OR request.contract_id<>NEW.contract_id
 THEN RAISE EXCEPTION 'Signed copy must use the latest exact-version signing request' USING ERRCODE='23514'; END IF;
 PERFORM id FROM documents WHERE id IN (request.original_document_id,NEW.signed_document_id) ORDER BY id FOR UPDATE;
 IF NOT EXISTS (SELECT 1 FROM documents WHERE id=request.original_document_id AND state='Approved')
 THEN RAISE EXCEPTION 'Requested original is no longer approved' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS (SELECT 1 FROM documents d JOIN contract_documents cd ON cd.document_id=d.id
   WHERE d.id=NEW.signed_document_id AND d.profile_id=parent.profile_id AND d.state='Approved'
     AND d.storage_key IS NOT NULL AND d.checksum IS NOT NULL
     AND cd.contract_id=NEW.contract_id AND cd.contract_version_id=NEW.version_id AND cd.role='signed')
 THEN RAISE EXCEPTION 'Signed copy requires an approved verified document for the exact version and role' USING ERRCODE='23514'; END IF;
 NEW.recorded_at:=clock_timestamp();
 RETURN NEW;
END $$;
CREATE TRIGGER contract_signatures_guard BEFORE INSERT OR UPDATE OR DELETE ON contract_signatures
 FOR EACH ROW EXECUTE FUNCTION guard_contract_signature();
--> statement-breakpoint
CREATE FUNCTION apply_contract_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE contracts SET state='Signed',signed_at=NEW.recorded_at WHERE id=NEW.contract_id;
 RETURN NULL;
END $$;
CREATE TRIGGER contract_signatures_apply AFTER INSERT ON contract_signatures
 FOR EACH ROW EXECUTE FUNCTION apply_contract_signature();
--> statement-breakpoint
CREATE FUNCTION guard_contract_signature_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.signed_at IS NOT NULL AND NEW.signed_at IS DISTINCT FROM OLD.signed_at
   AND NOT (NEW.current_version_id<>OLD.current_version_id AND NEW.signed_at IS NULL)
 THEN RAISE EXCEPTION 'Signature time is immutable within its contract version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contracts_signature_timestamp BEFORE UPDATE ON contracts
 FOR EACH ROW EXECUTE FUNCTION guard_contract_signature_timestamp();
--> statement-breakpoint
CREATE FUNCTION check_contract_signature_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current contracts%ROWTYPE;
BEGIN
 SELECT * INTO current FROM contracts WHERE id=NEW.id;
 IF current.state='AwaitingSignature' AND NOT EXISTS (SELECT 1 FROM contract_signature_requests
   WHERE contract_id=current.id AND version_id=current.current_version_id)
 THEN RAISE EXCEPTION 'Awaiting signature requires an immutable signing request' USING ERRCODE='23514'; END IF;
 IF current.state='Signed' AND current.signed_at IS NULL
 THEN RAISE EXCEPTION 'Signed state requires its evidence timestamp' USING ERRCODE='23514'; END IF;
 IF current.signed_at IS NOT NULL AND (current.state NOT IN ('Signed','Active','Completed','Cancelled') OR NOT EXISTS(
   SELECT 1 FROM contract_signatures WHERE contract_id=current.id AND version_id=current.current_version_id AND recorded_at=current.signed_at))
 THEN RAISE EXCEPTION 'Signed contract requires version-bound signed-copy evidence' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER contracts_signature_evidence AFTER INSERT OR UPDATE ON contracts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_contract_signature_state();
