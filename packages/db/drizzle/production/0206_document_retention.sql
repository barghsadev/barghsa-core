CREATE TABLE "document_legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"document_id" uuid,
	"profile_id" uuid,
	"reason" text NOT NULL,
	"initiated_by" text NOT NULL,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_by" text,
	"released_at" timestamp with time zone,
	CONSTRAINT "document_legal_holds_scope" CHECK (("document_legal_holds"."document_id" IS NULL) <> ("document_legal_holds"."profile_id" IS NULL)),
	CONSTRAINT "document_legal_holds_reason" CHECK (length(trim("document_legal_holds"."reason")) BETWEEN 3 AND 1000),
	CONSTRAINT "document_legal_holds_expiry" CHECK ("document_legal_holds"."expires_at" IS NULL OR "document_legal_holds"."expires_at" > "document_legal_holds"."initiated_at"),
	CONSTRAINT "document_legal_holds_release" CHECK (("document_legal_holds"."released_by" IS NULL) = ("document_legal_holds"."released_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "document_retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"business_record_type" text NOT NULL,
	"retention_years" integer NOT NULL,
	"legal_hold" boolean DEFAULT false NOT NULL,
	"approval_note" text NOT NULL,
	"effective_date" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_retention_policies_type" CHECK ("document_retention_policies"."business_record_type" IN ('contract','invoice','payment','refund','signed_document','order','solar_request','standalone')),
	CONSTRAINT "document_retention_policies_years" CHECK ("document_retention_policies"."retention_years" BETWEEN 1 AND 100),
	CONSTRAINT "document_retention_policies_note" CHECK (length(trim("document_retention_policies"."approval_note")) BETWEEN 3 AND 1000)
);
--> statement-breakpoint
ALTER TABLE "document_legal_holds" ADD CONSTRAINT "document_legal_holds_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_legal_holds" ADD CONSTRAINT "document_legal_holds_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_legal_holds" ADD CONSTRAINT "document_legal_holds_initiated_by_users_user_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_legal_holds" ADD CONSTRAINT "document_legal_holds_released_by_users_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_retention_policies" ADD CONSTRAINT "document_retention_policies_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_legal_holds_document_idx" ON "document_legal_holds" USING btree ("document_id","released_at");--> statement-breakpoint
CREATE INDEX "document_legal_holds_profile_idx" ON "document_legal_holds" USING btree ("profile_id","released_at");--> statement-breakpoint
CREATE INDEX "document_retention_policies_current_idx" ON "document_retention_policies" USING btree ("business_record_type","effective_date","id");
--> statement-breakpoint
INSERT INTO document_retention_policies(business_record_type,retention_years,legal_hold,approval_note)
VALUES ('contract',10,false,'System default'),('invoice',10,false,'System default'),
  ('payment',10,false,'System default'),('refund',10,false,'System default'),
  ('signed_document',10,false,'System default'),('order',5,false,'System default'),
  ('solar_request',5,false,'System default'),('standalone',5,false,'System default');
--> statement-breakpoint
CREATE FUNCTION retain_document_retention_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Retention policies are append-only' USING ERRCODE='23514';
END $$;
CREATE TRIGGER document_retention_policy_immutable BEFORE UPDATE OR DELETE ON document_retention_policies
  FOR EACH ROW EXECUTE FUNCTION retain_document_retention_policy();
--> statement-breakpoint
CREATE FUNCTION guard_document_legal_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Legal holds are retained for audit' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
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
CREATE TRIGGER document_legal_hold_guard BEFORE INSERT OR UPDATE OR DELETE ON document_legal_holds
  FOR EACH ROW EXECUTE FUNCTION guard_document_legal_hold();
--> statement-breakpoint
CREATE FUNCTION document_is_held(p_document_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM documents d WHERE d.id=p_document_id AND (
      EXISTS (SELECT 1 FROM document_legal_holds h
        WHERE (h.document_id=d.id OR h.profile_id=d.profile_id)
          AND h.released_at IS NULL AND (h.expires_at IS NULL OR h.expires_at>now()))
      OR COALESCE((SELECT p.legal_hold FROM document_retention_policies p
        WHERE p.business_record_type=d.business_record_type::text AND p.effective_date<=now()
        ORDER BY p.effective_date DESC,p.id DESC LIMIT 1),false)
    )
  );
$$;
