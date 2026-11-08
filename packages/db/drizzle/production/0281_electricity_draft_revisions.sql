CREATE TABLE "electricity_customer_draft_revisions" (
	"user_id" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"revision" uuid DEFAULT uuid_generate_v7() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "electricity_customer_draft_revisions_user_id_profile_id_mode_pk" PRIMARY KEY("user_id","profile_id","mode"),
	CONSTRAINT "electricity_customer_draft_revisions_mode" CHECK ("electricity_customer_draft_revisions"."mode" IN ('simple', 'advanced'))
);
--> statement-breakpoint
ALTER TABLE "electricity_customer_draft_revisions" ADD CONSTRAINT "electricity_customer_draft_revisions_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "electricity_customer_draft_revisions" ADD CONSTRAINT "electricity_customer_draft_revisions_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "electricity_customer_draft_revisions_profile_idx" ON "electricity_customer_draft_revisions" USING btree ("profile_id");--> statement-breakpoint
CREATE FUNCTION public.bump_electricity_draft_revision(owner_id text, owner_profile uuid, draft_mode text)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.electricity_customer_draft_revisions(user_id,profile_id,mode)
    VALUES (owner_id,owner_profile,draft_mode)
    ON CONFLICT(user_id,profile_id,mode) DO UPDATE
      SET revision=EXCLUDED.revision,updated_at=clock_timestamp();
$$;--> statement-breakpoint
-- Keep old writers and expiry cleanup compatible. The metadata contains no draft data.
CREATE FUNCTION public.track_electricity_draft_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.bump_electricity_draft_revision(OLD.user_id,OLD.profile_id,OLD.mode);
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.user_id,OLD.profile_id,OLD.mode)
      IS DISTINCT FROM (NEW.user_id,NEW.profile_id,NEW.mode) THEN
    PERFORM public.bump_electricity_draft_revision(OLD.user_id,OLD.profile_id,OLD.mode);
  END IF;
  PERFORM public.bump_electricity_draft_revision(NEW.user_id,NEW.profile_id,NEW.mode);
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER track_electricity_draft_revision
AFTER INSERT OR UPDATE OR DELETE ON public.electricity_customer_drafts
FOR EACH ROW EXECUTE FUNCTION public.track_electricity_draft_revision();
