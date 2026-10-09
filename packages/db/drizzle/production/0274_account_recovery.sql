CREATE TABLE "account_recovery_cases" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"profile_id" uuid NOT NULL,
	"target_user_id" text NOT NULL,
	"auth_version" integer NOT NULL,
	"old_login" text NOT NULL,
	"new_login" text NOT NULL,
	"support_reference" text NOT NULL,
	"reason" text NOT NULL,
	"evidence_keys" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"reviewed_by" text,
	"reviewer_notes" text,
	"reviewed_at" timestamp with time zone,
	"challenge_id" text,
	"contact_verified_at" timestamp with time zone,
	"approval_expires_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"notice_references" jsonb,
	"completed_at" timestamp with time zone,
	CONSTRAINT "account_recovery_state" CHECK ("account_recovery_cases"."state" IN ('open','approved','rejected','applied','completed')),
	CONSTRAINT "account_recovery_distinct_review" CHECK ("account_recovery_cases"."reviewed_by" IS NULL OR "account_recovery_cases"."reviewed_by"<>"account_recovery_cases"."created_by"),
	CONSTRAINT "account_recovery_distinct_login" CHECK ("account_recovery_cases"."old_login"<>"account_recovery_cases"."new_login"),
	CONSTRAINT "account_recovery_evidence" CHECK (jsonb_typeof("account_recovery_cases"."evidence_keys")='array' AND jsonb_array_length("account_recovery_cases"."evidence_keys") BETWEEN 1 AND 5),
	CONSTRAINT "account_recovery_approval" CHECK ("account_recovery_cases"."state" NOT IN ('approved','applied','completed') OR ("account_recovery_cases"."reviewed_by" IS NOT NULL AND "account_recovery_cases"."reviewed_at" IS NOT NULL AND "account_recovery_cases"."reviewer_notes" IS NOT NULL AND "account_recovery_cases"."approval_expires_at" IS NOT NULL)),
	CONSTRAINT "account_recovery_applied" CHECK ("account_recovery_cases"."state" NOT IN ('applied','completed') OR ("account_recovery_cases"."applied_at" IS NOT NULL AND "account_recovery_cases"."contact_verified_at" IS NOT NULL AND "account_recovery_cases"."challenge_id" IS NOT NULL)),
	CONSTRAINT "account_recovery_complete" CHECK ("account_recovery_cases"."state"<>'completed' OR ("account_recovery_cases"."completed_at" IS NOT NULL AND "account_recovery_cases"."notice_references" IS NOT NULL AND "account_recovery_cases"."notice_references" ?& ARRAY['oldContact','newContact'] AND jsonb_typeof("account_recovery_cases"."notice_references"->'oldContact')='string' AND jsonb_typeof("account_recovery_cases"."notice_references"->'newContact')='string' AND jsonb_typeof("account_recovery_cases"."notice_references")='object' AND length("account_recovery_cases"."notice_references"->>'oldContact')>0 AND length("account_recovery_cases"."notice_references"->>'newContact')>0))
);
--> statement-breakpoint
ALTER TABLE "otp_challenges" DROP CONSTRAINT "otp_challenge_purpose_binding";--> statement-breakpoint
ALTER TABLE "account_recovery_cases" ADD CONSTRAINT "account_recovery_cases_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_cases" ADD CONSTRAINT "account_recovery_cases_target_user_id_users_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_cases" ADD CONSTRAINT "account_recovery_cases_created_by_users_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_cases" ADD CONSTRAINT "account_recovery_cases_reviewed_by_users_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_recovery_cases" ADD CONSTRAINT "account_recovery_cases_challenge_id_otp_challenges_challenge_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."otp_challenges"("challenge_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_recovery_profile_idx" ON "account_recovery_cases" USING btree ("profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "account_recovery_open_target" ON "account_recovery_cases" USING btree ("target_user_id") WHERE "account_recovery_cases"."state" IN ('open','approved','applied');--> statement-breakpoint
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenge_purpose_binding" CHECK (
    "otp_challenges"."purpose" = 'legacy_invalid'
    OR ("otp_challenges"."purpose" = 'registration' AND "otp_challenges"."user_id" IS NULL
        AND "otp_challenges"."password_hash" IS NOT NULL AND "otp_challenges"."tos_version_id" IS NOT NULL)
    OR ("otp_challenges"."purpose" IN ('login','password_reset','change_username','add_email','add_mobile','step_up','account_recovery')
        AND "otp_challenges"."user_id" IS NOT NULL)
  );
--> statement-breakpoint
CREATE TRIGGER account_recovery_updated_at BEFORE UPDATE ON account_recovery_cases FOR EACH ROW EXECUTE FUNCTION modify_updated_at();
--> statement-breakpoint
CREATE FUNCTION protect_account_recovery_case() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recovery case history is permanent'; END IF;
  IF ROW(NEW.id,NEW.profile_id,NEW.target_user_id,NEW.auth_version,NEW.old_login,NEW.new_login,NEW.support_reference,NEW.reason,NEW.evidence_keys,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.profile_id,OLD.target_user_id,OLD.auth_version,OLD.old_login,OLD.new_login,OLD.support_reference,OLD.reason,OLD.evidence_keys,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'Recovery target and evidence are immutable'; END IF;
  IF OLD.state IN ('completed','rejected') THEN RAISE EXCEPTION 'Terminal recovery case is immutable'; END IF;
  IF OLD.state<>NEW.state AND NOT ((OLD.state='open' AND NEW.state IN ('approved','rejected')) OR (OLD.state='approved' AND NEW.state IN ('applied','rejected')) OR (OLD.state='applied' AND NEW.state='completed'))
  THEN RAISE EXCEPTION 'Invalid recovery transition'; END IF;
  IF OLD.reviewed_by IS NOT NULL AND ROW(NEW.reviewed_by,NEW.reviewed_at,NEW.reviewer_notes,NEW.approval_expires_at) IS DISTINCT FROM ROW(OLD.reviewed_by,OLD.reviewed_at,OLD.reviewer_notes,OLD.approval_expires_at)
  THEN RAISE EXCEPTION 'Recovery approval is immutable'; END IF;
  IF OLD.state='applied' AND ROW(NEW.applied_at,NEW.challenge_id,NEW.contact_verified_at) IS DISTINCT FROM ROW(OLD.applied_at,OLD.challenge_id,OLD.contact_verified_at)
  THEN RAISE EXCEPTION 'Applied recovery proof is immutable'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER account_recovery_history BEFORE UPDATE OR DELETE ON account_recovery_cases FOR EACH ROW EXECUTE FUNCTION protect_account_recovery_case();
